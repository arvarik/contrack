const { AsyncLocalStorage } = require("node:async_hooks");
const express = require("express");
const multer = require("multer");
const http = require("http");
const { EventEmitter } = require("events");
const os = require("os"); const path = require("path"); const fs = require("fs");
const als = new AsyncLocalStorage();
const app = express();
app.use((req, res, next) => { als.run({ id: req.headers["x-id"] }, () => next()); });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alsm-"));
const seen = {};
const upload = multer({ storage: multer.diskStorage({
  destination(req, file, cb) { seen.destination = als.getStore()?.id ?? null; cb(null, dir); },
  filename(req, file, cb) { seen.filename = als.getStore()?.id ?? null; cb(null, "f.bin"); },
})});
app.post("/up", upload.single("file"), (req, res) => { seen.handler = als.getStore()?.id ?? null; res.json(seen); });
const em = new EventEmitter();
app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  const listener = () => { res.write(`data: ${als.getStore()?.id ?? "null"}\n\n`); res.end(); };
  em.once("tick", listener);
  setTimeout(() => em.emit("tick"), 10); // emitted from within the request's async chain
});
app.get("/sse-external", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  em.once("ext", () => { res.write(`data: ${als.getStore()?.id ?? "null"}\n\n`); res.end(); });
  // emitter fired from a timer created OUTSIDE any request context
});
app.get("/stream", async (req, res) => {
  // NDJSON-style: await then write
  await new Promise(r => setImmediate(r));
  await Promise.all([new Promise(r => setTimeout(r, 5))]);
  res.json({ afterAwait: als.getStore()?.id ?? null });
});
const server = http.createServer(app).listen(0, async () => {
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const fd = new FormData(); fd.append("file", new Blob([Buffer.alloc(1024*64, 1)]), "x.bin");
  const r1 = await fetch(base + "/up", { method: "POST", headers: { "x-id": "user-A" }, body: fd });
  console.log("multer:", await r1.text());
  const r2 = await fetch(base + "/sse", { headers: { "x-id": "user-B" } });
  console.log("sse (emit from request chain):", (await r2.text()).trim());
  const p3 = fetch(base + "/sse-external", { headers: { "x-id": "user-C" } });
  setTimeout(() => em.emit("ext"), 50); // fired from top-level, outside any ALS.run
  console.log("sse (emit from outside):", (await (await p3).text()).trim());
  const r4 = await fetch(base + "/stream", { headers: { "x-id": "user-D" } });
  console.log("ndjson-style after await:", await r4.text());
  server.close();
});
