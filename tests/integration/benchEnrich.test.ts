// =============================================================================
// Integration: npm run db:enrich makes a test network and fills it in
// =============================================================================
// scripts/bench/run.ts fills in the contacts that carry the `benchseed` tag,
// and creates them first for an account that has none. These tests run it on
// the real schema, with its triggers, and check what matters to the person
// who reads the result: a seed gives the same people on any database, a
// second run changes nothing, the words a contact has survive, the people
// who are not tagged are not touched, and the server's next boot has nothing
// left to redo.
// =============================================================================

import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { contactsAwaitingGeocode } from "../../server/services/geocoding/index.ts";
import {
  defaultAvatarUrl,
  isDefaultAvatarFor,
} from "../../server/utils/avatarUrl.ts";
import { doubleMetaphone } from "../../server/utils/nlp/index.ts";
import { enrichBenchContacts, main } from "../../scripts/bench/run.ts";
import { sqliteStamp } from "../../scripts/bench/plan.ts";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const SEED = "integration";
const COUNT = 40;
const TABLES = [
  "contacts",
  "contact_tags",
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
const HAND_ABOUT = "Runs the night shift rota out of the Trafford Park depot.";

let localId: string;
const real = ["real-0", "real-1"];
const hand = Array.from({ length: 6 }, (_, i) => `hand-${i}`);

const exec = (sql: string, ...params: unknown[]) =>
  sqlite.prepare(sql).run(...params);
const read = <T>(sql: string, ...params: unknown[]) =>
  sqlite.prepare(sql).all(...params) as T[];
/** `?, ?, ?` for a list of ids. */
const marks = (ids: string[]) => ids.map(() => "?").join(", ");

function insertContact(
  id: string,
  ownerId: string,
  over: Record<string, string | number | null> = {},
  tag = true,
) {
  const row = {
    id,
    name: `Person ${id}`,
    firstName: "Person",
    lastName: id,
    location: "Berlin, Germany",
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
  localId = ensureLocalOwner();
  for (const id of real)
    insertContact(id, localId, { about: "A real person, kept as is." }, false);
});

const run = (over: Record<string, unknown> = {}) =>
  enrichBenchContacts({
    apply: true,
    tag: "benchseed",
    count: COUNT,
    seed: SEED,
    now: NOW,
    ...over,
  });

/** Run the command line, and answer its exit code and what it printed. */
function cli(...args: string[]) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = main(args);
  const out = [...log.mock.calls, ...error.mock.calls].join("\n");
  log.mockRestore();
  error.mockRestore();
  return { code, out };
}
const SAME = [
  "--count",
  `${COUNT}`,
  "--seed",
  SEED,
  "--now",
  NOW.toISOString(),
];

/** The people the run created for the local account. */
const network = () =>
  read<{ id: string }>(
    `SELECT c.id FROM contacts c JOIN contact_tags t ON t.contactId = c.id
      WHERE t.tag = 'benchseed' AND c.ownerId = ? ORDER BY c.id`,
    localId,
  ).map((row) => row.id);

/** Every row the script can write, for a before and after. */
const dump = (ids: string[], db = sqlite) =>
  Object.fromEntries(
    TABLES.map((table) => [
      table,
      db
        .prepare(
          `SELECT * FROM ${table} WHERE ${table === "contacts" ? "id" : "contactId"} IN (${marks(ids)}) ORDER BY id`,
        )
        .all(...ids),
    ]),
  );

