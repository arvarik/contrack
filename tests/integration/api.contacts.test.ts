// =============================================================================
// Integration: contact CRUD, validation, FTS search, bulk ops, error envelope
// =============================================================================
// Every request here runs the real Express pipeline against a real SQLite
// database (fresh temp file per test file) — validation middleware, service
// layer, repositories, FTS triggers, and the error envelope all execute.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("POST /api/contacts", () => {
  it("creates a contact and returns the hydrated record", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({
        name: "Grace Hopper",
        company: "US Navy",
        role: "Rear Admiral",
        emails: ["grace@navy.mil"],
        tags: ["computing"],
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe("Grace Hopper");
    expect(res.body.emails).toEqual([
      expect.objectContaining({ email: "grace@navy.mil" }),
    ]);
    expect(res.body.tags).toEqual([
      expect.objectContaining({ tag: "computing" }),
    ]);
  });

  it("rejects a payload without a name via the validation envelope", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({ company: "Nameless Inc" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.requestId).toMatch(/^[0-9a-f]{8}$/);
  });

  it("uses defaultCadenceDays from preferences when cadenceDays is omitted", async () => {
    // Default without preference is 90
    const res1 = await request(app)
      .post("/api/contacts")
      .send({ name: "Default Cadence Person" });
    expect(res1.status).toBe(201);
    expect(res1.body.cadenceDays).toBe(90);

    // Update preference to 30
    await request(app)
      .patch("/api/auth/preferences")
      .send({ defaultCadenceDays: 30 });

    const res2 = await request(app)
      .post("/api/contacts")
      .send({ name: "Custom Cadence Person" });
    expect(res2.status).toBe(201);
    expect(res2.body.cadenceDays).toBe(30);

    // Explicit cadenceDays overrides default
    const res3 = await request(app)
      .post("/api/contacts")
      .send({ name: "Explicit Cadence Person", cadenceDays: 180 });
    expect(res3.status).toBe(201);
    expect(res3.body.cadenceDays).toBe(180);
  });
});

describe("GET /api/contacts", () => {
  it("lists created contacts in slim view with hydrated children", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Slim Target", emails: ["slim@example.com"] });

    const res = await request(app).get("/api/contacts?view=slim");
    expect(res.status).toBe(200);
    const slim = res.body.find(
      (c: { name: string }) => c.name === "Slim Target",
    );
    expect(slim).toBeTruthy();
    expect(slim.emails).toEqual([
      expect.objectContaining({ email: "slim@example.com" }),
    ]);
  });

  it("returns the canonical 404 envelope for a missing contact", async () => {
    const res = await request(app).get(
      "/api/contacts/00000000-0000-0000-0000-000000000000",
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
  });
});

describe("PATCH /api/contacts/:id", () => {
  it("updates scalar fields", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Me" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ role: "CTO" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe("CTO");
  });

  it("rejects child arrays with a 400", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Reject" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ emails: ["nope@example.com"] });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/child arrays/i);
  });

  it("rejects a type-invalid body via Zod", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Patch Invalid" });
    const res = await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ cadenceDays: "not-a-number" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

/**
 * A link saved with a URL and nothing else takes its platform from its host.
 * "+ link" on the contact page sends exactly that, through the update, and a
 * new contact can carry links too, so both paths are checked. The server used
 * to match the text of the URL, and dropbox.com came back as "twitter".
 */
describe("social links saved without a platform", () => {
  const platforms = (body: {
    socialLinks: { url: string; platform: string }[];
  }) => Object.fromEntries(body.socialLinks.map((l) => [l.url, l.platform]));

  it("are labelled by their host when a contact is created", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .send({
        name: "Link Creator",
        socialLinks: [
          { url: "https://www.dropbox.com/s/abc" },
          { url: "https://youtu.be/dQw4w9WgXcQ" },
          { url: "https://www.linkedin.com/in/linkcreator" },
        ],
      });
    expect(res.status).toBe(201);
    expect(platforms(res.body)).toEqual({
      "https://www.dropbox.com/s/abc": "other",
      "https://youtu.be/dQw4w9WgXcQ": "youtube",
      "https://www.linkedin.com/in/linkcreator": "linkedin",
    });
  });

  it("are labelled by their host when a contact is updated, and keep a platform that was sent", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Link Updater" });
    const res = await request(app)
      .put(`/api/contacts/${created.body.id}`)
      .send({
        socialLinks: [
          // What the header sends back for a link it already had.
          {
            url: "https://github.com/linkupdater",
            platform: "github",
            handle: "linkupdater",
          },
          // What "+ link" adds.
          { url: "https://www.netflix.com/title/1" },
          { url: "https://x.com/linkupdater" },
        ],
      });
    expect(res.status).toBe(200);
    expect(platforms(res.body)).toEqual({
      "https://github.com/linkupdater": "github",
      "https://www.netflix.com/title/1": "other",
      "https://x.com/linkupdater": "twitter",
    });
    const x = res.body.socialLinks.find(
      (l: { url: string }) => l.url === "https://x.com/linkupdater",
    );
    expect(x.handle).toBe("linkupdater");
  });
});

