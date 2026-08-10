// =============================================================================
// Integration test setup — real SQLite database in an isolated temp directory
// =============================================================================
// Runs BEFORE each integration test file imports any server module, so
// server/db.ts opens its database (and creates uploads/) inside a fresh
// temp DATA_DIR instead of the repo root. Each test file gets its own
// directory — vitest isolates module state per file, so each file also gets
// its own database connection, migrations, and FTS index.
// =============================================================================

import { vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * Integration tests use the REAL database. Said explicitly, because the unit
 * project's setup (tests/setup.ts) replaces `server/db.ts` with stubs whose
 * `get()` returns undefined, and `npm test` runs both projects in one command.
 *
 * When a worker carried that mock into an integration file, the symptoms were
 * a 404 where a 400 was expected and a contact with no `lastContactedAt`:
 * nothing that points at a mocked database, which is what made it expensive to
 * chase. Declaring the unmock costs nothing and removes the possibility.
 * `makeTestApp` also asserts the connection is real, so if this ever stops
 * working the failure names itself.
 */
vi.unmock("../server/db.ts");

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-int-"));

// Force AI mock mode — integration tests must never hit live providers.
//
// These are set to "" rather than deleted on purpose: server modules call
// `import "dotenv/config"`, and dotenv only fills variables that are *unset*.
// Deleting them would let the developer's real .env keys leak into the test
// run (and reach live provider APIs); an empty value is both "not configured"
// to our credential checks and immune to dotenv repopulating it.
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.MAPBOX_API_KEY = "";
process.env.AUTH_TOKEN = "";
process.env.AUTH_REQUIRED = "";

// Suppress fire-and-forget background work (geocoding fetches, debounced
// dedupe timers) that would outlive the test file or hit the network.
process.env.DISABLE_BACKGROUND_JOBS = "true";
