/**
 * `npm run db:enrich`: a test network that looks lived in.
 *
 * It works on the contacts of one account that carry a tag (`benchseed` by
 * default). When the account has none, it first creates a synthetic network
 * of people and tags them. Then it fills them in: addresses with their pins,
 * work history, schools, links, phones, notes and follow-ups. It does a dry
 * run unless you pass `--apply`.
 *
 *   npm run db:enrich                       # say what it would do
 *   npm run db:enrich -- --apply            # do it
 *   npm run db:enrich -- --apply --count 500 --owner admin --seed mine
 *
 * `--count` is how many people a new network has, 5,000 by default. The
 * account is `--owner` when given, else the one whose contacts carry the tag.
 * When no contact carries it, the account is the one the app uses when
 * nobody signs in: the local owner on a fresh database, the first admin on
 * an instance with accounts (`ensureLocalOwner` in server/db.ts).
 *
 * Run it with the server stopped. It writes the database directly and queues
 * each contact it changes for the search index, which the server reads when
 * it starts. It needs `DATA_DIR` set the way the server has it.
 *
 * It can run again. Every row it adds has an id that starts with `be-`, and a
 * run removes those rows and writes them again, so the result does not grow.
 * The same `--seed` and `--now` give the same database, and on another
 * database the same people, ids included. Without `--now` the dates follow
 * the clock, so a second run moves them by the time between runs.
 *
 * Words a contact has are never changed. Only its empty fields are filled.
 *
 * @module scripts/bench/run
 */
import "../../server/utils/loadEnv.ts";
import { parseArgs } from "node:util";
import type Database from "better-sqlite3";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { scheduleSearchIndex } from "../../server/services/search/indexQueue.ts";
import { createNetwork, uuidFrom, type NewContact } from "./create.ts";
import {
  planEnrichment,
  sqliteStamp,
  type BenchContact,
  type BenchInput,
  type BenchPlan,
} from "./plan.ts";

export interface EnrichOptions {
  /** Write the changes. Without it, count them and stop. */
  apply: boolean;
  /** The tag that marks a synthetic contact. */
  tag: string;
  /** The account's username. Needed only when two accounts use the tag. */
  owner?: string;
  /** How many people to create when the account has no tagged contact. */
  count: number;
  /** Changes every choice. The same seed gives the same people and rows. */
  seed: string;
  now: Date;
}

export interface EnrichSummary {
  applied: boolean;
  /** The account's username. */
  owner: string;
  tag: string;
  /** People this run creates first, because the account had none with the tag. */
  created: number;
  /**
   * Rows the run adds or changes, by table: the contacts it fills in, the
   * tags of the people it creates, and the rows the plans add. An email or
   * a phone the account already has is counted here and skipped when the
   * rows are written.
   */
  rows: Record<string, number>;
}

/** The marker on every row this script writes. */
const SOURCE = "bench-enrich";

/** The account: `--owner`, else the one whose contacts carry the tag, else the app's own. */
function resolveOwner(tag: string, username?: string): string {
  if (username) {
    const row = sqlite
      .prepare("SELECT id FROM users WHERE lower(username) = lower(?)")
      .get(username) as { id: string } | undefined;
    if (!row) throw new Error(`No account is named "${username}".`);
    return row.id;
  }
  const owners = sqlite
    .prepare(
      `SELECT DISTINCT c.ownerId FROM contacts c
        WHERE EXISTS (SELECT 1 FROM contact_tags t WHERE t.contactId = c.id AND t.tag = ?)`,
    )
    .pluck()
    .all(tag) as string[];
  if (owners.length > 1)
    throw new Error(
      `The tag "${tag}" is on contacts of more than one account. Pass --owner <username>.`,
    );
  return owners[0] ?? ensureLocalOwner();
}

