/**
 * tests/integration/api.connectors.test.ts — Integration tests for /api/connectors.
 *
 * Covers:
 * - Session requirement on mutations (403 SESSION_REQUIRED for API tokens)
 * - Multi-tenant isolation: other owner returns 404
 * - POST /test never persists rows to the database
 * - Secrets stripped from output (only secretPresent returned)
 * - Delete with and without deleteImported flag
 * - Inline sync when DISABLE_BACKGROUND_JOBS=true
 * - Exponential backoff on transient error
 * - ConnectorAuthError transitions connector to needs_reauth and records audit log
 */

import crypto from "node:crypto";
import http from "http";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeTestApp } from "./helpers.ts";
import { createActor, resetAccounts, type Actor } from "./tenancy/helpers.ts";
import { createToken } from "../../server/services/apiTokenService.ts";
import { getUserById } from "../../server/services/authService.ts";
import { sqlite } from "../../server/db.ts";
import { registerAdapter } from "../../server/connectors/registry.ts";
import { ConnectorAuthError } from "../../server/connectors/errors.ts";
import type {
  ConnectorAdapter,
  SyncContext,
  SyncEvent,
} from "../../server/connectors/types.ts";
import type { ConnectorKind } from "../../shared/connectors.ts";
import { z } from "zod";

