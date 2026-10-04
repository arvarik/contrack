// =============================================================================
// The web app: Vite's middleware in development, the built files in production
// =============================================================================

import type http from "node:http";
import path from "node:path";
import express, { type Express } from "express";

/** Stops what `serveClient` started. */
export type CloseClient = () => Promise<void>;

/**
 * Serve the web app on `app`, which `server` listens for.
 *
 * In development, Vite's middleware, with its reload socket on `server`.
 * Vite's default in middleware mode is a socket of its own on port 24678.
 * Two dev servers cannot share that port, and the page of the second one
 * dialled the first one's socket even with hot reload off. On the app's own
 * server, each page dials the port it came from.
 *
 * In production, the files in `distPath`, and `index.html` for any other
 * page a person opens.
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
  // Vite names every file under /assets by the hash of its content, so a
  // file there never changes. A browser keeps it for a year and asks no
  // more: a phone used to send some 85 revalidations on every load. The
  // rest, index.html first, is checked every time, so a deploy shows at
  // once.
  app.use(
    "/assets",
    express.static(path.join(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );
  // A file the build no longer has, such as an old chunk an open tab asks
  // for after a deploy, is a plain 404. Never the app's HTML, which the
  // browser would try to run as script.
  app.use("/assets", (_req, res) => {
    res.status(404).type("text/plain").send("Not found");
  });
  app.use(express.static(distPath));
  // SPA fallback for navigation only. This used to answer EVERY method —
  // a POST to any unknown path returned index.html with a 200, which reads
  // as success to a script that mistyped an endpoint.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    // A path under `root`, not an absolute one: `send` refuses an absolute
    // path with a dot folder in it, such as ~/.local/contrack/dist, and
    // every page a person opened answered 500.
    res.sendFile("index.html", { root: distPath });
  });
  return async () => {};
}