export function enrichBenchContacts(options: EnrichOptions): EnrichSummary {
  const { tag, seed, now } = options;
  const ownerId = resolveOwner(tag, options.owner);
  const owner = sqlite
    .prepare("SELECT username FROM users WHERE id = ?")
    .pluck()
    .get(ownerId) as string;

  // A contact in the trash still carries the tag, and its id, so it counts.
  const tagged = sqlite
    .prepare(
      `SELECT 1 FROM contacts c JOIN contact_tags t ON t.contactId = c.id
        WHERE c.ownerId = ? AND t.tag = ? LIMIT 1`,
    )
    .get(ownerId, tag);
  const created = tagged ? [] : createNetwork(options.count, seed, tag);
  const exists = sqlite.prepare("SELECT 1 FROM contacts WHERE id = ?");
  if (created.some(({ contact }) => exists.get(contact.id)))
    throw new Error(
      `Contacts made from the seed "${seed}" are already in this database. Pass another --seed.`,
    );

  const contacts =
    created.length > 0
      ? created.map(({ contact }) => contact)
      : (sqlite
          .prepare(
            `SELECT c.id, c.name, c.firstName, c.lastName, c.company, c.role, c.headline,
                    c.industry, c.location, c.lat, c.lng, c.about, c.website, c.birthday,
                    c.pronouns, c.preferences, c.avatarUrl, c.cadenceDays, c.isTracked
               FROM contacts c
              WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL
                AND EXISTS (SELECT 1 FROM contact_tags t WHERE t.contactId = c.id AND t.tag = ?)
              ORDER BY c.id`,
          )
          .all(ownerId, tag) as BenchContact[]);

  // What the contact had before this script, so a second run reads the same.
  const readInterests = sqlite.prepare(
    "SELECT interest FROM contact_interests WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY interest",
  );
  const readEmails = sqlite.prepare(
    "SELECT email FROM contact_emails WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY sortOrder, rowid",
  );
  const readPhones = sqlite.prepare(
    "SELECT phone FROM contact_phones WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY sortOrder, rowid",
  );
  const readInteractions = sqlite.prepare(
    "SELECT type, title, content, date FROM interactions WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY date",
  );
  const inputOf = (row: BenchContact): BenchInput => ({
    ...row,
    interests: readInterests.pluck().all(row.id) as string[],
    emails: readEmails.pluck().all(row.id) as string[],
    phones: readPhones.pluck().all(row.id) as string[],
    interactions: readInteractions.all(row.id) as BenchInput["interactions"],
  });
  const plans = contacts.map((row) => ({
    id: row.id,
    plan: planEnrichment(inputOf(row), { seed, now }),
  }));

  const rows: Record<string, number> = { contacts: plans.length };
  if (created.length > 0)
    rows.contact_tags = created.reduce((n, c) => n + c.tags.length, 0);
  for (const { plan } of plans)
    for (const [table, list] of Object.entries(plan.add))
      rows[table] = (rows[table] ?? 0) + list.length;
  const summary: EnrichSummary = {
    applied: options.apply,
    owner,
    tag,
    created: created.length,
    rows,
  };
  if (options.apply) writeRun(ownerId, now, created, plans);
  return summary;
}

