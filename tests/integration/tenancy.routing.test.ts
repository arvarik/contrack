// =============================================================================
// Integration Tests — router mount order and the request id on a limiter 429
// =============================================================================
// Task 0.11. contactsRouter used to mount before mcpRouter, so the literal
// path GET /api/contacts/action-items was captured by GET /api/contacts/:id,
// which looked up "action-items" as a contact id and answered 404. The route
// was dead. mcpRouter now mounts first, and the test below holds that order
// in place. The :id route itself is covered by the contact and isolation
// tests.
// =============================================================================

import { describe, it, expect } from "vitest";
import request from "supertest";
import http from "http";
import { createApp, finalizeApp, notFoundHandler } from "../../server/app.ts";
import { makeTestApp } from "./helpers.ts";

const app = makeTestApp();

describe("GET /api/contacts/action-items", () => {
  it("returns the MCP payload, which is the contacts that are due", async () => {
    // mcpService.getActionItems() answers "who is due for follow-up", so a
    // contact with a past nextFollowUpAt must appear. That proves the MCP
    // handler ran, not merely that some handler returned an array.
    const due = { nextFollowUpAt: "2020-01-01" };
    const created = await request(app)
      .post("/api/contacts")
      .send({ name: "Ada Lovelace", ...due });
    expect(created.status).toBe(201);
    // Neither an archived contact nor one in the trash is due, as on Pulse.
    const archived = await request(app)
      .post("/api/contacts")
      .send({ name: "Archived Due", isArchived: true, ...due });
    const trashed = await request(app)
      .post("/api/contacts")
      .send({ name: "Trashed Due", ...due });
    await request(app).delete(`/api/contacts/${trashed.body.id}`).expect(200);

    const res = await request(app).get("/api/contacts/action-items");
    expect(res.status).toBe(200);
    const ids = (res.body as { id?: string }[]).map((r) => r.id);
    expect(ids).toContain(created.body.id);
    expect(ids).not.toContain(archived.body.id);
    expect(ids).not.toContain(trashed.body.id);
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
