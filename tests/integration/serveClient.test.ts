// =============================================================================
// Integration: how the server serves the web app (server/serveClient.ts)
// =============================================================================
// In production the server sends dist/, and index.html for any page a person
// opens, wherever the app is installed. In development Vite's reload socket
// sits on the app's own server, so a page dials the port it came from and
// never the socket of another dev server on the same machine.
// =============================================================================

import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { serveClient, type CloseClient } from "../../server/serveClient.ts";

const started: { server: http.Server; close: CloseClient }[] = [];

afterEach(async () => {
  for (const { server, close } of started.splice(0)) {
    await close();
    await new Promise((done) => server.close(done));
  }
});

/** An app that serves the client, listening on a free port. */
async function start(options: Parameters<typeof serveClient>[2]) {
  const app = express();
  const server = http.createServer(app);
  const close = await serveClient(app, server, options);
  app.use((_req, res) => res.status(404).end());
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  started.push({ server, close });
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("in production", () => {
  it("sends index.html for every page when the install path has a dot folder", async () => {
    // ~/.local/contrack is such a path. `send` refused the absolute path to
    // index.html there, and every page a person opened answered 500.
    const distPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "contrack-")),
      ".local",
      "dist",
    );
    fs.mkdirSync(path.join(distPath, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(distPath, "index.html"),
      "<!doctype html><title>Contrack</title>",
    );
    fs.writeFileSync(path.join(distPath, "assets", "app.js"), "export {};");
    const host = await start({ production: true, distPath });

    for (const page of ["/", "/search", "/contact/abc"]) {
      const res = await fetch(`http://${host}${page}`);
      expect(res.status, page).toBe(200);
      expect(await res.text(), page).toContain("<title>Contrack</title>");
    }
    expect((await fetch(`http://${host}/assets/app.js`)).status).toBe(200);
    // Navigation only: a POST to a page's address is no page.
    const post = await fetch(`http://${host}/search`, { method: "POST" });
    expect(post.status).toBe(404);
  });
});

describe("in development", () => {
  it("puts the reload socket on the app's own port, so a page never dials 24678", async () => {
    const host = await start({ production: false });

    // The client the page loads dials the port the page came from.
    const client = await (await fetch(`http://${host}/@vite/client`)).text();
    expect(client).toContain("const hmrPort = null;");
    const token = /const wsToken = "([^"]+)";/.exec(client)?.[1];
    expect(token).toBeTruthy();

    // The app's own server answers on that socket.
    const socket = new WebSocket(`ws://${host}/?token=${token}`, "vite-hmr");
    const first = await new Promise<string>((resolve, reject) => {
      socket.onmessage = (event) => resolve(String(event.data));
      socket.onerror = () => reject(new Error("The socket did not open"));
    });
    socket.close();
    expect(JSON.parse(first)).toMatchObject({ type: "connected" });
  }, 60_000);
});
