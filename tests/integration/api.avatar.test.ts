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
import { sqlite } from "../../server/db.ts";
import { doubleMetaphone } from "../../server/utils/nlp/index.ts";

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

  it("draws the look the URL asks for, whatever the seed suggests", async () => {
    const [byName, asked, again] = await Promise.all([
      request(app).get("/api/avatar/avataaars").query({ seed: "James Thomas" }),
      request(app)
        .get("/api/avatar/avataaars")
        .query({ seed: "James Thomas", look: "f" }),
      request(app)
        .get("/api/avatar/avataaars")
        .query({ seed: "James Thomas", look: "f" }),
    ]);
    expect(asked.status).toBe(200);
    expect(svgOf(asked)).not.toBe(svgOf(byName));
    expect(svgOf(asked)).toBe(svgOf(again));
  });

  it("ignores a look it does not know rather than refusing", async () => {
    const [plain, odd] = await Promise.all([
      request(app).get("/api/avatar/avataaars").query({ seed: "James Thomas" }),
      request(app)
        .get("/api/avatar/avataaars")
        .query({ seed: "James Thomas", look: "female" }),
    ]);
    expect(odd.status).toBe(200);
    expect(svgOf(odd)).toBe(svgOf(plain));
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

describe("the default avatar follows the name and pronouns", () => {
  async function create(body: Record<string, unknown>) {
    const res = await request(app).post("/api/contacts").send(body);
    expect(res.status).toBe(201);
    return res.body as { id: string; avatarUrl: string };
  }

  it("draws from the pronouns when the contact has them", async () => {
    const withPronouns = await create({
      name: "Jordan Pronoun",
      pronouns: "she/her",
    });
    expect(withPronouns.avatarUrl).toBe(
      "/api/avatar/avataaars?seed=Jordan+Pronoun&look=f",
    );
    const without = await create({ name: "Jordan Plain" });
    expect(without.avatarUrl).toBe("/api/avatar/avataaars?seed=Jordan+Plain");
  });

  it("redraws the default face when the contact is renamed", async () => {
    const contact = await create({ name: "Rename Before" });
    const res = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .send({ name: "Rename After" });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe("/api/avatar/avataaars?seed=Rename+After");
  });

  it("redraws the default face when the pronouns change", async () => {
    const contact = await create({ name: "Pronoun Edit" });
    const set = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .send({ pronouns: "he/him" });
    expect(set.status).toBe(200);
    expect(set.body.avatarUrl).toBe(
      "/api/avatar/avataaars?seed=Pronoun+Edit&look=m",
    );

    const cleared = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .send({ pronouns: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.avatarUrl).toBe(
      "/api/avatar/avataaars?seed=Pronoun+Edit",
    );
  });

  it("keeps a face someone picked", async () => {
    const picked = "/api/avatar/avataaars?seed=Felix&bg=1";
    const contact = await create({ name: "Picked Face", avatarUrl: picked });
    const res = await request(app)
      .put(`/api/contacts/${contact.id}`)
      .send({ name: "Picked Face Renamed", pronouns: "she/her" });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(picked);
  });

  it("keeps the phonetic hash in step with a rename by PATCH", async () => {
    const contact = await create({ name: "Katherine Phonetic" });
    const res = await request(app)
      .patch(`/api/contacts/${contact.id}`)
      .send({ name: "Siobhan Phonetic" });
    expect(res.status).toBe(200);
    const row = sqlite
      .prepare("SELECT phoneticHash FROM contacts WHERE id = ?")
      .get(contact.id) as { phoneticHash: string };
    expect(row.phoneticHash).toBe(doubleMetaphone("Siobhan Phonetic").primary);
  });
});
