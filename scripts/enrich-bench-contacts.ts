/**
 * Fill in the synthetic benchmark contacts: addresses, work history, phones,
 * links, notes and follow-ups, so a test instance looks lived in.
 *
 * It touches only contacts that carry a tag (`benchseed` by default) and
 * belong to one account. It does a dry run unless you pass `--apply`.
 *
 *   node scripts/enrich-bench-contacts.ts                 # say what it would do
 *   node scripts/enrich-bench-contacts.ts --apply         # do it
 *   node scripts/enrich-bench-contacts.ts --apply --owner admin --seed mine
 *
 * Run it with the server stopped. It writes the database directly and queues
 * each changed contact for the search index, and the server reads that queue
 * when it starts. It needs `DATA_DIR` set the way the server has it.
 *
 * It can run again. Every row it adds has an id that starts with `be-`, and a
 * run removes those rows and writes them again, so the result does not grow.
 * The same `--seed` and `--now` give the same database. Without `--now` the
 * dates follow the clock, so a second run moves them by the time between runs.
 *
 * Words of a hand-written contact are never changed, only its gaps are filled.
 * See `scripts/bench/enrich.ts` for what each contact gets.
 *
 * @module scripts/enrich-bench-contacts
 */
import "../server/utils/loadEnv.ts";
import type Database from "better-sqlite3";
import { sqlite } from "../server/db.ts";
import { scheduleSearchIndex } from "../server/services/search/indexQueue.ts";
import {
  isGenericAbout,
  planEnrichment,
  sqliteStamp,
  type BenchContact,
  type BenchInput,
  type BenchPlan,
} from "./bench/enrich.ts";

export interface EnrichOptions {
  /** Write the changes. Without it, count them and stop. */
  apply: boolean;
  /** The tag that marks a synthetic contact. */
  tag?: string;
  /** The account's username. Needed only when two accounts use the tag. */
  owner?: string;
  seed?: string;
  now?: Date;
}

export interface EnrichSummary {
  applied: boolean;
  owner: string;
  contacts: number;
  /** Contacts the first seed wrote from templates, so their text is rewritten. */
  generic: number;
  /** Hand-written contacts, whose words stay. */
  curated: number;
  /**
   * Rows the plans add or change, by table. An email or a phone the account
   * already has is counted here and skipped when the rows are written.
   */
  rows: Record<string, number>;
}

/** The marker on every row this script writes. */
const SOURCE = "bench-enrich";

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
      `SELECT DISTINCT c.ownerId AS id FROM contacts c
        WHERE EXISTS (SELECT 1 FROM contact_tags t WHERE t.contactId = c.id AND t.tag = ?)`,
    )
    .all(tag) as { id: string }[];
  if (owners.length === 0)
    throw new Error(`No contact carries the tag "${tag}".`);
  if (owners.length > 1)
    throw new Error(
      `The tag "${tag}" is on contacts of more than one account. Pass --owner <username>.`,
    );
  return owners[0].id;
}

export async function enrichBenchContacts(
  options: EnrichOptions,
): Promise<EnrichSummary> {
  const tag = options.tag ?? "benchseed";
  const seed = options.seed ?? "contrack-bench";
  const now = options.now ?? new Date();
  const ownerId = resolveOwner(tag, options.owner);

  const contacts = sqlite
    .prepare(
      `SELECT c.id, c.name, c.firstName, c.lastName, c.company, c.role, c.headline,
              c.industry, c.location, c.lat, c.lng, c.about, c.website, c.birthday,
              c.pronouns, c.preferences, c.cadenceDays, c.isTracked
         FROM contacts c
        WHERE c.ownerId = ? AND c.deletedAt IS NULL AND c.canonicalId IS NULL
          AND EXISTS (SELECT 1 FROM contact_tags t WHERE t.contactId = c.id AND t.tag = ?)
        ORDER BY c.id`,
    )
    .all(ownerId, tag) as BenchContact[];

  // What the contact had before this script, so a second run reads the same.
  const readInterests = sqlite.prepare(
    "SELECT interest FROM contact_interests WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY interest",
  );
  const readEmails = sqlite.prepare(
    "SELECT email, label, isPrimary FROM contact_emails WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY sortOrder, rowid",
  );
  const readPhones = sqlite.prepare(
    "SELECT phone FROM contact_phones WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY sortOrder, rowid",
  );
  const readInteractions = sqlite.prepare(
    "SELECT id, type, date FROM interactions WHERE contactId = ? AND id NOT LIKE 'be-%' ORDER BY date",
  );

  const inputOf = (row: BenchContact): BenchInput => ({
    ...row,
    generic: isGenericAbout(row.about),
    interests: readInterests.pluck().all(row.id) as string[],
    emails: readEmails.all(row.id) as BenchInput["emails"],
    phones: readPhones.pluck().all(row.id) as string[],
    interactions: readInteractions.all(row.id) as BenchInput["interactions"],
  });
  const plans = contacts.map((row) => ({
    id: row.id,
    plan: planEnrichment(inputOf(row), { seed, now }),
  }));

  // Each fix is counted just before the table it changes, as it prints.
  const rows: Record<string, number> = { contacts: plans.length };
  const count = (key: string, list: unknown[]) =>
    (rows[key] = (rows[key] ?? 0) + list.length);
  for (const { plan } of plans) {
    count("email_labels", plan.emailLabels);
    for (const [table, list] of Object.entries(plan.add)) {
      if (table === "contact_phones") count("phones_cleaned", plan.phoneFixes);
      if (table === "interactions")
        count("interactions_rewritten", plan.interactionRewrites);
      count(table, list);
    }
  }
  const generic = contacts.filter((row) => isGenericAbout(row.about)).length;
  const summary: EnrichSummary = {
    applied: options.apply,
    owner: ownerId,
    contacts: contacts.length,
    generic,
    curated: contacts.length - generic,
    rows,
  };
  if (!options.apply) return summary;

  // `scheduleSearchIndex` would start draining the queue in this process. The
  // server drains it at its next start, so this one only writes the queue.
  const previousJobs = process.env.DISABLE_BACKGROUND_JOBS;
  process.env.DISABLE_BACKGROUND_JOBS = "true";
  try {
    writePlans(ownerId, plans, now);
  } finally {
    if (previousJobs === undefined) delete process.env.DISABLE_BACKGROUND_JOBS;
    else process.env.DISABLE_BACKGROUND_JOBS = previousJobs;
  }
  return summary;
}

