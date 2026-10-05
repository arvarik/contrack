// =============================================================================
// Derived structures and their versions
// =============================================================================
// The FTS tables, the vec0 stores, the passage index and the triggers that
// feed them are built from other tables, so they are rebuilt, not migrated.
// Each has an `index` row in schema_migrations with the version it is built
// at. installIndexes runs every installer on every boot, after the
// migrations, in the order below, which is the order the boot ran them in
// before the ledger. An installer creates what is missing, catches up rows
// that are missing, and creates its triggers again. The version decides only
// whether it rebuilds:
//
//   contacts_fts          FTS_SCHEMA_VERSION. A different recorded version
//                         drops and refills contacts_fts and interactions_fts
//                         (installSearchIndex in services/search/ftsIndex.ts).
//   search_embeddings,    1. A store whose DDL is not the current shape is
//   contact_embeddings    read out, dropped and built again (rebuildVecTable
//                         in server/db/vec.ts), whatever the version says.
//   search_passages_fts   1. installPassageIndex
//   search_index_queue    1. installSearchVectorTriggers
//
// Only contacts_fts rebuilds when its version changes. A later change that
// needs another structure rebuilt raises that version here and gives its
// installer the rebuild.
// =============================================================================

import type Database from "better-sqlite3";
import {
  FTS_SCHEMA_VERSION,
  installSearchIndex,
  installSearchVectorTriggers,
} from "../services/search/ftsIndex.ts";
import { installPassageIndex } from "../services/search/passageIndex.ts";
import { readIndexVersion, recordIndexVersion } from "./runner.ts";
import { installVectorStores, vecTableWidth } from "./vec.ts";

/** A derived structure's row in schema_migrations, at this build's version. */
export interface IndexVersion {
  id: string;
  version: number;
}

interface Installer {
  /** The rows this installer builds. */
  indexes: readonly IndexVersion[];
  install: (db: Database.Database) => void;
}

const INSTALLERS: readonly Installer[] = [
  {
    indexes: [{ id: "contacts_fts", version: FTS_SCHEMA_VERSION }],
    install: installSearchIndex,
  },
  {
    indexes: [
      { id: "search_embeddings", version: 1 },
      { id: "contact_embeddings", version: 1 },
    ],
    install: installVectorStores,
  },
  {
    indexes: [{ id: "search_passages_fts", version: 1 }],
    install: (db) =>
      installPassageIndex(db, Number(vecTableWidth(db, "search_embeddings"))),
  },
  {
    indexes: [{ id: "search_index_queue", version: 1 }],
    install: installSearchVectorTriggers,
  },
];

/** Every index row this build expects. */
export const INDEXES: readonly IndexVersion[] = INSTALLERS.flatMap(
  (installer) => installer.indexes,
);

/** Run every installer, then record the version each one built. */
export function installIndexes(db: Database.Database): void {
  for (const installer of INSTALLERS) {
    installer.install(db);
    for (const index of installer.indexes) {
      recordIndexVersion(db, index.id, index.version);
    }
  }
}

/** Each index row: the version the database records, 0 with no row, and the one this build expects. */
export function indexVersions(
  db: Database.Database,
): { id: string; version: number; expected: number }[] {
  return INDEXES.map((index) => ({
    id: index.id,
    version: readIndexVersion(db, index.id) ?? 0,
    expected: index.version,
  }));
}