describe("Connectors API (/api/connectors)", () => {
  let server: http.Server;
  let actorA: Actor;
  let actorB: Actor;
  let tokenA: string;

  // Mock test adapter for controlled errors & sync events
  const mockAdapterKind = "mock-test";
  let syncShouldThrowAuthError = false;
  let syncShouldThrowGenericError = false;

  const mockAdapter: ConnectorAdapter<
    { testKey?: string },
    { secretKey?: string }
  > = {
    kind: mockAdapterKind as unknown as ConnectorKind,
    label: "Mock Adapter",
    description: "Mock Adapter for testing",
    capabilities: { schedule: true },
    configSchema: z.object({
      testKey: z.string().optional(),
    }),
    secretSchema: z.object({
      secretKey: z.string().optional(),
    }),
    async test(_config, _secret) {
      return { ok: true, detail: "Mock adapter test passed" };
    },
    async *sync(
      _ctx: SyncContext<{ testKey?: string }, { secretKey?: string }>,
    ): AsyncGenerator<SyncEvent, unknown, void> {
      if (syncShouldThrowAuthError) {
        throw new ConnectorAuthError("Bad mock credentials");
      }
      if (syncShouldThrowGenericError) {
        throw new Error("Temporary network timeout");
      }
      yield {
        kind: "interaction",
        externalId: "mock-evt-1",
        type: "meeting",
        title: "Test Meeting",
        date: "2026-02-01T10:00:00Z",
        participants: [{ email: "test@example.com" }],
      };
      return { lastSyncAt: "2026-02-01T10:00:00Z" };
    },
  };

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";

    registerAdapter(
      mockAdapter as unknown as ConnectorAdapter<unknown, unknown>,
    );

    server = makeTestApp();
    if (!server.listening) {
      await new Promise((resolve) => server.once("listening", resolve));
    }

    actorA = await createActor(server, {
      username: "connector-alice",
      email: "alice@example.com",
    });
    actorB = await createActor(server, {
      username: "connector-bob",
      email: "bob@example.com",
    });

    tokenA = createToken(
      getUserById(actorA.user.id)!,
      { name: "Alice Token" },
      "127.0.0.1",
    ).token;
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = "";
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    resetAccounts();
  });

  beforeEach(() => {
    syncShouldThrowAuthError = false;
    syncShouldThrowGenericError = false;
  });

  it("enforces session requirement on mutations (403 SESSION_REQUIRED when using API token)", async () => {
    // 1. POST / (create) with token -> 403
    const postRes = await request(server)
      .post("/api/connectors")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        kind: mockAdapterKind,
        name: "Token Connector",
        config: {},
      });
    expect(postRes.status).toBe(403);
    expect(postRes.body.error?.code || postRes.body.code).toBe(
      "SESSION_REQUIRED",
    );

    // 2. POST /test with token -> 403
    const testRes = await request(server)
      .post("/api/connectors/test")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        kind: mockAdapterKind,
        config: {},
      });
    expect(testRes.status).toBe(403);
    expect(testRes.body.error?.code || testRes.body.code).toBe(
      "SESSION_REQUIRED",
    );

    // 3. PATCH /:id with token -> 403
    const patchRes = await request(server)
      .patch("/api/connectors/conn-123")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ name: "Renamed" });
    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error?.code || patchRes.body.code).toBe(
      "SESSION_REQUIRED",
    );

    // 4. DELETE /:id with token -> 403
    const delRes = await request(server)
      .delete("/api/connectors/conn-123")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(delRes.status).toBe(403);
    expect(delRes.body.error?.code || delRes.body.code).toBe(
      "SESSION_REQUIRED",
    );

    // 5. POST /:id/sync with token -> 403
    const syncRes = await request(server)
      .post("/api/connectors/conn-123/sync")
      .set("Authorization", `Bearer ${tokenA}`);
    expect(syncRes.status).toBe(403);
    expect(syncRes.body.error?.code || syncRes.body.code).toBe(
      "SESSION_REQUIRED",
    );
  });

  it("POST /test proves credentials without persisting anything to the database", async () => {
    const countBefore = (
      sqlite.prepare("SELECT COUNT(*) AS c FROM connectors").get() as {
        c: number;
      }
    ).c;

    const res = await request(server)
      .post("/api/connectors/test")
      .set("Cookie", actorA.cookie)
      .send({
        kind: mockAdapterKind,
        config: { testKey: "test-val" },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.detail).toBe("Mock adapter test passed");

    const countAfter = (
      sqlite.prepare("SELECT COUNT(*) AS c FROM connectors").get() as {
        c: number;
      }
    ).c;
    expect(countAfter).toBe(countBefore);
  });

  it("creates a connector and strips secrets from output", async () => {
    const res = await request(server)
      .post("/api/connectors")
      .set("Cookie", actorA.cookie)
      .send({
        kind: mockAdapterKind,
        name: "Alice Calendar",
        config: { testKey: "test-val" },
        secret: { secretKey: "super-secret-pass" },
      });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Alice Calendar");
    expect(res.body.secretPresent).toBe(true);
    // Secret itself must never be in JSON output
    expect(res.body.secret).toBeUndefined();
    expect(res.body.secretKey).toBeUndefined();

    const connId = res.body.id;

    // GET /api/connectors/:id
    const getRes = await request(server)
      .get(`/api/connectors/${connId}`)
      .set("Cookie", actorA.cookie);

    expect(getRes.status).toBe(200);
    expect(getRes.body.secretPresent).toBe(true);
    expect(getRes.body.secret).toBeUndefined();

    // Verify in database: secret is encrypted, not plaintext
    const dbRow = sqlite
      .prepare("SELECT secret FROM connectors WHERE id = ?")
      .get(connId) as { secret: string };
    expect(dbRow.secret).toBeTruthy();
    expect(dbRow.secret).not.toContain("super-secret-pass");
  });

  it("enforces tenant isolation: another owner cannot read, modify, delete or sync", async () => {
    // Create connector for Actor A
    const createRes = await request(server)
      .post("/api/connectors")
      .set("Cookie", actorA.cookie)
      .send({
        kind: mockAdapterKind,
        name: "Alice Private Connector",
        config: {},
      });
    const connId = createRes.body.id;

    // Actor B tries GET /api/connectors/:id -> 404
    const getRes = await request(server)
      .get(`/api/connectors/${connId}`)
      .set("Cookie", actorB.cookie);
    expect(getRes.status).toBe(404);

    // Actor B tries PATCH /api/connectors/:id -> 404
    const patchRes = await request(server)
      .patch(`/api/connectors/${connId}`)
      .set("Cookie", actorB.cookie)
      .send({ name: "Bob Hijack" });
    expect(patchRes.status).toBe(404);

    // Actor B tries POST /api/connectors/:id/sync -> 404
    const syncRes = await request(server)
      .post(`/api/connectors/${connId}/sync`)
      .set("Cookie", actorB.cookie);
    expect(syncRes.status).toBe(404);

    // Actor B tries DELETE /api/connectors/:id -> 404
    const delRes = await request(server)
      .delete(`/api/connectors/${connId}`)
      .set("Cookie", actorB.cookie);
    expect(delRes.status).toBe(404);

    // Ensure it still exists for Actor A
    const verifyRes = await request(server)
      .get(`/api/connectors/${connId}`)
      .set("Cookie", actorA.cookie);
    expect(verifyRes.status).toBe(200);
  });

  it("deletes connector without deleteImported (retains imported data)", async () => {
    // 1. Create connector
    const createRes = await request(server)
      .post("/api/connectors")
      .set("Cookie", actorA.cookie)
      .send({
        kind: mockAdapterKind,
        name: "To Delete Keep Data",
        config: {},
      });
    const connId = createRes.body.id;

    // 2. Create imported interaction + link and ghost contact + link
    const contactId = crypto.randomUUID();
    const interactionId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    sqlite
      .prepare(
        "INSERT INTO contacts (id, ownerId, name, isGhost, addedAt, updatedAt) VALUES (?, ?, 'Ghost 1', 1, ?, ?)",
      )
      .run(contactId, actorA.user.id, nowIso, nowIso);

    sqlite
      .prepare(
        "INSERT INTO interactions (id, ownerId, contactId, type, title, date, updatedAt) VALUES (?, ?, ?, 'meeting', 'Imported Meeting', ?, ?)",
      )
      .run(interactionId, actorA.user.id, contactId, nowIso, nowIso);

    sqlite
      .prepare(
        "INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt) VALUES (?, ?, 'interaction', 'evt-del-1', ?, 1, ?)",
      )
      .run(connId, actorA.user.id, interactionId, nowIso);

    sqlite
      .prepare(
        "INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt) VALUES (?, ?, 'correspondent', 'ghost-del-1', ?, 1, ?)",
      )
      .run(connId, actorA.user.id, contactId, nowIso);

    // 3. Delete connector WITHOUT deleteImported
    const delRes = await request(server)
      .delete(`/api/connectors/${connId}`)
      .set("Cookie", actorA.cookie);
    expect(delRes.status).toBe(204);

    // Connector is gone
    const connCheck = sqlite
      .prepare("SELECT * FROM connectors WHERE id = ?")
      .get(connId);
    expect(connCheck).toBeUndefined();

    // Interaction and Ghost contact remain!
    const intCheck = sqlite
      .prepare("SELECT * FROM interactions WHERE id = ?")
      .get(interactionId);
    expect(intCheck).toBeDefined();

    const ghostCheck = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(contactId);
    expect(ghostCheck).toBeDefined();
  });

  it("deletes connector with deleteImported (removes imported interactions and ghost contacts)", async () => {
    // 1. Create connector
    const createRes = await request(server)
      .post("/api/connectors")
      .set("Cookie", actorA.cookie)
      .send({
        kind: mockAdapterKind,
        name: "To Delete Purge Data",
        config: {},
      });
    const connId = createRes.body.id;

    // 2. Create imported interaction + link and ghost contact + link
    const contactId = crypto.randomUUID();
    const interactionId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    sqlite
      .prepare(
        "INSERT INTO contacts (id, ownerId, name, isGhost, addedAt, updatedAt) VALUES (?, ?, 'Ghost Purge', 1, ?, ?)",
      )
      .run(contactId, actorA.user.id, nowIso, nowIso);

    sqlite
      .prepare(
        "INSERT INTO interactions (id, ownerId, contactId, type, title, date, updatedAt) VALUES (?, ?, ?, 'meeting', 'Purge Meeting', ?, ?)",
      )
      .run(interactionId, actorA.user.id, contactId, nowIso, nowIso);

    sqlite
      .prepare(
        "INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt) VALUES (?, ?, 'interaction', 'evt-purge-1', ?, 1, ?)",
      )
      .run(connId, actorA.user.id, interactionId, nowIso);

    sqlite
      .prepare(
        "INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt) VALUES (?, ?, 'correspondent', 'ghost-purge-1', ?, 1, ?)",
      )
      .run(connId, actorA.user.id, contactId, nowIso);

    // 3. Delete connector WITH deleteImported=true
    const delRes = await request(server)
      .delete(`/api/connectors/${connId}?deleteImported=true`)
      .set("Cookie", actorA.cookie);
    expect(delRes.status).toBe(204);

    // Connector is gone
    const connCheck = sqlite
      .prepare("SELECT * FROM connectors WHERE id = ?")
      .get(connId);
    expect(connCheck).toBeUndefined();

    // Interaction and Ghost contact are also deleted!
    const intCheck = sqlite
      .prepare("SELECT * FROM interactions WHERE id = ?")
      .get(interactionId);
    expect(intCheck).toBeUndefined();

    const ghostCheck = sqlite
      .prepare("SELECT * FROM contacts WHERE id = ?")
      .get(contactId);
    expect(ghostCheck).toBeUndefined();
  });

  it("syncs inline when DISABLE_BACKGROUND_JOBS=true", async () => {
    process.env.DISABLE_BACKGROUND_JOBS = "true";

    try {
      const createRes = await request(server)
        .post("/api/connectors")
        .set("Cookie", actorA.cookie)
        .send({
          kind: mockAdapterKind,
          name: "Sync Inline Test",
          config: {},
        });
      const connId = createRes.body.id;

      const syncRes = await request(server)
        .post(`/api/connectors/${connId}/sync`)
        .set("Cookie", actorA.cookie);

      expect(syncRes.status).toBe(202);
      expect(syncRes.body.runId).toBeTruthy();

      // Because it synced inline before responding, the run must already be marked 'ok'
      const runRow = sqlite
        .prepare("SELECT * FROM connector_runs WHERE id = ?")
        .get(syncRes.body.runId) as { status: string; finishedAt: string };
      expect(runRow.status).toBe("ok");
      expect(runRow.finishedAt).toBeTruthy();
    } finally {
      delete process.env.DISABLE_BACKGROUND_JOBS;
    }
  });

  it("applies exponential backoff on transient sync error", async () => {
    process.env.DISABLE_BACKGROUND_JOBS = "true";
    syncShouldThrowGenericError = true;

    try {
      const createRes = await request(server)
        .post("/api/connectors")
        .set("Cookie", actorA.cookie)
        .send({
          kind: mockAdapterKind,
          name: "Backoff Test",
          intervalMinutes: 15,
          config: {},
        });
      const connId = createRes.body.id;

      await request(server)
        .post(`/api/connectors/${connId}/sync`)
        .set("Cookie", actorA.cookie);

      const connRow = sqlite
        .prepare(
          "SELECT status, attempts, nextRunAt, lastError FROM connectors WHERE id = ?",
        )
        .get(connId) as {
        status: string;
        attempts: number;
        nextRunAt: string;
        lastError: string;
      };

      expect(connRow.status).toBe("error");
      expect(connRow.attempts).toBe(1);
      expect(connRow.lastError).toContain("Temporary network timeout");

      // nextRunAt should be backoff-delayed: interval 15 * 2^1 = 30 minutes into future
      const nextRunMs = new Date(connRow.nextRunAt).getTime() - Date.now();
      const nextRunMin = Math.round(nextRunMs / 60000);
      expect(nextRunMin).toBeGreaterThanOrEqual(25);
      expect(nextRunMin).toBeLessThanOrEqual(35);
    } finally {
      delete process.env.DISABLE_BACKGROUND_JOBS;
    }
  });

  it("ConnectorAuthError sets status to needs_reauth and records audit row", async () => {
    process.env.DISABLE_BACKGROUND_JOBS = "true";
    syncShouldThrowAuthError = true;

    try {
      const createRes = await request(server)
        .post("/api/connectors")
        .set("Cookie", actorA.cookie)
        .send({
          kind: mockAdapterKind,
          name: "Auth Error Test",
          config: {},
        });
      const connId = createRes.body.id;

      await request(server)
        .post(`/api/connectors/${connId}/sync`)
        .set("Cookie", actorA.cookie);

      const connRow = sqlite
        .prepare("SELECT status, lastError FROM connectors WHERE id = ?")
        .get(connId) as { status: string; lastError: string };

      expect(connRow.status).toBe("needs_reauth");
      expect(connRow.lastError).toContain("Bad mock credentials");

      // Verify audit log has connector.reauth record
      const auditRow = sqlite
        .prepare(
          "SELECT * FROM audit_log WHERE actorUserId = ? AND action = 'connector.reauth' AND targetId = ?",
        )
        .get(actorA.user.id, connId) as { details: string } | undefined;

      expect(auditRow).toBeDefined();
      expect(auditRow?.details).toContain("Bad mock credentials");
    } finally {
      delete process.env.DISABLE_BACKGROUND_JOBS;
    }
  });
});
