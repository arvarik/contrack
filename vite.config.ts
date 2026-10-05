import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      // The dev server serves any file under the project folder, which is
      // also the data folder when DATA_DIR is unset: `GET /curator.db` sent
      // the whole database. A list here replaces Vite's own, so the first
      // six are Vite 8's defaults. A pattern with a slash is matched against
      // the whole path, hence the leading `**/`.
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
         * One chunk per large library, so a page loads only the libraries
         * it uses and a release that touches one of them invalidates one
         * file.
         *
         * Rolldown's groups, not Rollup's `manualChunks`: a group here also
         * captures the dependencies of what it matches, and the first group
         * to capture a module keeps it. Under the old function React itself
         * was captured through its importers, `react-dom` by the map's
         * group, and every page preloaded a megabyte of MapLibre to get
         * React. The React group has the highest priority so it wins those
         * modules back. The map's group captures no dependencies at all:
         * react-maplibre imports MapLibre lazily, and the helper Vite writes
         * for a lazy import is used by every page, so through it the map's
         * chunk was still on every page. The group names the one dependency
         * it wants, the compression library PMTiles reads with.
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
