#!/usr/bin/env node
// =============================================================================
// tenancy-rollback-uploads — put uploads back where 1.x expects them
// =============================================================================
// Step 3 of the rollback in docs/multi-tenant-plan/04-data-model-and-migration.md
// section 12. The full procedure is:
//
//   1. Stop the server.
//   2. Replace DATA_DIR/curator.db with backups/pre-tenancy-<stamp>.db, and
//      delete curator.db-wal and curator.db-shm.
//   3. Run this script.
//   4. Start the 1.x image.
//
// Order matters. The restored 1.x database holds the OLD flat URLs, so this
// reads that database to learn which file belongs where, and moves each file
// from uploads/u/<ownerId>/... back to the flat directory. Running it before
// the restore would read the 2.0 database, whose URLs already point at the new
// layout, and it would find nothing to do.
//
//   DATA_DIR=/path/to/data node scripts/tenancy-rollback-uploads.mjs
//   DATA_DIR=/path/to/data node scripts/tenancy-rollback-uploads.mjs --dry-run
// =============================================================================

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = process.env.DATA_DIR ?? process.cwd();
const DB_PATH = path.join(DATA_DIR, "curator.db");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Restore the backup first.`);
  process.exit(2);
}

const db = new Database(DB_PATH, { readonly: true });

/** Find a file that the 1.x database expects at `flatPath`, wherever it is now. */
function findMoved(filename, kind) {
  const root = path.join(UPLOADS_DIR, "u");
  if (!fs.existsSync(root)) return null;
  for (const owner of fs.readdirSync(root)) {
    const candidate = path.join(root, owner, kind, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function restore(urls, kind, destDir) {
  let moved = 0;
  let already = 0;
  let missing = 0;
  for (const url of urls) {
    if (typeof url !== "string" || !url.startsWith("/uploads/")) continue;
    const filename = path.basename(url);
    const target = path.join(destDir, filename);
    if (fs.existsSync(target)) {
      already++;
      continue;
    }
    const source = findMoved(filename, kind);
    if (!source) {
      missing++;
      console.warn(`  missing: ${filename} (expected at ${url})`);
      continue;
    }
    if (!dryRun) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(source, target);
    }
    console.log(`  ${dryRun ? "would move" : "moved"}: ${source} -> ${target}`);
    moved++;
  }
  return { moved, already, missing };
}

const avatarUrls = db
  .prepare(
    `SELECT avatarUrl AS url FROM contacts WHERE avatarUrl LIKE '/uploads/avatars/%'`,
  )
  .all()
  .map((r) => r.url);

const fileUrls = db
  .prepare(
    `SELECT fileUrl AS url FROM interactions
      WHERE fileUrl LIKE '/uploads/%'
        AND fileUrl NOT LIKE '/uploads/u/%'
        AND fileUrl NOT LIKE '/uploads/logos/%'`,
  )
  .all()
  .map((r) => r.url);

db.close();

console.log(
  `tenancy-rollback-uploads: ${DB_PATH}${dryRun ? " (dry run)" : ""}`,
);
console.log(
  `  ${avatarUrls.length} avatar URL(s), ${fileUrls.length} attachment URL(s) in the restored database\n`,
);

const avatars = restore(
  avatarUrls,
  "avatars",
  path.join(UPLOADS_DIR, "avatars"),
);
const files = restore(fileUrls, "files", UPLOADS_DIR);

console.log("");
console.log(
  `  avatars:     ${avatars.moved} moved, ${avatars.already} already in place, ${avatars.missing} missing`,
);
console.log(
  `  attachments: ${files.moved} moved, ${files.already} already in place, ${files.missing} missing`,
);
if (avatars.missing + files.missing > 0) {
  console.error(
    "\nSome files the restored database references were not found. Check uploads/orphaned/ before starting 1.x.",
  );
  process.exit(1);
}
console.log("\nUploads are back in the 1.x layout. Start the 1.x image.");
