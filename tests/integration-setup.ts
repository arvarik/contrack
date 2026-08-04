// =============================================================================
// Integration test setup — real SQLite database in an isolated temp directory
// =============================================================================
// Runs BEFORE each integration test file imports any server module, so
// server/db.ts opens its database (and creates uploads/) inside a fresh
// temp DATA_DIR instead of the repo root. Each test file gets its own
// directory — vitest isolates module state per file, so each file also gets
// its own database connection, migrations, and FTS index.
// =============================================================================

import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-int-"));

// Force AI mock mode — integration tests must never hit live providers.
process.env.AI_PROVIDER = "gemini";
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.MAPBOX_API_KEY;

// Suppress fire-and-forget background work (geocoding fetches, debounced
// dedupe timers) that would outlive the test file or hit the network.
process.env.DISABLE_BACKGROUND_JOBS = "true";
