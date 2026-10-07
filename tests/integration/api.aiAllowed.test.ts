// Integration: the requireAiAllowed middleware and the aiAssist preference.
// With `aiAssist: false`, every endpoint with an AI cost answers 403
// AI_OFF_FOR_ACCOUNT for that account, and stays open to other accounts and
// non-AI routes. Ask Contrack answers with local results and runs no model.
//
// With AI off for the instance, the same endpoints answer 403
// AI_OFF_FOR_INSTANCE for every account, and Ask still answers locally.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";
import { setAiOffForInstance } from "../../server/ai/instanceSwitch.ts";

let app: ReturnType<typeof makeTestApp>;
let userOff: Actor;
let userOn: Actor;

beforeAll(async () => {
  process.env.AUTH_REQUIRED = "true";
  app = makeTestApp();
  userOff = await createActor(app, {
    username: "aioff",
    email: "aioff@test.dev",
  });
  userOn = await createActor(app, {
    username: "aion",
    email: "aion@test.dev",
  });

  // Turn AI off for userOff
  const res = await asUser(userOff)(
    request(app).patch("/api/auth/preferences").send({ aiAssist: false }),
  );
  expect(res.status).toBe(200);
  expect(res.body.preferences.aiAssist).toBe(false);
});

afterAll(() => {
  delete process.env.AUTH_REQUIRED;
  app.close();
});

