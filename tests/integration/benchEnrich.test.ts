// =============================================================================
// Integration: the benchmark contacts get addresses and history
// =============================================================================
// scripts/enrich-bench-contacts.ts fills in the synthetic contacts that carry
// the `benchseed` tag. These tests run it on the real schema, with its triggers,
// and check what matters to the person who reads the result: the contacts'
// own words survive, the people who are not synthetic are not touched, a
// second run changes nothing, and no address is handed to the geocoder.
// =============================================================================

import { beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { contactsAwaitingGeocode } from "../../server/services/geocoding/index.ts";
import { enrichBenchContacts } from "../../scripts/enrich-bench-contacts.ts";
import { sqliteStamp } from "../../scripts/bench/enrich.ts";
import { INDUSTRIES } from "../../scripts/bench/profiles.ts";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const SEED = "integration";
const LOREM =
  "<p>Temptatio conforto demitto adhaero absque solitudo velut.</p>";

const GENERIC_ABOUT =
  "Christy works on leverage open-source infrastructures. Previously at Acme. Enjoys climate tech.";
const HAND_ABOUT = "Runs the night shift rota out of the Trafford Park depot.";

const CITIES: [string, number, number][] = [
  ["Berlin, Germany", 52.52, 13.405],
  ["San Francisco, CA, USA", 37.7749, -122.4194],
  ["Tokyo, Japan", 35.6895, 139.6917],
  ["Nairobi, Kenya", -1.2921, 36.8219],
  ["Sao Paulo, Brazil", -23.5505, -46.6333],
];
const INDUSTRY_NAMES = Object.keys(INDUSTRIES);
const TABLES = [
  "contacts",
  "contact_emails",
  "contact_phones",
  "contact_addresses",
  "contact_social_links",
  "contact_education",
  "contact_experience",
  "contact_interests",
  "contact_attributes",
  "interactions",
  "action_items",
];

let ownerId: string;
const generic = Array.from({ length: 30 }, (_, i) => `gen-${i}`);
const handWritten = Array.from({ length: 10 }, (_, i) => `hand-${i}`);
const real = ["real-0", "real-1", "real-2"];
const tagged = [...generic, ...handWritten];
const everyone = [...tagged, ...real];
const TAGGED = "(SELECT contactId FROM contact_tags WHERE tag = 'benchseed')";

const exec = (sql: string, ...params: unknown[]) =>
  sqlite.prepare(sql).run(...params);
const read = <T>(sql: string, ...params: unknown[]) =>
  sqlite.prepare(sql).all(...params) as T[];
/** `?, ?, ?` for a list of ids. */
const marks = (ids: string[]) => ids.map(() => "?").join(", ");

function insertContact(
  id: string,
  over: Record<string, string | number | null>,
  tag = true,
) {
  const row = {
    id,
    name: `Person ${id}`,
    firstName: "Person",
    lastName: id,
    headline: "Recruiter at Acme",
    role: "Recruiter",
    company: "Acme",
    location: null,
    about: null,
    industry: null,
    lat: null,
    lng: null,
    geoSource: null,
    cadenceDays: 90,
    ownerId,
    ...over,
  };
  const columns = Object.keys(row);
  exec(
    `INSERT INTO contacts (${columns.join(", ")}) VALUES (${marks(columns)})`,
    ...Object.values(row),
  );
  if (tag)
    exec(
      "INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, 'benchseed')",
      crypto.randomUUID(),
      id,
    );
}

beforeAll(() => {
  ownerId = ensureLocalOwner();
  generic.forEach((id, i) => {
    const [location, lat, lng] = CITIES[i % CITIES.length];
    insertContact(id, {
      location,
      lat,
      lng,
      geoSource: "geocoder",
      about: GENERIC_ABOUT,
      industry: INDUSTRY_NAMES[i % INDUSTRY_NAMES.length],
      firstName: "Christy",
    });
    const uuid = crypto.randomUUID();
    if (i % 3 !== 0)
      exec(
        "INSERT INTO contact_emails (id, contactId, email, label, isPrimary) VALUES (?, ?, ?, 'work', 1)",
        uuid,
        id,
        `gen${i}@gmail.com`,
      );
    if (i % 2 === 0)
      exec(
        "INSERT INTO contact_phones (id, contactId, phone, label, isPrimary) VALUES (?, ?, ?, 'mobile', 1)",
        uuid,
        id,
        `\\+1 \\(808\\) 731-${String(1000 + i)}`,
      );
    if (i % 5 === 0)
      exec(
        "INSERT INTO interactions (id, contactId, type, title, content, date, ownerId) VALUES (?, ?, 'coffee', 'Catch up', ?, '2026-03-06T05:47:06.972Z', ?)",
        uuid,
        id,
        LOREM,
        ownerId,
      );
  });
  for (const id of handWritten)
    insertContact(id, {
      location: "Aarhus",
      lat: 56.1496,
      lng: 10.2045,
      geoSource: "geocoder",
      about: HAND_ABOUT,
      role: "Shift lead",
      headline: "Shift lead, Trafford Park",
      industry: "Logistics",
      company: "Trafford Freight",
    });
  for (const id of real)
    insertContact(
      id,
      {
        location: "Berlin, Germany",
        about: "A real person, kept as they are.",
      },
      false,
    );
});

const run = (over: Record<string, unknown> = {}) =>
  enrichBenchContacts({ apply: true, seed: SEED, now: NOW, ...over });

/** Every row the script can write or change, for a before and after. */
const dump = (ids: string[]) =>
  Object.fromEntries(
    TABLES.map((table) => [
      table,
      read(
        `SELECT * FROM ${table} WHERE ${table === "contacts" ? "id" : "contactId"} IN (${marks(ids)}) ORDER BY id`,
        ...ids,
      ),
    ]),
  );

describe("enrichBenchContacts", () => {
  it("changes nothing on a dry run, and says what it would do", async () => {
    const before = dump(everyone);
    const summary = await run({ apply: false });
    expect(dump(everyone)).toEqual(before);
    expect(summary.applied).toBe(false);
    expect(summary.contacts).toBe(40);
    expect(summary.generic).toBe(30);
    expect(summary.rows.contact_addresses).toBeGreaterThan(40);
  });

  it("leaves the contacts that are not tagged exactly as they were", async () => {
    const before = dump(real);
    await run();
    expect(dump(real)).toEqual(before);
  });

  it("gives the tagged contacts addresses, a pin beside each that the geocoder need not fetch, and history", () => {
    const addresses = read(
      `SELECT DISTINCT contactId FROM contact_addresses WHERE contactId IN ${TAGGED}`,
    );
    expect(addresses.length).toBeGreaterThanOrEqual(38);
    // Thirty contacts in five cities used to share five points.
    const pins = read(
      "SELECT DISTINCT lat || ',' || lng FROM contacts WHERE id LIKE 'gen-%'",
    );
    expect(pins.length).toBeGreaterThan(20);
    const waiting = contactsAwaitingGeocode().filter((c) =>
      tagged.includes(c.id),
    );
    expect(waiting).toEqual([]);
    const history = read(
      `SELECT id FROM interactions WHERE contactId IN ${TAGGED}`,
    );
    expect(history.length).toBeGreaterThan(40);
  });

  it("keeps a hand-written contact's own words and rewrites a generated one's", () => {
    const [hand] = read(
      "SELECT about, role, headline, industry, company FROM contacts WHERE id = 'hand-0'",
    );
    expect(hand).toEqual({
      about: HAND_ABOUT,
      role: "Shift lead",
      headline: "Shift lead, Trafford Park",
      industry: "Logistics",
      company: "Trafford Freight",
    });
    const [gen] = read<{ about: string; role: string; industry: string }>(
      "SELECT about, role, industry FROM contacts WHERE id = 'gen-0'",
    );
    expect(gen.about).not.toBe(GENERIC_ABOUT);
    expect(INDUSTRIES[gen.industry].roles).toContain(gen.role);
  });

  it("fixes what the first seed got wrong: phones, email labels and Latin filler", () => {
    const phones = read<{ phone: string }>(
      "SELECT phone FROM contact_phones WHERE contactId LIKE 'gen-%'",
    );
    expect(phones.length).toBeGreaterThan(10);
    expect(phones.some((p) => p.phone.includes("\\"))).toBe(false);
    const gmail = read<{ label: string }>(
      "SELECT label FROM contact_emails WHERE email LIKE '%@gmail.com' AND contactId LIKE 'gen-%'",
    );
    expect(gmail.length).toBeGreaterThan(10);
    expect(gmail.every((e) => e.label === "personal")).toBe(true);
    // The old interaction keeps its date.
    const old = read<{ content: string; date: string }>(
      "SELECT content, date FROM interactions WHERE contactId = 'gen-0' AND id NOT LIKE 'be-%'",
    );
    expect(old).toHaveLength(1);
    expect(old[0].content).not.toBe(LOREM);
    expect(old[0].date).toBe("2026-03-06T05:47:06.972Z");
  });

  it("spreads when each contact was last edited, dates the last contact in the past, and dates the tracking it starts", () => {
    // Writing an address or an interaction bumps the contact's updatedAt to
    // the real clock, so a plan's dates only survive if the contact is saved last.
    const rows = read<{
      updatedAt: string;
      lastContactedAt: string | null;
      isTracked: number;
      trackedAt: string | null;
    }>(
      `SELECT updatedAt, lastContactedAt, isTracked, trackedAt FROM contacts WHERE id IN ${TAGGED}`,
    );
    expect(rows.every((r) => r.updatedAt <= sqliteStamp(NOW))).toBe(true);
    // Nobody was tracked before, and the trigger stamps the real clock, so a
    // run that starts tracking writes the plan's date after it.
    const tracked = rows.filter((r) => r.isTracked === 1);
    expect(tracked.length).toBeGreaterThan(3);
    expect(tracked.every((r) => r.trackedAt === r.updatedAt)).toBe(true);
    expect(
      rows.filter((r) => r.updatedAt < "2026-03-30").length,
    ).toBeGreaterThan(0);
    expect(
      rows.filter((r) => r.updatedAt >= "2026-04-01").length,
    ).toBeGreaterThan(20);
    const contacted = rows.filter((r) => r.lastContactedAt !== null);
    expect(contacted.length).toBeGreaterThan(15);
    expect(contacted.every((r) => new Date(r.lastContactedAt!) <= NOW)).toBe(
      true,
    );
  });

  it("queues every changed contact for the search index, whose keyword index has the new words", () => {
    const queued = read(
      `SELECT contactId FROM search_index_queue WHERE contactId IN ${TAGGED} AND status = 'pending'`,
    );
    expect(queued).toHaveLength(40);
    const [{ about }] = read<{ about: string }>(
      "SELECT about FROM contacts WHERE id = 'gen-1'",
    );
    const word = about
      .split(/\W+/)
      .filter((w) => /^[A-Za-z]{7,}$/.test(w))
      .sort((a, b) => b.length - a.length)[0];
    expect(word).toBeTruthy();
    const hits = read<{ contactId: string }>(
      "SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ?",
      `"${word}"*`,
    );
    expect(hits.map((h) => h.contactId)).toContain("gen-1");
  });

  it("changes nothing on a second run with the same clock", async () => {
    const before = dump(everyone);
    // The database stamps a row with the real time when a column has no value.
    // Two runs in one second hid that, and two on a slow machine did not, so
    // the second run waits past the next second on purpose.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const again = await run();
    expect(dump(everyone)).toEqual(before);
    expect(again.contacts).toBe(40);
  });

  it("refuses to guess when two accounts have tagged contacts", async () => {
    const other = crypto.randomUUID();
    exec(
      "INSERT INTO users (id, username, email, role, passwordHash) VALUES (?, 'other', 'other@example.com', 'member', 'x')",
      other,
    );
    exec(
      "INSERT INTO contacts (id, name, ownerId) VALUES ('other-1', 'Other Person', ?)",
      other,
    );
    exec(
      "INSERT INTO contact_tags (id, contactId, tag) VALUES (?, 'other-1', 'benchseed')",
      crypto.randomUUID(),
    );
    await expect(run()).rejects.toThrow(/more than one account/i);
    // Naming the account settles it.
    const summary = await run({ owner: "other" });
    expect(summary.contacts).toBe(1);
  });
});
