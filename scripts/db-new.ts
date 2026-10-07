// npm run db:new <name> — start a new migration
// Writes server/db/migrations/NNNN_<name>.ts from the template below, with
// the next free number, and adds it to server/db/migrations/index.ts.
//
//   npm run db:new events_and_jobs
//
// A name is lower case words joined by "_", at most 40 characters, so its
// list line stays one line. The script refuses a bad name, a name a migration
// already has, and a file that already exists.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIR = path.join(ROOT, "server/db/migrations");
const LIST = path.join(DIR, "index.ts");
const NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const MAX_NAME = 40;
const FILE = /^(\d{4})_([a-z0-9_]+)\.ts$/;

function fail(message: string): never {
  console.error(`db:new: ${message}`);
  process.exit(1);
}

function template(id: string): string {
  return `// =============================================================================
// Migration ${id}
// =============================================================================
// Say what this migration changes and why, in a sentence or two.
//
// What a migration may do: create, alter and drop tables, indexes and
// triggers, and move or fix data with SQL. It runs once per database, inside
// one transaction with its row in schema_migrations. If it throws, nothing it
// did is kept, and the server stops with this id in the error.
//
// What it may not do:
// - Import server/db.ts or a service. The code it calls can change later, and
//   this file must keep doing what it did when it shipped. Write the SQL here.
// - Change a migration that has shipped. Write a new one.
// - Run BEGIN, COMMIT, VACUUM, or a PRAGMA that cannot run in a transaction.
// - Build the FTS tables, the vec0 stores or the triggers that feed them. They
//   are rebuilt from code: raise the version in server/db/indexes.ts.
//
// What goes with it:
// - Every table and column it adds, mirrored in server/db/schema.ts, and the
//   name of every object it adds in ADDED_SINCE_FIXTURE in
//   tests/integration/db.migrations.test.ts. That test checks both.
// - A table with ownerId: OWNED_TABLES in server/db.ts and
//   scripts/tenant-lint.mjs, the delete loop of purgeOwner, and its owner
//   triggers here.
// - A new contacts column: drop and create the contacts_auto_updated_at and
//   contacts_score_dirty triggers again, with the column list of
//   contactEditColumns (server/db/helpers.ts).
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(\`
    -- The change goes here.
  \`);
}
`;
}

const args = process.argv.slice(2);
if (args.length !== 1) {
  fail("give one name, for example: npm run db:new events_and_jobs");
}
const name = args[0];
if (!NAME.test(name) || name.length > MAX_NAME) {
  fail(
    `"${name}" is not a migration name. Use lower case words joined by "_", at most ${MAX_NAME} characters.`,
  );
}

const existing = fs
  .readdirSync(DIR)
  .map((file) => FILE.exec(file))
  .filter((match) => match !== null);
const taken = existing.find((match) => match[2] === name);
if (taken) fail(`${taken[0]} already has that name. Pick another.`);

const number = String(
  Math.max(0, ...existing.map((match) => Number(match[1]))) + 1,
).padStart(4, "0");
const id = `${number}_${name}`;
const file = path.join(DIR, `${id}.ts`);
if (fs.existsSync(file)) fail(`${path.relative(ROOT, file)} already exists.`);

// The list gains an import after the last one and an entry at its end.
const list = fs.readFileSync(LIST, "utf8");
const imports = [
  ...list.matchAll(/^import \* as m\d{4} from "\.\/\d{4}_[a-z0-9_]+\.ts";$/gm),
];
const end = list.indexOf("\n];", list.indexOf("export const MIGRATIONS"));
const lastImport = imports.at(-1);
if (!lastImport || end === -1) {
  fail(
    `${path.relative(ROOT, LIST)} does not have the shape this script edits. Add the migration by hand.`,
  );
}
const afterImport = lastImport.index + lastImport[0].length;
const updated =
  list.slice(0, afterImport) +
  `\nimport * as m${number} from "./${id}.ts";` +
  list.slice(afterImport, end) +
  `\n  { id: "${id}", up: m${number}.up },` +
  list.slice(end);

fs.writeFileSync(file, template(id));
fs.writeFileSync(LIST, updated);
console.log(
  `db:new: wrote ${path.relative(ROOT, file)} and added it to ${path.relative(ROOT, LIST)}.`,
);
