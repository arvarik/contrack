/**
 * Runs once before any worker starts. The instances the fixtures boot serve
 * `dist/`, so a missing build fails here, with the fix, rather than sixty
 * seconds later as a page that never becomes ready.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./fixtures/paths";

export default function globalSetup(): void {
  const index = path.join(REPO_ROOT, "dist", "index.html");
  if (!existsSync(index)) {
    throw new Error(
      "No production build at dist/index.html. Run `npm run build` first: " +
        "the browser suite serves the built app, the same files a release ships.",
    );
  }
}
