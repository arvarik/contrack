// =============================================================================
// Integration Tests — what this instance calls itself
// =============================================================================
// A single-user install never needed a name: there was one instance and it
// was yours. An invitation link changes that, because the person clicking one
// arrives at a sign-in screen belonging to an instance they have never seen,
// sent by somebody who said "join my Contrack".
//
// The name reaches an unauthenticated screen, which is what most of this file
// is about: who may set it, what it may contain, and what happens to it on
// the way out.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const { INSTANCE_NAME_MAX, getInstanceName, setInstanceName } =
  await import("../../server/services/authService.ts");
const { clearSettingsCache } =
  await import("../../server/services/settingsService.ts");
const { createActor, asUser, resetAccounts } =
  await import("./tenancy/helpers.ts");

const app = makeTestApp();
let admin: Awaited<ReturnType<typeof createActor>>;
let member: Awaited<ReturnType<typeof createActor>>;

beforeAll(async () => {
  resetAccounts();
  process.env.AUTH_REQUIRED = "true";
  admin = await createActor(app, { username: "nameadmin" });
  member = await createActor(app, { username: "namemember" });
  sqlite
    .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
    .run(admin.user.id);
  sqlite
    .prepare("UPDATE users SET role = 'member' WHERE id = ?")
    .run(member.user.id);
});

beforeEach(() => {
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run("instance.name");
  clearSettingsCache();
});

afterAll(() => {
  process.env.AUTH_REQUIRED = "";
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run("instance.name");
  clearSettingsCache();
  resetAccounts();
});

describe("the stored value", () => {
  it("is empty until somebody names the instance", () => {
    expect(getInstanceName()).toBe("");
  });

  it("keeps what it is given", () => {
    expect(setInstanceName("The Vasquez Family")).toBe("The Vasquez Family");
    expect(getInstanceName()).toBe("The Vasquez Family");
  });

  it("trims, because a name of spaces is a name nobody meant", () => {
    expect(setInstanceName("   Northwind   ")).toBe("Northwind");
  });

  it("is cleared by an empty string", () => {
    setInstanceName("Northwind");

    expect(setInstanceName("")).toBe("");
    expect(getInstanceName()).toBe("");
  });

  it("strips the characters that would let a name span lines", () => {
    // This value reaches a sign-in screen nobody has authenticated to. React
    // renders it as text and never as markup, so this is belt and braces —
    // but a newline in the middle of a heading is a way to push text out of
    // the frame it belongs to, and there is no reason to carry one.
    expect(setInstanceName("Northwind\n\nSign in below")).toBe(
      "Northwind  Sign in below",
    );
    expect(setInstanceName("Tab\there")).toBe("Tab here");
  });

  it("refuses one longer than the limit rather than silently cutting it", () => {
    expect(() => setInstanceName("x".repeat(INSTANCE_NAME_MAX + 1))).toThrow(
      /60 characters or fewer/,
    );
    // Nothing was written. A refusal that half-applied would be worse than
    // either outcome.
    expect(getInstanceName()).toBe("");
  });

  it("accepts one exactly at the limit", () => {
    const name = "x".repeat(INSTANCE_NAME_MAX);

    expect(setInstanceName(name)).toBe(name);
  });

  it("refuses a value that is not text", () => {
    expect(() => setInstanceName(42)).toThrow(/must be text/);
    expect(() => setInstanceName(null)).toThrow(/must be text/);
  });
});

describe("who may change it", () => {
  it("lets an admin set it", async () => {
    const res = await asUser(admin)(
      request(app).put("/api/admin/settings").send({ instanceName: "Halcyon" }),
    );

    expect(res.status).toBe(200);
    expect(res.body.instanceName).toBe("Halcyon");
    expect(res.body.instanceNameMax).toBe(INSTANCE_NAME_MAX);
  });

  it("refuses a member", async () => {
    const res = await asUser(member)(
      request(app).put("/api/admin/settings").send({ instanceName: "Theirs" }),
    );

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
    expect(getInstanceName()).toBe("");
  });

  it("writes an audit row naming the key and not the value", async () => {
    await asUser(admin)(
      request(app).put("/api/admin/settings").send({ instanceName: "Halcyon" }),
    );

    const row = sqlite
      .prepare(
        `SELECT targetId, details FROM audit_log
          WHERE action = 'settings.changed' AND targetId = 'instance.name'
          ORDER BY createdAt DESC LIMIT 1`,
      )
      .get() as { targetId: string; details: string | null } | undefined;

    expect(row?.targetId).toBe("instance.name");
    expect(row?.details ?? "").not.toContain("Halcyon");
  });
});

describe("who may read it", () => {
  it("reaches the sign-in screen, which has no credential behind it", async () => {
    setInstanceName("Halcyon Design Studio");

    // Deliberately unauthenticated. The sign-in and join screens are the two
    // places somebody looks before they have a credential and the two places
    // the answer matters most.
    const res = await request(app).get("/api/auth/status");

    expect(res.status).toBe(200);
    expect(res.body.instanceName).toBe("Halcyon Design Studio");
  });

  it("is an empty string rather than missing when nobody has set one", async () => {
    const res = await request(app).get("/api/auth/status");

    // Not null and not absent. The client renders nothing for "", and a
    // missing field would make every consumer handle undefined.
    expect(res.body.instanceName).toBe("");
  });
});