function writeRun(
  ownerId: string,
  now: Date,
  created: NewContact[],
  plans: { id: string; plan: BenchPlan }[],
): void {
  const statements = new Map<string, Database.Statement>();
  /** Run one statement, prepared once for each SQL text. */
  const run = (sql: string, ...params: unknown[]) => {
    const statement = statements.get(sql) ?? sqlite.prepare(sql);
    statements.set(sql, statement);
    return statement.run(...params);
  };
  /** Insert one row, with a named parameter for each column. */
  const insert = (table: string, values: object, verb = "INSERT") => {
    const columns = Object.keys(values);
    run(
      `${verb} INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`,
      values,
    );
  };
  const taken = {
    email: sqlite.prepare(
      `SELECT 1 FROM contact_emails e JOIN contacts c ON c.id = e.contactId
        WHERE c.ownerId = ? AND lower(e.email) = lower(?) LIMIT 1`,
    ),
    phone: sqlite.prepare(
      `SELECT 1 FROM contact_phones p JOIN contacts c ON c.id = p.contactId
        WHERE c.ownerId = ? AND p.phone = ? LIMIT 1`,
    ),
  };
  const fresh = new Map(created.map((person) => [person.contact.id, person]));

  const writeOne = (contactId: string, plan: BenchPlan) => {
    const keys = { contactId, ownerId };
    // Every stamp is written, never left to the column default, which is the
    // real clock. A second run then writes the same database.
    const { addedAt } = plan.contact;
    const at = sqliteStamp(now);

    // A new person is added on the day the plan says, with the tags it came with.
    const person = fresh.get(contactId);
    if (person) {
      insert("contacts", {
        ...person.contact,
        ownerId,
        addedAt,
        updatedAt: addedAt,
      });
      person.tags.forEach((tag, index) =>
        insert("contact_tags", {
          id: uuidFrom(`${contactId}:tag:${index}`),
          contactId,
          tag,
          addedAt,
        }),
      );
    }

    for (const table of Object.keys(plan.add))
      run(
        `DELETE FROM ${table} WHERE contactId = ? AND id LIKE 'be-%'`,
        contactId,
      );
    const stamps = (table: string, row: Record<string, unknown>) => {
      if (table === "interactions")
        return { ownerId, updatedAt: sqliteStamp(new Date(String(row.date))) };
      if (table === "action_items")
        return { ownerId, createdAt: at, updatedAt: at };
      if (table === "contact_interests") return { isAiGenerated: 0, addedAt };
      if (table === "contact_attributes") return { addedAt };
      return { source: SOURCE, addedAt };
    };
    for (const [table, list] of Object.entries(plan.add)) {
      // An interest or a custom field the contact has by hand stays.
      const verb =
        table === "contact_interests" || table === "contact_attributes"
          ? "INSERT OR IGNORE"
          : "INSERT";
      for (const row of list) {
        // An email or a phone the account already has is not added again.
        if ("email" in row && taken.email.get(ownerId, row.email)) continue;
        if ("phone" in row && taken.phone.get(ownerId, row.phone)) continue;
        insert(table, { ...row, contactId, ...stamps(table, row) }, verb);
      }
    }

    // Saved last, and `updatedAt` after the rest. A trigger on each child
    // table stamps the contact's updatedAt with the real clock, and so does
    // the one that stamps `trackedAt`, which writes the real clock there too.
    // A statement that sets `updatedAt` fires neither, so the plan's dates
    // are the final word.
    const { updatedAt, trackedAt, ...columns } = plan.contact;
    const where = "WHERE id = @contactId AND ownerId = @ownerId";
    run(
      `UPDATE contacts SET ${Object.keys(columns)
        .map((key) => `${key} = @${key}`)
        .join(", ")} ${where}`,
      { ...columns, ...keys },
    );
    run(
      `UPDATE contacts SET updatedAt = @updatedAt${trackedAt ? ", trackedAt = @trackedAt" : ""} ${where}`,
      { updatedAt, ...(trackedAt ? { trackedAt } : {}), ...keys },
    );

    scheduleSearchIndex(contactId);
  };

  const BATCH = 250;
  for (let start = 0; start < plans.length; start += BATCH) {
    sqlite.transaction(() => {
      for (const { id, plan } of plans.slice(start, start + BATCH))
        writeOne(id, plan);
    })();
  }
}

// ─── Command line ──────────────────────────────────────────────────────────

/** The options a command line gives, or an error that says what is wrong. */
export function parseOptions(args: string[]): EnrichOptions {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      count: { type: "string", default: "5000" },
      now: { type: "string" },
      owner: { type: "string" },
      seed: { type: "string", default: "contrack-bench" },
      tag: { type: "string", default: "benchseed" },
    },
  });
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1)
    throw new Error("--count takes a whole number above 0.");
  const now = values.now === undefined ? new Date() : new Date(values.now);
  if (Number.isNaN(now.getTime()))
    throw new Error("--now takes a date, such as 2026-09-30T12:00:00Z.");
  const { apply, owner, seed, tag } = values;
  return { apply, tag, owner, count, seed, now };
}

/** What a run did, or would do, as the command line prints it. */
export function report(summary: EnrichSummary): string {
  const { applied, created, rows, tag } = summary;
  return [
    `Database: ${sqlite.name}`,
    `Account: ${summary.owner}`,
    `${applied ? "Wrote" : "Would write"} these rows for ${rows.contacts} contacts with the tag ${tag}, ${created} of them new:`,
    ...Object.entries(rows).map(([table, n]) => `  ${table.padEnd(24)} ${n}`),
    "",
    applied
      ? "Start the server. It re-indexes the changed contacts at boot, and the first boot scores the tracked ones."
      : "This was a dry run. Add --apply to write it.",
  ].join("\n");
}

/** Run the command line, and answer the exit code. */
export function main(args: string[]): number {
  // This process only writes the search index queue. The server drains it at
  // its next start.
  process.env.DISABLE_BACKGROUND_JOBS = "true";
  try {
    console.log(report(enrichBenchContacts(parseOptions(args))));
    return 0;
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
