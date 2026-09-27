import { fileURLToPath } from "node:url";
import path from "node:path";

/** The repository root, however this file is loaded. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Where a spec saves a screenshot for the docs: `docs/screenshots/<folder>/`
 * when the run sets `DOCS_SCREENSHOTS=1`, and otherwise the same folder under
 * `test-results/`, which git ignores. Every run still takes the picture, and
 * fails when it cannot. Only a run that asks for it rewrites the committed
 * images: fonts and timing move a few pixels on every run, so each full run
 * of the suite left changed PNGs in the tree.
 */
export function docsScreenshotDir(folder: string): string {
  return path.join(
    REPO_ROOT,
    process.env.DOCS_SCREENSHOTS
      ? "docs/screenshots"
      : "test-results/docs-screenshots",
    folder,
  );
}
