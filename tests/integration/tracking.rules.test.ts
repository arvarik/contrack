// =============================================================================
// Integration Tests — what turning tracking on and off means
// =============================================================================
// `trackedAt` is written by two database triggers, so every path that flips
// the flag records the moment the same way. The cadence is set when a contact
// is tracked: from the body when it names one, else from the owner's default,
// and only for rows that were untracked. A new contact follows the
// `trackNewContacts` preference only when a person adds it by hand.
// =============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";
import { contactService } from "../../server/services/contactService.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";

let app: ReturnType<typeof makeTestApp>;
let actor: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  actor = await createActor(app, {
    username: "rulesuser",
    email: "rulesuser@test.dev",
  });
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

const auth = () => asUser(actor);

async function create(body: Record<string, unknown>) {
  const res = await auth()(request(app).post("/api/contacts").send(body));
  expect(res.status).toBe(201);
  return res.body as {
    id: string;
    isTracked: boolean;
    trackedAt: string | null;
    cadenceDays: number;
  };
}

async function read(id: string) {
  const res = await auth()(request(app).get(`/api/contacts/${id}`));
  expect(res.status).toBe(200);
  return res.body as {
    id: string;
    isTracked: boolean;
    trackedAt: string | null;
    cadenceDays: number;
  };
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await auth()(
    request(app).patch(`/api/contacts/${id}`).send(body),
  );
  expect(res.status).toBe(200);
  return res.body as {
    id: string;
    isTracked: boolean;
    trackedAt: string | null;
    cadenceDays: number;
  };
}

async function prefs(body: Record<string, unknown>) {
  const res = await auth()(
    request(app).patch("/api/auth/preferences").send(body),
  );
  expect(res.status).toBe(200);
}

describe("trackedAt", () => {
  it("is stamped on a contact born tracked", async () => {
    const created = await create({
      name: "Rules Born Tracked",
      isTracked: true,
    });
    expect(created.isTracked).toBe(true);
    expect(typeof created.trackedAt).toBe("string");
  });

  it("is stamped on a flip to true and cleared on a flip to false", async () => {
    const created = await create({ name: "Rules Flipped" });
    expect(created.isTracked).toBe(false);
    expect(created.trackedAt).toBeNull();

    const on = await patch(created.id, { isTracked: true });
    expect(on.isTracked).toBe(true);
    expect(typeof on.trackedAt).toBe("string");

    const off = await patch(created.id, { isTracked: false });
    expect(off.isTracked).toBe(false);
    expect(off.trackedAt).toBeNull();
  });

  it("is written by the database, so a raw write records it too", async () => {
    const created = await create({ name: "Rules Raw" });
    sqlite
      .prepare(`UPDATE contacts SET isTracked = 1 WHERE id = ? AND ownerId = ?`)
      .run(created.id, actor.user.id);
    expect(typeof (await read(created.id)).trackedAt).toBe("string");
  });
});

describe("the cadence", () => {
  it("takes the owner's default at the moment of tracking", async () => {
    // Born under one default, tracked under another: the cadence follows
    // the moment of tracking, not the moment of creation.
    await prefs({ defaultCadenceDays: 90 });
    const created = await create({ name: "Rules Default Cadence" });
    expect(created.cadenceDays).toBe(90);

    await prefs({ defaultCadenceDays: 30 });
    const tracked = await patch(created.id, { isTracked: true });
    expect(tracked.cadenceDays).toBe(30);

    await prefs({ defaultCadenceDays: 90 });
  });

  it("keeps a cadence the body names", async () => {
    const created = await create({ name: "Rules Named Cadence" });
    const tracked = await patch(created.id, {
      isTracked: true,
      cadenceDays: 45,
    });
    expect(tracked.cadenceDays).toBe(45);
  });

  it("accepts a year", async () => {
    await prefs({ defaultCadenceDays: 365 });
    const created = await create({ name: "Rules Yearly" });
    const tracked = await patch(created.id, { isTracked: true });
    expect(tracked.cadenceDays).toBe(365);
    await prefs({ defaultCadenceDays: 90 });
  });

  it("does not move when an already tracked contact is tracked again", async () => {
    const created = await create({ name: "Rules Twice" });
    const first = await patch(created.id, {
      isTracked: true,
      cadenceDays: 60,
    });

    await prefs({ defaultCadenceDays: 30 });
    const again = await patch(created.id, { isTracked: true });
    expect(again.cadenceDays).toBe(60);
    expect(again.trackedAt).toBe(first.trackedAt);
    await prefs({ defaultCadenceDays: 90 });
  });
});

describe("trackNewContacts", () => {
  it("decides a contact added by hand", async () => {
    await prefs({ trackNewContacts: true });
    const created = await create({ name: "Rules Preference On" });
    expect(created.isTracked).toBe(true);
    expect(created.cadenceDays).toBe(90);

    await prefs({ trackNewContacts: false });
    const later = await create({ name: "Rules Preference Off" });
    expect(later.isTracked).toBe(false);
  });

  it("never decides an import", async () => {
    await prefs({ trackNewContacts: true });
    const scope = scopeForOwnerId(actor.user.id);
    const written = await contactService.bulkCreateContacts(scope, [
      { name: "Rules Imported" },
    ]);
    expect(written.count).toBe(1);
    expect((await read(written.createdIds[0])).isTracked).toBe(false);
    await prefs({ trackNewContacts: false });
  });

  it("gives way to a body that says so", async () => {
    await prefs({ trackNewContacts: true });
    const created = await create({ name: "Rules Body Wins", isTracked: false });
    expect(created.isTracked).toBe(false);
    await prefs({ trackNewContacts: false });
  });
});
