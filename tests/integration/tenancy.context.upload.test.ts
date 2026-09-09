// =============================================================================
// Integration Tests — request context across multer
// =============================================================================
// Open question T25: multer issue #1111 reports that the AsyncLocalStorage
// context is lost in the route handler after upload.single() when the
// multipart body ALSO carries a text field. The upload routes carry no text
// fields today, so the plan could not reproduce it and left a fallback.
//
// This test settles it on the installed multer, with one text field and one
// file, and records the answer for Phase 1. If the handler assertion ever
// fails, the two upload handlers must read the scope from req.principal
// instead of the context.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import multer from "multer";
import request from "supertest";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import {
  attachRequestContext,
  getContext,
} from "../../server/tenancy/requestContext.ts";

const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";

/** Where each multer callback and the handler saw the owner, or null. */
const seen: Record<string, string | null | undefined> = {};
let server: http.Server;
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contrack-ctx-"));

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      seen.destination = getContext()?.scope?.ownerId ?? null;
      cb(null, tmp);
    },
    filename: (_req, _file, cb) => {
      seen.filename = getContext()?.scope?.ownerId ?? null;
      cb(null, `probe-${Date.now()}.txt`);
    },
  });
  const upload = multer({ storage, limits: { fileSize: 1024 * 1024 } });

  const app = express();
  // Stand in for attachPrincipal, then run the real context middleware.
  app.use((req, _res, next) => {
    req.requestId = "ctx-test";
    req.principal = {
      via: "session",
      kind: "user",
      user: { id: OWNER } as never,
      sessionId: "s",
    };
    next();
  });
  app.use(attachRequestContext);

  app.post("/probe", upload.single("file"), (req, res) => {
    seen.handler = getContext()?.scope?.ownerId ?? null;
    res.json({
      field: req.body?.note ?? null,
      file: req.file?.filename ?? null,
    });
  });

  server = app.listen(0);
});

afterAll(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("request context survives multer", () => {
  it("is intact in destination, in filename, and in the handler, with a text field present", async () => {
    const res = await request(server)
      .post("/probe")
      .field("note", "one text field, which is the T25 trigger")
      .attach("file", Buffer.from("hello"), "probe.txt");

    expect(res.status).toBe(200);
    // The multipart body really did carry both parts.
    expect(res.body.field).toBe("one text field, which is the T25 trigger");
    expect(res.body.file).toMatch(/^probe-/);

    expect(seen.destination).toBe(OWNER);
    expect(seen.filename).toBe(OWNER);
    // T25: this is the assertion multer issue #1111 predicts might fail.
    expect(seen.handler).toBe(OWNER);
  });
});
