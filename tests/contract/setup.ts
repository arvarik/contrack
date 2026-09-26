// =============================================================================
// Contract test setup — a throwaway data directory
// =============================================================================
// The adapters read their discovered-model cache through settingsService,
// which imports server/db.ts, which opens DATA_DIR/curator.db at import time.
// Without this, `npm run test:contract` from the repo root opened the
// developer's own database and ran its boot migrations. The provider keys are
// left alone: this project exists to call the real APIs.
// =============================================================================

import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "contrack-contract-"));
process.env.DISABLE_BACKGROUND_JOBS = "true";
