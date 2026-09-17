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
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== "true",
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
              name: "vendor-tiptap",
              test: /\/node_modules\/(@tiptap|prosemirror)/,
            },
            {
              name: "vendor-maplibre",
              test: (id: string) =>
                id.includes("/node_modules/") &&
                (id.includes("maplibre") ||
                  id.includes("react-map-gl") ||
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
