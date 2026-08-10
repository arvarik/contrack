// =============================================================================
// Integration: request-surface hardening — body limits and response headers
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("body size limits", () => {
  it("refuses an oversized body on an ordinary route with a 413", async () => {
    // parse-contact takes pasted text; nothing legitimate pastes 1.2 MB.
    // Before the split this was accepted — every route inherited the 50 MB
    // limit sized for bulk import, unauthenticated routes included.
    const res = await request(app)
      .post("/api/parse-contact")
      .send({ text: "x".repeat(1_200_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("still accepts a multi-megabyte payload on the bulk import route", async () => {
    // 1.5 MB of body with one invalid entry: a 400 from validation proves the
    // PARSER let the body through — a 413 would mean the exemption is gone.
    // Validation failure keeps the test fast; no rows are inserted.
    const contacts = Array.from({ length: 280 }, (_, i) => ({
      name: `Import Test ${i}`,
      about: "a".repeat(5_000),
    }));
    const res = await request(app)
      .post("/api/contacts/bulk")
      .send([...contacts, { about: "no name — fails validation" }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("security headers", () => {
  it("serves nosniff, frame denial, and a referrer policy on API responses", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("omits the CSP outside production — Vite dev needs inline script", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});