describe("requireAiAllowed middleware", () => {
  const aiCostPaths: { method: "get" | "post"; path: string; body?: object }[] =
    [
      { method: "get", path: "/api/dashboard/insight" },
      {
        method: "post",
        path: "/api/search/synthesize",
        body: { query: "test" },
      },
      {
        method: "post",
        path: "/api/parse-contact",
        body: { text: "John Doe" },
      },
      { method: "post", path: "/api/contacts/some-id/enrich" },
      { method: "post", path: "/api/contacts/some-id/briefing" },
      { method: "post", path: "/api/ai-search" },
      { method: "post", path: "/api/dedupe/backfill-embeddings" },
      { method: "post", path: "/api/dedupe/scan" },
      {
        method: "post",
        path: "/api/link-preview",
        body: { url: "https://example.com" },
      },
    ];

  for (const { method, path, body } of aiCostPaths) {
    it(`refuses ${method.toUpperCase()} ${path} with 403 AI_OFF_FOR_ACCOUNT when aiAssist is false`, async () => {
      const req =
        method === "get"
          ? request(app).get(path)
          : request(app)
              .post(path)
              .send(body ?? {});

      const res = await asUser(userOff)(req);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AI_OFF_FOR_ACCOUNT");
      expect(res.body.error.message).toMatch(/AI is off for this account/i);
    });

    it(`allows ${method.toUpperCase()} ${path} for an account with AI turned on`, async () => {
      const req =
        method === "get"
          ? request(app).get(path)
          : request(app)
              .post(path)
              .send(body ?? {});

      const res = await asUser(userOn)(req);
      // It must NOT be refused by requireAiAllowed
      expect(res.body?.error?.code).not.toBe("AI_OFF_FOR_ACCOUNT");
    });
  }

  it("answers POST /api/search/semantic from local data when aiAssist is false", async () => {
    const created = await asUser(userOff)(
      request(app)
        .post("/api/contacts")
        .send({ name: "Zelda Offline", role: "Engineer" }),
    );
    expect(created.status).toBe(201);

    const res = await asUser(userOff)(
      request(app).post("/api/search/semantic").send({ query: "engineer" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.matches).toEqual([
      expect.objectContaining({ name: "Zelda Offline", verified: false }),
    ]);

    // The Ask page streams. The stream carries no instant chunk, because no
    // model stage follows the local list.
    const stream = await asUser(userOff)(
      request(app)
        .post("/api/search/semantic")
        .set("Accept", "application/x-ndjson")
        .send({ query: "engineer" }),
    );
    const chunks = stream.text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(chunks).toEqual([
      expect.objectContaining({ phase: "complete", fallback: true }),
    ]);
  });

  it("runs a Quick scan for the account with AI off, because it calls no model", async () => {
    const started = await asUser(userOff)(
      request(app).post("/api/dedupe/scan").send({ mode: "quick" }),
    );
    expect(started.status).toBe(200);
    expect(started.body.mode).toBe("quick");

    const status = await asUser(userOff)(
      request(app).get(`/api/dedupe/status?scanId=${started.body.scanId}`),
    );
    expect(status.status).toBe(200);
    expect(status.body.phase).toBe("complete");
  });

  for (const mode of ["deep", "full"]) {
    it(`still refuses a ${mode} scan for the account with AI off`, async () => {
      const res = await asUser(userOff)(
        request(app).post("/api/dedupe/scan").send({ mode }),
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AI_OFF_FOR_ACCOUNT");
    });
  }

  it("does not block non-AI endpoints for the account with AI off", async () => {
    const res = await asUser(userOff)(request(app).get("/api/contacts"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("with AI off for the instance", () => {
  const aiCostPaths: { method: "get" | "post"; path: string; body?: object }[] =
    [
      { method: "get", path: "/api/dashboard/insight" },
      {
        method: "post",
        path: "/api/search/synthesize",
        body: { query: "test" },
      },
      {
        method: "post",
        path: "/api/parse-contact",
        body: { text: "John Doe" },
      },
      { method: "post", path: "/api/contacts/some-id/enrich" },
      { method: "post", path: "/api/contacts/some-id/briefing" },
      { method: "post", path: "/api/ai-search" },
      { method: "post", path: "/api/dedupe/backfill-embeddings" },
      { method: "post", path: "/api/dedupe/scan" },
    ];

  // Both accounts here are members, so the switch is set through the
  // service. The route and its admin guard are tested in
  // api.aiSettings.test.ts and api.admin.test.ts.
  beforeAll(() => {
    setAiOffForInstance(true);
  });

  afterAll(() => {
    setAiOffForInstance(false);
  });

  for (const { method, path, body } of aiCostPaths) {
    it(`refuses ${method.toUpperCase()} ${path} with 403 AI_OFF_FOR_INSTANCE for an account with AI on`, async () => {
      const req =
        method === "get"
          ? request(app).get(path)
          : request(app)
              .post(path)
              .send(body ?? {});

      const res = await asUser(userOn)(req);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("AI_OFF_FOR_INSTANCE");
      expect(res.body.error.message).toMatch(
        /An admin turned AI off for this instance/,
      );
    });
  }

  it("still runs a Quick scan, for an account with AI on and one with AI off", async () => {
    for (const actor of [userOn, userOff]) {
      const res = await asUser(actor)(
        request(app).post("/api/dedupe/scan").send({ mode: "quick" }),
      );
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe("quick");
    }
  });

  it("names the instance, not the account, when both are off", async () => {
    const res = await asUser(userOff)(request(app).post("/api/ai-search"));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("AI_OFF_FOR_INSTANCE");
  });

  it("still answers POST /api/search/semantic from local data", async () => {
    const created = await asUser(userOn)(
      request(app)
        .post("/api/contacts")
        .send({ name: "Quentin Local", role: "Surveyor" }),
    );
    expect(created.status).toBe(201);

    const res = await asUser(userOn)(
      request(app).post("/api/search/semantic").send({ query: "surveyor" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.fallback).toBe(true);
    expect(res.body.matches).toEqual([
      expect.objectContaining({ name: "Quentin Local", verified: false }),
    ]);
  });

  it("tells any signed-in account that AI is off, and why not", async () => {
    const res = await asUser(userOn)(request(app).get("/api/ai/instance"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aiOff: true, lockedByEnv: false });
  });

  it("does not let a member turn AI back on", async () => {
    const res = await asUser(userOn)(
      request(app).put("/api/settings/ai/instance").send({ aiOff: false }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ADMIN_REQUIRED");
  });

  it("does not block non-AI endpoints", async () => {
    const res = await asUser(userOn)(request(app).get("/api/contacts"));
    expect(res.status).toBe(200);
  });
});
