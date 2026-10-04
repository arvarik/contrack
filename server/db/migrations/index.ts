// =============================================================================
// Every migration, in the order it runs
// =============================================================================
// server/db/runner.ts applies each one that has no row in schema_migrations,
// in this order. `npm run db:new <name>` writes the next numbered file and
// adds its two lines here. Never reorder, rename or remove an entry that a
// release has run: a database that holds an id this list lacks refuses to
// start.
// =============================================================================

import type { Migration } from "../runner.ts";
import * as m0001 from "./0001_baseline.ts";
import * as m0002 from "./0002_events_and_jobs.ts";
import * as m0003 from "./0003_map_pins.ts";

export const MIGRATIONS: readonly Migration[] = [
  { id: "0001_baseline", up: m0001.up },
  { id: "0002_events_and_jobs", up: m0002.up },
  { id: "0003_map_pins", up: m0003.up },
];

/** The last migration this build holds. A database that is up to date has it. */
export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1].id;
