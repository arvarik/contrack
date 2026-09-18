// =============================================================================
// Integration: Tags API (/api/tags and /api/tags/summary)
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("Tags API", () => {
  it("GET /api/tags answers a plain array of strings for MCP compatibility", async () => {
    // Create contacts with tags
    await request(app)
      .post("/api/contacts")
      .send({
        name: "Ada Lovelace",
        tags: ["pioneer", "math"],
      });

    const res = await request(app).get("/api/tags");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain("pioneer");
    expect(res.body).toContain("math");
    // Ensure it is string[]
    expect(typeof res.body[0]).toBe("string");
  });

  it("GET /api/tags/summary returns tag objects with contact counts", async () => {
    await request(app)
      .post("/api/contacts")
      .send({
        name: "Charles Babbage",
        tags: ["pioneer", "computing"],
      });

    const res = await request(app).get("/api/tags/summary");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("tags");
    expect(Array.isArray(res.body.tags)).toBe(true);

    const pioneer = res.body.tags.find(
      (t: { tag: string }) => t.tag === "pioneer",
    );
    expect(pioneer).toBeDefined();
    expect(pioneer.count).toBeGreaterThanOrEqual(2); // Ada + Charles
  });

  it("PATCH /api/tags/:tag renames a tag and returns affected count", async () => {
    // Create contact with unique tag
    await request(app)
      .post("/api/contacts")
      .send({
        name: "Alan Turing",
        tags: ["cryptography"],
      });

    const res = await request(app)
      .patch(`/api/tags/${encodeURIComponent("cryptography")}`)
      .send({ to: "crypto" });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(1);

    // Verify rename reflected in summary
    const summary = await request(app).get("/api/tags/summary");
    expect(
      summary.body.tags.some((t: { tag: string }) => t.tag === "crypto"),
    ).toBe(true);
    expect(
      summary.body.tags.some((t: { tag: string }) => t.tag === "cryptography"),
    ).toBe(false);
  });

  it("PATCH /api/tags/:tag validates body.to", async () => {
    const res = await request(app)
      .patch("/api/tags/crypto")
      .send({ to: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH /api/tags/:tag merges when destination tag exists", async () => {
    const resContact = await request(app)
      .post("/api/contacts")
      .send({
        name: "Margaret Hamilton",
        tags: ["software", "apollo"],
      });

    const contactId = resContact.body.id;

    // Rename apollo -> software (merge)
    const res = await request(app)
      .patch("/api/tags/apollo")
      .send({ to: "software" });

    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(1);

    // Verify contact only has "software" once
    const contactRes = await request(app).get(`/api/contacts/${contactId}`);
    expect(
      contactRes.body.tags.filter((t: { tag: string }) => t.tag === "software"),
    ).toHaveLength(1);
    expect(
      contactRes.body.tags.some((t: { tag: string }) => t.tag === "apollo"),
    ).toBe(false);
  });

  it("DELETE /api/tags/:tag deletes the tag from all contacts", async () => {
    const c1 = await request(app)
      .post("/api/contacts")
      .send({
        name: "Katherine Johnson",
        tags: ["orbital", "nasa"],
      });

    const res = await request(app).delete("/api/tags/orbital");
    expect(res.status).toBe(200);
    expect(res.body.affected).toBe(1);

    const contactRes = await request(app).get(`/api/contacts/${c1.body.id}`);
    expect(
      contactRes.body.tags.some((t: { tag: string }) => t.tag === "orbital"),
    ).toBe(false);
    expect(
      contactRes.body.tags.some((t: { tag: string }) => t.tag === "nasa"),
    ).toBe(true);
  });
});
