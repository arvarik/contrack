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
import { sqlite } from "../server/db.ts";
import { scheduleSearchIndex } from "../server/services/search/indexQueue.ts";
import {
  isGenericAbout,
  planEnrichment,
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
  /** Rows written or changed, by table. */
  rows: Record<string, number>;
}

/** The marker on every row this script writes. */
const SOURCE = "bench-enrich";

/** The `contacts` columns a plan may set. Anything else is a bug in the plan. */
const CONTACT_COLUMNS = new Set([
  "role",
  "headline",
  "about",
  "company",
  "website",
  "birthday",
  "pronouns",
  "preferences",
  "cadenceDays",
  "isTracked",
  "updatedAt",
  "addedAt",
  "lat",
  "lng",
  "geoSource",
]);

/** The tables whose `be-` rows a run removes before it writes them again. */
const OWNED_TABLES = [
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
] as const;

interface ContactRow {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  role: string | null;
  headline: string | null;
  industry: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  about: string | null;
  website: string | null;
  birthday: string | null;
  pronouns: string | null;
  preferences: string | null;
  cadenceDays: number | null;
  isTracked: number;
}

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

function emptyRows(): Record<string, number> {
  return {
    contacts: 0,
    email_labels: 0,
    contact_emails: 0,
    phones_cleaned: 0,
    contact_phones: 0,
    contact_addresses: 0,
    contact_social_links: 0,
    contact_education: 0,
    contact_experience: 0,
    contact_interests: 0,
    contact_attributes: 0,
    interactions_rewritten: 0,
    interactions: 0,
    action_items: 0,
  };
}

function count(rows: Record<string, number>, plan: BenchPlan): void {
  rows.contacts += 1;
  rows.email_labels += plan.emailLabels.length;
  rows.contact_emails += plan.emailsAdd.length;
  rows.phones_cleaned += plan.phoneFixes.length;
  rows.contact_phones += plan.phonesAdd.length;
  rows.contact_addresses += plan.addresses.length;
  rows.contact_social_links += plan.socialLinks.length;
  rows.contact_education += plan.education.length;
  rows.contact_experience += plan.experience.length;
  rows.contact_interests += plan.interests.length;
  rows.contact_attributes += plan.attributes.length;
  rows.interactions_rewritten += plan.interactionRewrites.length;
  rows.interactions += plan.interactionsAdd.length;
  rows.action_items += plan.actionItems.length;
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
    .all(ownerId, tag) as ContactRow[];

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

  const inputOf = (row: ContactRow): BenchInput => ({
    ...row,
    generic: isGenericAbout(row.about),
    interests: (readInterests.all(row.id) as { interest: string }[]).map(
      (r) => r.interest,
    ),
    emails: readEmails.all(row.id) as BenchInput["emails"],
    phones: (readPhones.all(row.id) as { phone: string }[]).map((r) => r.phone),
    interactions: readInteractions.all(row.id) as BenchInput["interactions"],
  });

  const rows = emptyRows();
  const plans = contacts.map((row) => ({
    row,
    plan: planEnrichment(inputOf(row), { seed, now }),
  }));
  for (const { plan } of plans) count(rows, plan);

  const summary: EnrichSummary = {
    applied: options.apply,
    owner: ownerId,
    contacts: contacts.length,
    generic: plans.filter(({ row }) => isGenericAbout(row.about)).length,
    curated: plans.filter(({ row }) => !isGenericAbout(row.about)).length,
    rows,
  };
  if (!options.apply) return summary;

  // `scheduleSearchIndex` would start draining the queue in this process. The
  // server drains it at its next start, so this one only writes the queue.
  const previousJobs = process.env.DISABLE_BACKGROUND_JOBS;
  process.env.DISABLE_BACKGROUND_JOBS = "true";
  try {
    writePlans(ownerId, plans);
  } finally {
    if (previousJobs === undefined) delete process.env.DISABLE_BACKGROUND_JOBS;
    else process.env.DISABLE_BACKGROUND_JOBS = previousJobs;
  }
  return summary;
}