function writePlans(
  ownerId: string,
  plans: { id: string; plan: BenchPlan }[],
  now: Date,
): void {
  const statements = new Map<string, Database.Statement>();
  /** Run one statement, prepared once for each SQL text. */
  const run = (sql: string, ...params: unknown[]) => {
    const statement = statements.get(sql) ?? sqlite.prepare(sql);
    statements.set(sql, statement);
    return statement.run(...params);
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

  const writeOne = (contactId: string, plan: BenchPlan) => {
    const keys = { contactId, ownerId };
    for (const table of Object.keys(plan.add))
      run(
        `DELETE FROM ${table} WHERE contactId = ? AND id LIKE 'be-%'`,
        contactId,
      );
    for (const fix of plan.emailLabels)
      run(
        "UPDATE contact_emails SET label = @label WHERE contactId = @contactId AND email = @email",
        { ...fix, ...keys },
      );
    for (const fix of plan.phoneFixes)
      run(
        "UPDATE contact_phones SET phone = @to WHERE contactId = @contactId AND phone = @from",
        { ...fix, ...keys },
      );
    for (const rewrite of plan.interactionRewrites) {
      const row = {
        ...rewrite,
        ...keys,
        updatedAt: sqliteStamp(new Date(rewrite.date)),
      };
      run(
        "UPDATE interactions SET title = @title, content = @content WHERE id = @id AND contactId = @contactId",
        row,
      );
      // A second statement, because the update trigger re-stamps updatedAt with
      // the real clock whenever a statement leaves it alone.
      run(
        "UPDATE interactions SET updatedAt = @updatedAt WHERE id = @id AND contactId = @contactId",
        row,
      );
    }

    // Every stamp is written, never left to the column default, which is the
    // real clock. A second run then writes the same database.
    const addedAt = plan.contact.addedAt ?? sqliteStamp(now);
    const at = sqliteStamp(now);
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
        const values = { ...row, contactId, ...stamps(table, row) };
        const columns = Object.keys(values);
        run(
          `${verb} INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`,
          values,
        );
      }
    }

    // Saved last, and `updatedAt` after the rest. A trigger on each child
    // table stamps the contact's updatedAt with the real clock, and so does
    // the one that stamps `trackedAt`, which writes the real clock there too.
    // A statement that sets `updatedAt` fires neither, so the plan's dates
    // are the final word.
    const { updatedAt, trackedAt, ...columns } = plan.contact;
    const sets = Object.keys(columns).map((key) => `${key} = @${key}`);
    const where = "WHERE id = @contactId AND ownerId = @ownerId";
    if (sets.length > 0)
      run(`UPDATE contacts SET ${sets.join(", ")} ${where}`, {
        ...columns,
        ...keys,
      });
    if (updatedAt)
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

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const now = argValue(args, "--now");
  try {
    const summary = await enrichBenchContacts({
      apply,
      tag: argValue(args, "--tag"),
      owner: argValue(args, "--owner"),
      seed: argValue(args, "--seed"),
      now: now ? new Date(now) : undefined,
    });
    console.log(`Database: ${sqlite.name}`);
    console.log(
      `${apply ? "Enriched" : "Would enrich"} ${summary.contacts} contacts ` +
        `(${summary.generic} generated, whose text is rewritten, and ${summary.curated} hand-written, whose text stays).`,
    );
    for (const [table, n] of Object.entries(summary.rows)) {
      console.log(`  ${table.padEnd(24)} ${n}`);
    }
    if (!apply) {
      console.log("\nThis was a dry run. Add --apply to write it.");
    } else {
      console.log(
        "\nStart the server. It re-indexes the changed contacts at boot, and the first boot scores the tracked ones.",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("enrich-bench-contacts.ts")) void main();
