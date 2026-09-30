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

let ownerId: string;
const generic: string[] = [];
const handWritten: string[] = [];
const real: string[] = [];

function insertContact(
  id: string,
  over: Record<string, string | number | null>,
  tagged: boolean,
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
  sqlite
    .prepare(
      `INSERT INTO contacts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(row));
  if (tagged)
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), id, "benchseed");
}

beforeAll(() => {
  ownerId = ensureLocalOwner();
  for (let i = 0; i < 30; i++) {
    const [location, lat, lng] = CITIES[i % CITIES.length];
    const id = `gen-${i}`;
    generic.push(id);
    insertContact(
      id,
      {
        location,
        lat,
        lng,
        geoSource: "geocoder",
        about: GENERIC_ABOUT,
        industry: INDUSTRY_NAMES[i % INDUSTRY_NAMES.length],
        firstName: "Christy",
      },
      true,
    );
    if (i % 3 !== 0) {
      sqlite
        .prepare(
          "INSERT INTO contact_emails (id, contactId, email, label, isPrimary) VALUES (?, ?, ?, 'work', 1)",
        )
        .run(crypto.randomUUID(), id, `gen${i}@gmail.com`);
    }
    if (i % 2 === 0) {
      sqlite
        .prepare(
          "INSERT INTO contact_phones (id, contactId, phone, label, isPrimary) VALUES (?, ?, ?, 'mobile', 1)",
        )
        .run(crypto.randomUUID(), id, `\\+1 \\(808\\) 731-${String(1000 + i)}`);
    }
    if (i % 5 === 0) {
      sqlite
        .prepare(
          "INSERT INTO interactions (id, contactId, type, title, content, date, ownerId) VALUES (?, ?, 'coffee', 'Catch up', ?, '2026-03-06T05:47:06.972Z', ?)",
        )
        .run(crypto.randomUUID(), id, LOREM, ownerId);
    }
  }
  for (let i = 0; i < 10; i++) {
    const id = `hand-${i}`;
    handWritten.push(id);
    insertContact(
      id,
      {
        location: "Aarhus",
        lat: 56.1496,
        lng: 10.2045,
        geoSource: "geocoder",
        about: HAND_ABOUT,
        role: "Shift lead",
        headline: "Shift lead, Trafford Park",
        industry: "Logistics",
        company: "Trafford Freight",
      },
      true,
    );
  }
  for (let i = 0; i < 3; i++) {
    const id = `real-${i}`;
    real.push(id);
    insertContact(
      id,
      {
        location: "Berlin, Germany",
        about: "A real person, kept as they are.",
      },
      false,
    );
  }
});

const run = (over: Record<string, unknown> = {}) =>
  enrichBenchContacts({ apply: true, seed: SEED, now: NOW, ...over });

/** Every row the script can write or change, for a before and after. */
function dump(ids: string[]): Record<string, unknown[]> {
  const marks = ids.map(() => "?").join(", ");
  const tables: Record<string, string> = {
    contacts: `SELECT * FROM contacts WHERE id IN (${marks}) ORDER BY id`,
    contact_emails: `SELECT * FROM contact_emails WHERE contactId IN (${marks}) ORDER BY id`,
    contact_phones: `SELECT * FROM contact_phones WHERE contactId IN (${marks}) ORDER BY id`,
    contact_addresses: `SELECT * FROM contact_addresses WHERE contactId IN (${marks}) ORDER BY id`,
    contact_social_links: `SELECT * FROM contact_social_links WHERE contactId IN (${marks}) ORDER BY id`,
    contact_education: `SELECT * FROM contact_education WHERE contactId IN (${marks}) ORDER BY id`,
    contact_experience: `SELECT * FROM contact_experience WHERE contactId IN (${marks}) ORDER BY id`,
    contact_interests: `SELECT * FROM contact_interests WHERE contactId IN (${marks}) ORDER BY id`,
    contact_attributes: `SELECT * FROM contact_attributes WHERE contactId IN (${marks}) ORDER BY id`,
    interactions: `SELECT * FROM interactions WHERE contactId IN (${marks}) ORDER BY id`,
    action_items: `SELECT * FROM action_items WHERE contactId IN (${marks}) ORDER BY id`,
  };
  const out: Record<string, unknown[]> = {};
  for (const [name, sql] of Object.entries(tables)) {
    out[name] = sqlite.prepare(sql).all(...ids);
  }
  return out;
}

const all = () => [...generic, ...handWritten];

describe("enrichBenchContacts", () => {
  it("changes nothing on a dry run, and says what it would do", async () => {
    const before = dump([...all(), ...real]);
    const summary = await enrichBenchContacts({
      apply: false,
      seed: SEED,
      now: NOW,
    });
    expect(dump([...all(), ...real])).toEqual(before);
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

  it("gives the tagged contacts addresses, a pin beside each, and history", () => {
    const addresses = sqlite
      .prepare(
        `SELECT contactId, count(*) n FROM contact_addresses WHERE contactId IN (${all()
          .map(() => "?")
          .join(",")}) GROUP BY contactId`,
      )
      .all(...all()) as { contactId: string; n: number }[];
    expect(addresses.length).toBeGreaterThanOrEqual(38);

    const pins = sqlite
      .prepare(
        `SELECT DISTINCT lat || ',' || lng AS pin FROM contacts WHERE id IN (${generic.map(() => "?").join(",")})`,
      )
      .all(...generic);
    // Thirty contacts in five cities used to share five points.
    expect(pins.length).toBeGreaterThan(20);

    const history = sqlite
      .prepare(
        `SELECT count(*) n FROM interactions WHERE contactId IN (${all()
          .map(() => "?")
          .join(",")})`,
      )
      .get(...all()) as { n: number };
    expect(history.n).toBeGreaterThan(40);
  });

  it("writes the pin itself, so the geocoder has nothing to fetch", () => {
    const waiting = contactsAwaitingGeocode().filter((c) =>
      all().includes(c.id),
    );
    expect(waiting).toEqual([]);
  });

  it("keeps a hand-written contact's own words and rewrites a generated one's", () => {
    const hand = sqlite
      .prepare(
        `SELECT about, role, headline, industry, company FROM contacts WHERE id = 'hand-0'`,
      )
      .get() as Record<string, string>;
    expect(hand).toEqual({
      about: HAND_ABOUT,
      role: "Shift lead",
      headline: "Shift lead, Trafford Park",
      industry: "Logistics",
      company: "Trafford Freight",
    });
    const gen = sqlite
      .prepare(`SELECT about, role, industry FROM contacts WHERE id = 'gen-0'`)
      .get() as { about: string; role: string; industry: string };
    expect(gen.about).not.toBe(GENERIC_ABOUT);
    expect(INDUSTRIES[gen.industry].roles).toContain(gen.role);
  });

  it("cleans the phones and labels the emails the first seed got wrong", () => {
    const phones = sqlite
      .prepare("SELECT phone FROM contact_phones WHERE contactId LIKE 'gen-%'")
      .all() as { phone: string }[];
    expect(phones.length).toBeGreaterThan(10);
    expect(phones.some((p) => p.phone.includes("\\"))).toBe(false);
    const gmail = sqlite
      .prepare(
        "SELECT label FROM contact_emails WHERE email LIKE '%@gmail.com' AND contactId LIKE 'gen-%'",
      )
      .all() as { label: string }[];
    expect(gmail.length).toBeGreaterThan(10);
    expect(gmail.every((e) => e.label === "personal")).toBe(true);
  });

  it("replaces the Latin filler in an old interaction, and keeps its date", () => {
    const rows = sqlite
      .prepare(
        "SELECT content, date FROM interactions WHERE contactId = 'gen-0' AND id NOT LIKE 'be-%'",
      )
      .all() as { content: string; date: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].content).not.toBe(LOREM);
    expect(rows[0].date).toBe("2026-03-06T05:47:06.972Z");
  });

  it("spreads when each contact was last edited, with some beyond six months", () => {
    // Writing an address or an interaction bumps the contact's updatedAt to
    // the real clock, so a plan's dates only survive if the contact is saved last.
    const stamp = NOW.toISOString().slice(0, 19).replace("T", " ");
    const rows = sqlite
      .prepare(
        `SELECT updatedAt FROM contacts WHERE id IN (${all()
          .map(() => "?")
          .join(",")})`,
      )
      .all(...all()) as { updatedAt: string }[];
    expect(rows.every((r) => r.updatedAt <= stamp)).toBe(true);
    expect(
      rows.filter((r) => r.updatedAt < "2026-03-30").length,
    ).toBeGreaterThan(0);
    expect(
      rows.filter((r) => r.updatedAt >= "2026-04-01").length,
    ).toBeGreaterThan(20);
  });

  it("dates the last contact in the past, and never after the clock", () => {
    const rows = sqlite
      .prepare(
        "SELECT lastContactedAt FROM contacts WHERE id LIKE 'gen-%' AND lastContactedAt IS NOT NULL",
      )
      .all() as { lastContactedAt: string }[];
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.every((r) => new Date(r.lastContactedAt) <= NOW)).toBe(true);
  });

  it("queues every changed contact for the search index", () => {
    const queued = sqlite
      .prepare(
        `SELECT count(*) n FROM search_index_queue WHERE contactId IN (${all()
          .map(() => "?")
          .join(",")}) AND status = 'pending'`,
      )
      .get(...all()) as { n: number };
    expect(queued.n).toBe(40);
  });

  it("finds a contact by a word in its new about, through the keyword index", () => {
    const { about } = sqlite
      .prepare("SELECT about FROM contacts WHERE id = 'gen-1'")
      .get() as { about: string };
    const word = about
      .split(/\W+/)
      .filter((w) => /^[A-Za-z]{7,}$/.test(w))
      .sort((a, b) => b.length - a.length)[0];
    expect(word).toBeTruthy();
    const hits = sqlite
      .prepare("SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ?")
      .all(`"${word}"*`) as { contactId: string }[];
    expect(hits.map((h) => h.contactId)).toContain("gen-1");
  });

  it("changes nothing on a second run with the same clock", async () => {
    const before = dump([...all(), ...real]);
    const again = await run();
    expect(dump([...all(), ...real])).toEqual(before);
    expect(again.contacts).toBe(40);
  });

  it("marks every row it added with an id that starts with be-", () => {
    const foreign = sqlite
      .prepare(
        `SELECT count(*) n FROM contact_addresses WHERE contactId IN (${all()
          .map(() => "?")
          .join(",")}) AND id NOT LIKE 'be-%'`,
      )
      .get(...all()) as { n: number };
    expect(foreign.n).toBe(0);
  });

  it("refuses to guess when two accounts have tagged contacts", async () => {
    const other = crypto.randomUUID();
    sqlite
      .prepare(
        "INSERT INTO users (id, username, email, role, passwordHash) VALUES (?, 'other', 'other@example.com', 'member', 'x')",
      )
      .run(other);
    sqlite
      .prepare(
        "INSERT INTO contacts (id, name, ownerId) VALUES ('other-1', 'Other Person', ?)",
      )
      .run(other);
    sqlite
      .prepare(
        "INSERT INTO contact_tags (id, contactId, tag) VALUES (?, 'other-1', 'benchseed')",
      )
      .run(crypto.randomUUID());
    await expect(run()).rejects.toThrow(/more than one account/i);
    // Naming the account settles it.
    const summary = await run({ owner: "other" });
    expect(summary.contacts).toBe(1);
  });
});
