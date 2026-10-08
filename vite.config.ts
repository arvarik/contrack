import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, type Plugin } from "vite";

/** The render-blocking boot script's tag in index.html. */
const THEME_BOOT_TAG = '<script src="/theme-boot.js"></script>';

/**
 * Vite does not hash `public/` files, so a phone revalidated the
 * render-blocking `theme-boot.js` on every start: one round trip before the
 * app's code ran. The build puts the file's hash in the tag (`?v=`), and the
 * server lets a browser keep that copy a year (`server/serveClient.ts`).
 */
const versionThemeBoot = (): Plugin => ({
  name: "version-theme-boot",
  apply: "build",
  transformIndexHtml(html) {
    if (!html.includes(THEME_BOOT_TAG))
      throw new Error(`index.html has no ${THEME_BOOT_TAG}`);
    const hash = createHash("sha256")
      .update(
        readFileSync(path.resolve(import.meta.dirname, "public/theme-boot.js")),
      )
      .digest("hex")
      .slice(0, 10);
    return html.replace(
      THEME_BOOT_TAG,
      `<script src="/theme-boot.js?v=${hash}"></script>`,
    );
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), versionThemeBoot()],
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: this config is ESM, and Vite's
      // native config loader warns on the CJS global at every boot.
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  server: {
    // DISABLE_HMR=true turns hot reload off. The reload socket shares the
    // app's own port (`serveClient`), so a second dev server works either way.
    hmr: process.env.DISABLE_HMR !== "true",
    fs: {
      // The dev server serves any file under the project folder, which is the
      // data folder when DATA_DIR is unset, so `GET /curator.db` would send the
      // database. This list replaces Vite's own, so the first six are Vite 8's
      // defaults. A pattern with a slash matches the whole path, hence `**/`.
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "*.db",
        "*.db-wal",
        "*.db-shm",
        "secret.key",
        "**/backups/**",
        "**/uploads/**",
      ],
    },
  },
  // MapLibre's worker is an ES module (`maplibreWorker.ts` bundles it with
  // `?worker&url`), and MapLibre starts it as a module worker.
  worker: {
    format: "es",
  },
  build: {
    rolldownOptions: {
      output: {
        /*
         * One chunk per large library, so a page loads only what it uses.
         *
         * A Rolldown group also captures the dependencies of what it matches,
         * and the first group to capture a module keeps it. The React group
         * ranks highest, so no other group captures React. The map's group
         * captures no dependencies: through Vite's lazy-import helper, used
         * by every page, it would put the map on every page. It names the one
         * dependency it wants, the compression library PMTiles reads with.
         */
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /\/node_modules\/(react|react-dom|scheduler)\//,
              priority: 10,
            },
            {
              // TipTap's group would take this as one of its dependencies,
              // and `InfoTip` uses it on every page, so every page preloaded
              // the editor. Its own group, ranked above TipTap's, wins it.
              name: "vendor-floating-ui",
              test: /\/node_modules\/@floating-ui\//,
              priority: 5,
            },
            {
              name: "vendor-tiptap",
              test: /\/node_modules\/(@tiptap|prosemirror)/,
            },
            {
              name: "vendor-maplibre",
              test: (id: string) =>
                id.includes("/node_modules/") &&
                // "maplibre" also matches @vis.gl/react-maplibre.
                (id.includes("maplibre") ||
                  id.includes("pmtiles") ||
                  id.includes("/fflate/")),
              includeDependenciesRecursively: false,
            },
            { name: "vendor-chrono", test: /\/node_modules\/chrono-node\// },
            { name: "vendor-lucide", test: /\/node_modules\/lucide-react\// },
            {
              name: "vendor-motion",
              test: (id: string) =>
                id.includes("/node_modules/") && id.includes("motion"),
            },
            { name: "vendor-tanstack", test: /\/node_modules\/@tanstack\// },
          ],
        },
      },
    },
  },
});
