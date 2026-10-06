// Integration test setup: a real SQLite database in a temp directory.
// Runs before each integration file imports a server module, so server/db.ts
// opens its database (and creates uploads/) in a fresh temp DATA_DIR. Vitest
// isolates module state per file, so each file gets its own database.

import { vi } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * Integration tests use the real database. The unit setup (tests/setup.ts)
 * stubs `server/db.ts`, and `npm test` runs both projects in one command, so
 * a worker could carry that mock into an integration file and fail in ways
 * that never point at it. `makeTestApp` also asserts the connection is real.
 */
vi.unmock("../server/db.ts");

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-int-"));

// Force AI mock mode — integration tests must never hit live providers.
//
// These are set to "" rather than deleted on purpose: server modules import
// server/utils/loadEnv.ts, and it only fills variables that are *unset*.
// Deleting them would let the developer's real .env keys leak into the test
// run (and reach live provider APIs); an empty value is both "not configured"
// to our credential checks and immune to .env repopulating it.
process.env.AI_PROVIDER = "gemini";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
process.env.AUTH_REQUIRED = "";

// Suppress fire-and-forget background work (geocoding fetches, debounced
// dedupe timers) that would outlive the test file or hit the network.
process.env.DISABLE_BACKGROUND_JOBS = "true";
