// =============================================================================
// Integration: avatar route
// =============================================================================
// The point of this route is that it exists at all: contact avatars used to be
// `api.dicebear.com` URLs, so rendering the contact list sent every contact's
// name to a third party. These tests pin the replacement's contract.
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

/**
 * Superagent only fills `res.text` for content types it recognises as text, and
 * `image/svg+xml` is not one — it buffers into `res.body` instead. Read
 * whichever the response actually populated.
 */
function svgOf(res: { text?: string; body?: unknown }): string {
  if (typeof res.text === "string" && res.text.length > 0) return res.text;
  return Buffer.isBuffer(res.body) ? res.body.toString("utf8") : "";
}

describe("GET /api/avatar/:style", () => {
  it("returns an SVG for every offered style", async () => {
    for (const style of ["avataaars", "lorelei", "bottts", "initials"]) {
      const res = await request(app)
        .get(`/api/avatar/${style}`)
        .query({ seed: "Karen White" });

      expect(res.status, style).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/svg\+xml/);
      expect(svgOf(res).startsWith("<svg")).toBe(true);
    }
  });

  it("is deterministic across requests", async () => {
    const url = "/api/avatar/avataaars?seed=Karen%20White";
    const [a, b] = await Promise.all([
      request(app).get(url),
      request(app).get(url),
    ]);
    expect(svgOf(a)).toBe(svgOf(b));
  });

  it("is cacheable, so a 200-row list costs one request per face", async () => {
    const res = await request(app)
      .get("/api/avatar/avataaars")
      .query({ seed: "Karen White" });

    expect(res.headers["cache-control"]).toContain("max-age=");
    expect(res.headers.etag).toBeTruthy();
  });

  it("revalidates to 304 when the client already has the face", async () => {
    const first = await request(app)
      .get("/api/avatar/avataaars")
      .query({ seed: "Karen White" });

    const second = await request(app)
      .get("/api/avatar/avataaars")
      .query({ seed: "Karen White" })
      .set("If-None-Match", first.headers.etag);

    expect(second.status).toBe(304);
  });

  it("rejects an unknown style rather than guessing", async () => {
    const res = await request(app)
      .get("/api/avatar/pixel-art")
      .query({ seed: "Karen White" });
    expect(res.status).toBe(400);
  });

  it("rejects a missing or blank seed", async () => {
    expect((await request(app).get("/api/avatar/avataaars")).status).toBe(400);
    expect(
      (await request(app).get("/api/avatar/avataaars").query({ seed: "  " }))
        .status,
    ).toBe(400);
  });

  it("handles seeds containing characters that matter in XML", async () => {
    const res = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "<Bobby> & Tables" });
    expect(res.status).toBe(200);
    expect(svgOf(res).startsWith("<svg")).toBe(true);
  });
});

describe("the palette an avatar is drawn for", () => {
  it("answers both when nothing is asked for", async () => {
    const res = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "Ada Lovelace" });
    expect(res.status).toBe(200);
    expect(svgOf(res)).toContain("prefers-color-scheme:dark");
  });

  it("pins the palette when one is named", async () => {
    const dark = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "Ada Lovelace", theme: "dark" });
    expect(dark.status).toBe(200);
    expect(svgOf(dark)).toContain("#1d2326");
    expect(svgOf(dark)).not.toContain("prefers-color-scheme");
  });

  it("ignores a theme it does not know rather than refusing", async () => {
    // A stale URL from an older build, or a hand-typed one. The media-query
    // form is a correct answer for any caller, so there is nothing to refuse.
    const res = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "Ada Lovelace", theme: "sepia" });
    expect(res.status).toBe(200);
    expect(svgOf(res)).toContain("prefers-color-scheme:dark");
  });

  it("caches the two palettes apart", async () => {
    const light = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "Ada Lovelace", theme: "light" });
    const dark = await request(app)
      .get("/api/avatar/initials")
      .query({ seed: "Ada Lovelace", theme: "dark" });
    // Different bytes means a different ETag, so a browser holding one cannot
    // be served the other from its own cache.
    expect(svgOf(light)).not.toBe(svgOf(dark));
    expect(light.headers.etag).not.toBe(dark.headers.etag);
  });
});

describe("contact creation", () => {
  it("assigns a same-origin avatar, never a third-party URL", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Avatar Origin Check" });

    expect(res.status).toBe(201);
    expect(res.body.avatarUrl).toMatch(/^\/api\/avatar\//);
    expect(res.body.avatarUrl).not.toContain("dicebear");
  });
});
