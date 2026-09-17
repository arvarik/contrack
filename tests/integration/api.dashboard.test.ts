import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "crypto";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

let app: ReturnType<typeof makeTestApp>;
let actor: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  actor = await createActor(app, {
    username: "dashuser",
    email: "dashuser@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const getDashboard = () => asUser(actor)(request(app).get("/api/dashboard"));

describe("GET /api/dashboard", () => {
  it("returns the full payload with hygiene, meetings, and correspondents", async () => {
    const res = await getDashboard();
    expect(res.status).toBe(200);

    // Standard properties
    expect(res.body).toHaveProperty("overdue");
    expect(res.body).toHaveProperty("dueToday");
    expect(res.body).toHaveProperty("upcoming");
    expect(res.body).toHaveProperty("ghosts");
    expect(res.body).toHaveProperty("metrics");
    expect(res.body).toHaveProperty("atRisk");
    expect(res.body).toHaveProperty("recentlyAdded");
    expect(res.body).toHaveProperty("industryComposition");
    expect(res.body).toHaveProperty("locationComposition");
    expect(res.body).toHaveProperty("roleComposition");
    expect(res.body).toHaveProperty("interactionBreakdown30d");
    expect(res.body).toHaveProperty("networkGrowthTimeline30d");

    // New pulse properties
    expect(res.body).toHaveProperty("hygiene");
    expect(res.body.hygiene).toMatchObject({
      missingCompany: expect.any(Number),
      missingLocation: expect.any(Number),
      missingEmail: expect.any(Number),
      stale: expect.any(Number),
    });
    expect(Array.isArray(res.body.meetings)).toBe(true);
    expect(typeof res.body.correspondents).toBe("number");
  });

  it("calculates hygiene counts accurately", async () => {
    const contactId = crypto.randomUUID();
    const staleDate = new Date(Date.now() - 200 * 86_400_000).toISOString();

    // Insert a contact with missing company, missing location, missing email, and stale
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, company, location, ownerId, addedAt, updatedAt, isGhost, isArchived)
         VALUES (?, 'Hygiene Test Contact', NULL, '', ?, ?, ?, 0, 0)`,
      )
      .run(contactId, actor.user.id, staleDate, staleDate);

    const res = await getDashboard();
    expect(res.status).toBe(200);
    expect(res.body.hygiene.missingCompany).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.missingLocation).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.missingEmail).toBeGreaterThanOrEqual(1);
    expect(res.body.hygiene.stale).toBeGreaterThanOrEqual(1);

    // Add an email to contact_emails and company/location to contacts
    sqlite
      .prepare(
        `INSERT INTO contact_emails (id, contactId, email, label, isPrimary)
         VALUES (?, ?, 'hygiene@example.com', 'work', 1)`,
      )
      .run(crypto.randomUUID(), contactId);

    sqlite
      .prepare(
        `UPDATE contacts SET company = 'Acme Inc', location = 'SF', updatedAt = datetime('now')
         WHERE id = ?`,
      )
      .run(contactId);

    const res2 = await getDashboard();
    expect(res2.status).toBe(200);
    expect(res2.body.hygiene.stale).toBe(0);
  });

  it("returns empty meetings array when upcoming_events table does not exist", async () => {
    // In our test database upcoming_events table is not created
    const res = await getDashboard();
    expect(res.status).toBe(200);
    expect(res.body.meetings).toEqual([]);
  });

  it("returns birthday on slim contacts list", async () => {
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, name, ownerId, birthday) VALUES (?, 'Birthday Contact', ?, '1990-05-14')`,
      )
      .run(contactId, actor.user.id);

    const res = await asUser(actor)(
      request(app).get("/api/contacts?view=slim"),
    );
    expect(res.status).toBe(200);
    const found = res.body.find((c: { id: string }) => c.id === contactId);
    expect(found).toBeDefined();
    expect(found.birthday).toBe("1990-05-14");
  });
});
