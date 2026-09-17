// =============================================================================
// Integration: requireAiAllowed middleware & aiAssist preference
// =============================================================================
// When an account sets `aiAssist: false`, every endpoint that incurs an AI cost
// answers 403 AI_OFF_FOR_ACCOUNT for that account, but remains accessible for
// other accounts and for non-AI routes.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { asUser, createActor, type Actor } from "./tenancy/helpers.ts";

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
      { method: "post", path: "/api/search/semantic", body: { query: "test" } },
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
      if (res.status === 403) {
        expect(res.body.error.code).not.toBe("AI_OFF_FOR_ACCOUNT");
      }
    });
  }

  it("does not block non-AI endpoints for the account with AI off", async () => {
    const res = await asUser(userOff)(request(app).get("/api/contacts"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