function writePlans(
  ownerId: string,
  plans: { row: ContactRow; plan: BenchPlan }[],
): void {
  const remove = Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      sqlite.prepare(
        `DELETE FROM ${table} WHERE contactId = ? AND id LIKE 'be-%'`,
      ),
    ]),
  );
  const emailTaken = sqlite.prepare(
    `SELECT 1 FROM contact_emails e JOIN contacts c ON c.id = e.contactId
      WHERE c.ownerId = ? AND lower(e.email) = lower(?) LIMIT 1`,
  );
  const phoneTaken = sqlite.prepare(
    `SELECT 1 FROM contact_phones p JOIN contacts c ON c.id = p.contactId
      WHERE c.ownerId = ? AND p.phone = ? LIMIT 1`,
  );
  const insert = {
    email: sqlite.prepare(
      "INSERT INTO contact_emails (id, contactId, email, label, isPrimary, sortOrder, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    phone: sqlite.prepare(
      "INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, sortOrder, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    address: sqlite.prepare(
      "INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, sortOrder, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    social: sqlite.prepare(
      "INSERT INTO contact_social_links (id, contactId, platform, url, handle, source) VALUES (?, ?, ?, ?, ?, ?)",
    ),
    education: sqlite.prepare(
      "INSERT INTO contact_education (id, contactId, school, degree, fieldOfStudy, startDate, endDate, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    experience: sqlite.prepare(
      "INSERT INTO contact_experience (id, contactId, company, role, startDate, endDate, isCurrent, location, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    interest: sqlite.prepare(
      "INSERT OR IGNORE INTO contact_interests (id, contactId, interest, isAiGenerated) VALUES (?, ?, ?, 0)",
    ),
    attribute: sqlite.prepare(
      "INSERT OR IGNORE INTO contact_attributes (id, contactId, name, value) VALUES (?, ?, ?, ?)",
    ),
    interaction: sqlite.prepare(
      "INSERT INTO interactions (id, contactId, type, title, content, date, ownerId) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ),
    action: sqlite.prepare(
      "INSERT INTO action_items (id, contactId, title, dueAt, completedAt, ownerId) VALUES (?, ?, ?, ?, ?, ?)",
    ),
  };
  const relabel = sqlite.prepare(
    "UPDATE contact_emails SET label = ? WHERE contactId = ? AND email = ?",
  );
  const rephone = sqlite.prepare(
    "UPDATE contact_phones SET phone = ? WHERE contactId = ? AND phone = ?",
  );
  const rewrite = sqlite.prepare(
    "UPDATE interactions SET title = ?, content = ? WHERE id = ? AND contactId = ?",
  );

  const writeOne = (id: string, plan: BenchPlan) => {
    for (const table of OWNED_TABLES) remove[table].run(id);

    for (const { email, label } of plan.emailLabels)
      relabel.run(label, id, email);
    for (const { from, to } of plan.phoneFixes) rephone.run(to, id, from);
    for (const r of plan.emailsAdd) {
      if (emailTaken.get(ownerId, r.email)) continue;
      insert.email.run(
        r.id,
        id,
        r.email,
        r.label,
        r.isPrimary,
        r.sortOrder,
        SOURCE,
      );
    }
    for (const r of plan.phonesAdd) {
      if (phoneTaken.get(ownerId, r.phone)) continue;
      insert.phone.run(
        r.id,
        id,
        r.phone,
        r.label,
        r.isPrimary,
        r.sortOrder,
        SOURCE,
      );
    }
    for (const r of plan.addresses)
      insert.address.run(
        r.id,
        id,
        r.address,
        r.label,
        r.isPrimary,
        r.sortOrder,
        SOURCE,
      );
    for (const r of plan.socialLinks)
      insert.social.run(r.id, id, r.platform, r.url, r.handle, SOURCE);
    for (const r of plan.education)
      insert.education.run(
        r.id,
        id,
        r.school,
        r.degree,
        r.fieldOfStudy,
        r.startDate,
        r.endDate,
        SOURCE,
      );
    for (const r of plan.experience)
      insert.experience.run(
        r.id,
        id,
        r.company,
        r.role,
        r.startDate,
        r.endDate,
        r.isCurrent,
        r.location,
        SOURCE,
      );
    for (const r of plan.interests) insert.interest.run(r.id, id, r.interest);
    for (const r of plan.attributes)
      insert.attribute.run(r.id, id, r.name, r.value);
    for (const r of plan.interactionRewrites)
      rewrite.run(r.title, r.content, r.id, id);
    for (const r of plan.interactionsAdd)
      insert.interaction.run(
        r.id,
        id,
        r.type,
        r.title,
        r.content,
        r.date,
        ownerId,
      );
    for (const r of plan.actionItems)
      insert.action.run(r.id, id, r.title, r.dueAt, r.completedAt, ownerId);

    // Saved last, and `updatedAt` after the rest. A trigger on each child
    // table stamps the contact's updatedAt with the real clock, and so does
    // the one that stamps `trackedAt`. A statement that sets `updatedAt`
    // alone fires neither, so the plan's date is the final word.
    const sets = Object.keys(plan.contact).filter((key) => key !== "updatedAt");
    for (const key of Object.keys(plan.contact)) {
      if (!CONTACT_COLUMNS.has(key))
        throw new Error(
          `The plan sets "${key}", which is not a column it may set.`,
        );
    }
    if (plan.lastContactedAt) sets.push("lastContactedAt");
    if (sets.length > 0) {
      const values = sets.map((key) =>
        key === "lastContactedAt" ? plan.lastContactedAt : plan.contact[key],
      );
      sqlite
        .prepare(
          `UPDATE contacts SET ${sets.map((key) => `${key} = ?`).join(", ")} WHERE id = ? AND ownerId = ?`,
        )
        .run(...values, id, ownerId);
    }
    if (plan.contact.updatedAt) {
      sqlite
        .prepare(
          "UPDATE contacts SET updatedAt = ? WHERE id = ? AND ownerId = ?",
        )
        .run(plan.contact.updatedAt, id, ownerId);
    }

    scheduleSearchIndex(id);
  };

  const BATCH = 250;
  for (let start = 0; start < plans.length; start += BATCH) {
    sqlite.transaction(() => {
      for (const { row, plan } of plans.slice(start, start + BATCH))
        writeOne(row.id, plan);
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

const isDirectRun =
  process.argv[1] && process.argv[1].endsWith("enrich-bench-contacts.ts");

if (isDirectRun) {
  void main();
}
