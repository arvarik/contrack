import { fileURLToPath } from "node:url";
import path from "node:path";

/** The repository root, however this file is loaded. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