describe("FTS search pipeline (triggers + index)", () => {
  it("finds a contact by name immediately after creation", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Zaphod Beeblebrox", company: "Heart of Gold" });

    const res = await request(app).get("/api/search?q=Zaphod");
    expect(res.status).toBe(200);
    expect(
      res.body.some((c: { name: string }) => c.name === "Zaphod Beeblebrox"),
    ).toBe(true);
  });

  it("reflects renames via the FTS update trigger", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Trillian Astra" });

    await request(app)
      .patch(`/api/contacts/${created.body.id}`)
      .send({ name: "Tricia McMillan" });

    const oldName = await request(app).get("/api/search?q=Trillian");
    const newName = await request(app).get("/api/search?q=McMillan");
    expect(
      oldName.body.some((c: { id: string }) => c.id === created.body.id),
    ).toBe(false);
    expect(
      newName.body.some((c: { id: string }) => c.id === created.body.id),
    ).toBe(true);
  });

  it("indexes email addresses via the child-table trigger", async () => {
    await request(app)
      .post("/api/contacts")
      .send({ name: "Email Indexed", emails: ["findme-fts@example.com"] });

    const res = await request(app).get("/api/search?q=findme");
    expect(
      res.body.some((c: { name: string }) => c.name === "Email Indexed"),
    ).toBe(true);
  });
});

describe("bulk operations", () => {
  it("bulk-creates contacts via the JSON path", async () => {
    const res = await request(app)
      .post("/api/contacts/bulk")
      .send([
        { name: "Bulk One", emails: ["b1@example.com"] },
        { name: "Bulk Two" },
      ]);

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
  });

  it("bulk-deletes contacts and cascades children", async () => {
    const a = await request(app)
      .post("/api/contacts")
      .send({ name: "Doomed A", emails: ["da@example.com"] });
    const b = await request(app)
      .post("/api/contacts")
      .send({ name: "Doomed B" });

    const res = await request(app)
      .post("/api/contacts/bulk-delete")
      .send({ ids: [a.body.id, b.body.id] });
    expect(res.status).toBe(200);

    const after = await request(app).get(`/api/contacts/${a.body.id}`);
    expect(after.status).toBe(404);
  });
});

describe("error envelope", () => {
  it("returns ROUTE_NOT_FOUND for unknown API paths", async () => {
    const res = await request(app).get("/api/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("returns INVALID_JSON for malformed request bodies", async () => {
    const res = await request(app)
      .post("/api/contacts")
      .set("Content-Type", "application/json")
      .send('{"name": "broken"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

describe("dedupeOnCreate and autoEnrich preferences on contact creation", () => {
  it("skips incremental dedupe when dedupeOnCreate is false", async () => {
    const { contactService } =
      await import("../../server/services/contactService.ts");
    const dedupeSpy = vi.spyOn(contactService, "scheduleIncrementalDedupe");

    await request(app)
      .patch("/api/auth/preferences")
      .send({ dedupeOnCreate: false });

    await request(app)
      .post("/api/contacts")
      .send({ name: "Skip Dedupe Person" });

    expect(dedupeSpy).not.toHaveBeenCalled();

    // Reset preference
    await request(app)
      .patch("/api/auth/preferences")
      .send({ dedupeOnCreate: true });
    dedupeSpy.mockRestore();
  });

  it("starts a one-contact enrichment batch when autoEnrich is true", async () => {
    const { jobQueue } =
      await import("../../server/services/aiSearch/jobQueue.ts");
    const strat =
      await import("../../server/services/aiSearch/strategies/index.ts");
    const stratSpy = vi
      .spyOn(strat, "validateEnrichmentStrategy")
      .mockReturnValue("two-pass");
    const batchSpy = vi.spyOn(jobQueue, "createBatch");
    const processSpy = vi
      .spyOn(jobQueue, "processBatch")
      .mockResolvedValue(undefined as unknown as void);

    await request(app)
      .patch("/api/auth/preferences")
      .send({ autoEnrich: true });

    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Auto Enrich Person" });
    expect(res.status).toBe(201);

    expect(batchSpy).toHaveBeenCalledWith(
      expect.anything(),
      [{ id: res.body.id, name: "Auto Enrich Person" }],
      "two-pass",
    );

    // Reset preference
    await request(app)
      .patch("/api/auth/preferences")
      .send({ autoEnrich: false });
    stratSpy.mockRestore();
    batchSpy.mockRestore();
    processSpy.mockRestore();
  });
});