describe("npm run db:enrich", () => {
  it("says what it would create for an account with no tagged contact, and writes nothing", () => {
    const before = dump(real);
    const { code, out } = cli(...SAME);
    expect(code).toBe(0);
    expect(out).toContain("Account: local");
    expect(out).toContain(
      `Would write these rows for ${COUNT} contacts with the tag benchseed, ${COUNT} of them new:`,
    );
    expect(out).toMatch(/contact_tags +\d+/);
    expect(out).toContain("This was a dry run.");
    expect(dump(real)).toEqual(before);
    expect(read("SELECT id FROM contact_tags")).toEqual([]);
  });

  it("refuses a command line or an account it cannot read", () => {
    expect(cli("--count", "0")).toEqual({
      code: 1,
      out: "--count takes a whole number above 0.",
    });
    expect(cli("--now", "soon")).toEqual({
      code: 1,
      out: "--now takes a date, such as 2026-09-30T12:00:00Z.",
    });
    expect(cli("--aply")).toEqual({
      code: 1,
      out: expect.stringContaining("'--aply'"),
    });
    expect(cli("--owner", "nobody")).toEqual({
      code: 1,
      out: 'No account is named "nobody".',
    });
  });

  it("creates the network with its tags, and fills in every person", () => {
    const before = dump(real);
    const { code, out } = cli("--apply", ...SAME);
    expect(code).toBe(0);
    expect(out).toContain(
      `Wrote these rows for ${COUNT} contacts with the tag benchseed, ${COUNT} of them new:`,
    );
    expect(out).toContain("Start the server.");
    const ids = network();
    expect(ids).toHaveLength(COUNT);
    expect(dump(real)).toEqual(before);
    const people = read<Record<string, string | null>>(
      `SELECT c.*, (SELECT COUNT(*) FROM contact_tags t WHERE t.contactId = c.id) AS tags,
              (SELECT COUNT(*) FROM contact_tags t WHERE t.contactId = c.id AND t.addedAt = c.addedAt) AS dated,
              (SELECT address FROM contact_addresses a WHERE a.contactId = c.id AND a.isPrimary = 1) AS home
         FROM contacts c WHERE c.id IN (${marks(ids)})`,
      ...ids,
    );
    for (const person of people) {
      for (const key of ["role", "company", "headline", "about", "industry"])
        expect(person[key], key).toBeTruthy();
      expect(Number(person.tags)).toBeGreaterThanOrEqual(2);
      expect(Number(person.tags)).toBeLessThanOrEqual(4);
      expect(person.dated).toBe(person.tags);
      expect(person.home).toContain(person.location!.split(",")[0]);
      expect(person.geoSource).toBe("geocoder");
    }
    expect(contactsAwaitingGeocode().filter((c) => ids.includes(c.id))).toEqual(
      [],
    );
  });

  it("leaves the server's boot nothing to redo, and queues every person for the search index", () => {
    const ids = network();
    const people = read<{
      id: string;
      name: string;
      pronouns: string | null;
      avatarUrl: string;
      phoneticHash: string;
      about: string;
    }>(`SELECT * FROM contacts WHERE id IN (${marks(ids)})`, ...ids);
    // The boot backfills each UPDATE a column that the edit trigger stamps
    // with the real clock, so a row they touch loses its planned updatedAt.
    for (const p of people) {
      expect(p.phoneticHash).toBe(doubleMetaphone(p.name).primary);
      expect(isDefaultAvatarFor(p.avatarUrl, p.name)).toBe(true);
      expect(p.avatarUrl).toBe(defaultAvatarUrl(p.name, p.pronouns));
    }
    expect(people.filter((p) => p.pronouns).length).toBeGreaterThan(3);
    const queued = read(
      `SELECT contactId FROM search_index_queue WHERE status = 'pending' AND contactId IN (${marks(ids)})`,
      ...ids,
    );
    expect(queued).toHaveLength(COUNT);
    const word = people[1].about
      .split(/\W+/)
      .filter((w) => /^[A-Za-z]{7,}$/.test(w))
      .sort((a, b) => b.length - a.length)[0];
    const hits = read<{ contactId: string }>(
      "SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ?",
      `"${word}"*`,
    );
    expect(hits.map((h) => h.contactId)).toContain(people[1].id);
  });

  it("dates each person by the plan, after the triggers have stamped the real clock", () => {
    // Writing a tag, an address or a note stamps the contact's updatedAt with
    // the real clock, and so does the trigger on trackedAt. The plan's dates
    // survive only if the contact is saved last.
    const ids = network();
    const rows = read<{
      addedAt: string;
      updatedAt: string;
      lastContactedAt: string | null;
      isTracked: number;
      trackedAt: string | null;
    }>(
      `SELECT addedAt, updatedAt, lastContactedAt, isTracked, trackedAt FROM contacts WHERE id IN (${marks(ids)})`,
      ...ids,
    );
    for (const r of rows) {
      expect(r.addedAt <= r.updatedAt).toBe(true);
      expect(r.updatedAt <= sqliteStamp(NOW)).toBe(true);
      if (r.lastContactedAt)
        expect(new Date(r.lastContactedAt) <= NOW).toBe(true);
    }
    const tracked = rows.filter((r) => r.isTracked === 1);
    expect(tracked.length).toBeGreaterThan(3);
    expect(tracked.every((r) => r.trackedAt === r.updatedAt)).toBe(true);
    expect(
      new Set(rows.map((r) => r.updatedAt.slice(0, 7))).size,
    ).toBeGreaterThan(4);
    expect(rows.filter((r) => r.lastContactedAt).length).toBeGreaterThan(20);
  });

  it("creates no one and changes nothing on a second run", async () => {
    const everyone = [...network(), ...real];
    const before = dump(everyone);
    // The database stamps a row with the real time when a column has no value.
    // Two runs in one second hid that, so the second run waits past the next
    // second on purpose.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(run()).toMatchObject({
      created: 0,
      rows: { contacts: COUNT },
    });
    expect(dump(everyone)).toEqual(before);
  });

  it("gives the same people, ids included, and the same rows on a fresh database", () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "contrack-bench-"));
    const child = spawnSync(
      process.execPath,
      [
        "scripts/bench/run.ts",
        "--apply",
        "--count",
        `${COUNT}`,
        "--seed",
        SEED,
        "--now",
        NOW.toISOString(),
      ],
      {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DATA_DIR: dataDir,
        },
        encoding: "utf8",
      },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toContain(`${COUNT} of them new`);
    const fresh = new Database(path.join(dataDir, "curator.db"));
    const freshOwner = fresh
      .prepare("SELECT id FROM users WHERE username = 'local'")
      .pluck()
      .get() as string;
    const ids = network();
    // Each database made its own local account, so the owner is the one
    // value that differs.
    const theirs = JSON.stringify(dump(ids, fresh)).replaceAll(
      freshOwner,
      "owner",
    );
    fresh.close();
    expect(theirs).toBe(JSON.stringify(dump(ids)).replaceAll(localId, "owner"));
  });

  it("keeps the words a contact has and fills only its gaps, in the account it is told", () => {
    const otherId = crypto.randomUUID();
    exec(
      "INSERT INTO users (id, username, email, role, passwordHash) VALUES (?, 'other', 'other@example.com', 'member', 'x')",
      otherId,
    );
    const words = {
      role: "Shift lead",
      headline: "Shift lead, Trafford Park",
      about: HAND_ABOUT,
      company: "Trafford Freight",
      industry: "Logistics",
    };
    hand.forEach((id, i) =>
      insertContact(id, otherId, {
        ...words,
        location: ["Aarhus", "Valencia, Spain", "Atlantis"][i % 3],
        ...(i === 0 ? { headline: null, about: null } : {}),
      }),
    );
    insertContact("other-real", otherId, {}, false);
    exec(
      "INSERT INTO interactions (id, contactId, type, title, content, date, ownerId) VALUES ('note-1', 'hand-1', 'call', 'Rota', '<p>Swapped the Friday shift.</p>', '2026-03-06T05:47:06.972Z', ?)",
      otherId,
    );
    const untouched = dump(["other-real"]);

    // Both accounts have tagged contacts now.
    expect(() => run()).toThrow(/more than one account/);
    expect(run({ owner: "other" })).toMatchObject({
      created: 0,
      rows: { contacts: hand.length },
    });
    expect(dump(["other-real"])).toEqual(untouched);
    const rows = read<Record<string, string | null>>(
      `SELECT id, role, headline, about, company, industry FROM contacts WHERE id IN (${marks(hand)}) ORDER BY id`,
      ...hand,
    );
    for (const row of rows.slice(1))
      expect(row).toEqual({ id: row.id, ...words });
    expect(rows[0]).toMatchObject({ role: words.role, company: words.company });
    expect(rows[0].headline).toContain("Shift lead");
    expect(rows[0].about).toContain("Trafford Freight");
    const [note] = read<{ title: string; content: string }>(
      "SELECT title, content FROM interactions WHERE id = 'note-1'",
    );
    expect(note).toEqual({
      title: "Rota",
      content: "<p>Swapped the Friday shift.</p>",
    });

    // An email or a phone the account already has is not added again.
    const [{ email }] = read<{ email: string }>(
      `SELECT email FROM contact_emails WHERE id LIKE 'be-%' AND contactId IN (${marks(hand)})`,
      ...hand,
    );
    const [{ phone }] = read<{ phone: string }>(
      `SELECT phone FROM contact_phones WHERE id LIKE 'be-%' AND contactId IN (${marks(hand)})`,
      ...hand,
    );
    exec(
      "INSERT INTO contact_emails (id, contactId, email) VALUES ('e-1', 'other-real', ?)",
      email.toUpperCase(),
    );
    exec(
      "INSERT INTO contact_phones (id, contactId, phone) VALUES ('p-1', 'other-real', ?)",
      phone,
    );
    run({ owner: "other" });
    const owned = (table: string, column: string, value: string) =>
      read(
        `SELECT x.id FROM ${table} x JOIN contacts c ON c.id = x.contactId
          WHERE c.ownerId = ? AND lower(x.${column}) = lower(?)`,
        otherId,
        value,
      );
    expect(owned("contact_emails", "email", email)).toEqual([{ id: "e-1" }]);
    expect(owned("contact_phones", "phone", phone)).toEqual([{ id: "p-1" }]);
  });

  it("refuses a seed whose people are already in the database", () => {
    exec(
      "INSERT INTO users (id, username, email, role, passwordHash) VALUES (?, 'third', 'third@example.com', 'member', 'x')",
      crypto.randomUUID(),
    );
    expect(() => run({ owner: "third", count: 3 })).toThrow(
      /seed "integration" are already in this database/,
    );
    expect(
      run({ owner: "third", count: 3, seed: "another", apply: false }),
    ).toMatchObject({
      created: 3,
      rows: { contacts: 3, contact_tags: expect.any(Number) },
    });
  });
});
