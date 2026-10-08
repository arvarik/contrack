// The web app: Vite's middleware in development, the built files in production.

import type http from "node:http";
import path from "node:path";
import express, { type Express } from "express";

/** Stops what `serveClient` started. */
export type CloseClient = () => Promise<void>;

/** The addresses that only this machine can reach. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Refuse to run the development server on an address other machines reach.
 * Vite's middleware serves the files under the project folder, and without
 * `DATA_DIR` the database is one of them: `GET /curator.db` would answer with
 * the whole database and no sign-in. `server.fs.deny` in `vite.config.ts`
 * refuses the data files too. The production build serves `dist/` only.
 */
export function assertDevHost(host: string, production: boolean): void {
  if (production || LOOPBACK_HOSTS.has(host.toLowerCase())) return;
  throw new Error(
    `HOST is "${host}", and the development server listens on this machine only. To serve other machines, run the production build: npm run build, then NODE_ENV=production node server.ts`,
  );
}

/**
 * Serve the web app on `app`, which `server` listens for. In development,
 * Vite's middleware, with its reload socket on `server`: Vite's own default
 * socket on port 24678 cannot be shared by two dev servers, and the second
 * one's page would dial the first one's socket even with hot reload off. On the
 * app's own server, each page dials the port it came from. In production, the
 * files in `distPath`, and `index.html` for any other page.
 */
export async function serveClient(
  app: Express,
  server: http.Server,
  options: { production: boolean; distPath?: string },
): Promise<CloseClient> {
  if (!options.production) {
    // Lazy import: vite is a devDependency and must never enter the
    // production module graph (the Docker image installs --omit=dev).
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true, ws: { server } },
      appType: "spa",
    });
    app.use(vite.middlewares);
    return () => vite.close();
  }

  const distPath = options.distPath ?? path.join(process.cwd(), "dist");
  // Vite names every file under /assets by its content hash, so it never
  // changes: a browser keeps it a year and does not revalidate (a phone would
  // otherwise send about 85 revalidations per load). The rest, index.html
  // first, is checked every time, so a deploy shows at once.
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  // A file the build no longer has, such as an old chunk an open tab asks for
  // after a deploy, is a plain 404, never the app's HTML, which the browser
  // would try to run as script.
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });
  // The render-blocking boot script carries its content hash (`?v=`, from
  // vite.config.ts), so a browser keeps that copy a year, as it does /assets.
  // A request with no hash, from a page built before, revalidates as before.
  app.get("/theme-boot.js", (req, res, next) => {
    if (typeof req.query.v !== "string") return next();
    res.sendFile("theme-boot.js", {
      root: distPath,
      maxAge: "1y",
      immutable: true,
    });
  });
  app.use(express.static(distPath));
  // The SPA fallback answers navigation only (GET and HEAD). A POST to an
  // unknown path answered with index.html and a 200 would read as success to a
  // script that mistyped an endpoint.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // A path under `root`, not an absolute one: `send` refuses an absolute path
    // with a dot folder in it, such as ~/.local/contrack/dist, which would make
    // every page answer 500.
    res.sendFile("index.html", { root: distPath });
  });
  return async () => {};
}
