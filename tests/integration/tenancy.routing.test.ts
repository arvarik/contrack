// =============================================================================
// Integration Tests — router mount order and the request id on a limiter 429
// =============================================================================
// Task 0.11. contactsRouter used to mount before mcpRouter, so the literal
// path GET /api/contacts/action-items was captured by GET /api/contacts/:id,
// which looked up "action-items" as a contact id and answered 404. The route
// was dead. mcpRouter now mounts first, and these tests hold that order in
// place while proving the :id route still works.
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import http from "http";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("GET /api/contacts/action-items", () => {
  it("reaches the MCP handler instead of being captured by /contacts/:id", async () => {
    const res = await request(app).get("/api/contacts/action-items");

    expect(res.status).toBe(200);
    // The MCP payload is a list of contacts with their open action items.
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("returns the MCP payload, which is the contacts that are due", async () => {
    // mcpService.getActionItems() answers "who is due for follow-up", so a
    // contact with a past nextFollowUpAt must appear. That proves the MCP
    // handler ran, not merely that some handler returned an array.
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Ada Lovelace", nextFollowUpAt: "2020-01-01" });
    expect(created.status).toBe(201);

    const res = await request(app).get("/api/contacts/action-items");
    expect(res.status).toBe(200);
    const mine = (res.body as { id?: string }[]).find(
      (r) => r.id === created.body.id,
    );
    expect(mine).toBeTruthy();
  });
});

describe("GET /api/contacts/:id still resolves after the reorder", () => {
  it("returns the contact for a real id", async () => {
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Grace Hopper" });
    expect(created.status).toBe(201);

    const res = await request(app).get(`/api/contacts/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Grace Hopper");
  });

  it("still 404s for an id that does not exist", async () => {
    const res = await request(app).get(
      "/api/contacts/00000000-0000-4000-8000-000000000999",
    );
    expect(res.status).toBe(404);
  });
});

describe("the AI rate limiter", () => {
  it("carries a requestId on its 429, because req.requestId is assigned first", async () => {
    // A dedicated app: makeTestApp disables the limiter on purpose.
    const limited = createApp();
    limited.use(notFoundHandler);
    const server = http.createServer(finalizeApp(limited));
    server.listen(0, "127.0.0.1");
    server.unref();

    // /api/parse-contact matches AI_COST_PATTERNS and rejects an empty body
    // quickly, so the window fills without doing any real work. max is 60.
    let last = await request(server).post("/api/parse-contact").send({});
    for (let i = 0; i < 61 && last.status !== 429; i++) {
      last = await request(server).post("/api/parse-contact").send({});
    }

    expect(last.status).toBe(429);
    // The envelope nests the trace id under `error`, and the header repeats it.
    expect(last.body.error.requestId).toMatch(/^[0-9a-f]{8}$/);
    expect(last.headers["x-request-id"]).toBe(last.body.error.requestId);
    expect(last.body.error.code).toBe("RATE_LIMITED");
    server.close();
  });
});
