import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import http from "http";
import { z } from "zod";
import { makeTestApp } from "./helpers.ts";
import { createActor, resetAccounts, type Actor } from "./tenancy/helpers.ts";
import { ensureLocalOwner, sqlite } from "../../server/db.ts";
import { vecTableWidth } from "../../server/db/vec.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import {
  createConnector,
  updateConnector,
} from "../../server/connectors/service.ts";
import { registerAdapter } from "../../server/connectors/registry.ts";
import type {
  ConnectorAdapter,
  SyncEvent,
} from "../../server/connectors/types.ts";
import { ingestStream } from "../../server/connectors/ingest.ts";
import { buildContactMatcher } from "../../server/connectors/matching.ts";
import { contactService } from "../../server/services/contactService.ts";
import {
  rebuildDedupeEmbeddingTable,
  storeEmbedding,
} from "../../server/services/dedupe/embeddings.ts";
import { createToken } from "../../server/services/apiTokenService.ts";
import { getUserById } from "../../server/services/authService.ts";
import { renamePasskey } from "../../server/services/passkeyService.ts";
import { deleteSetting } from "../../server/services/settingsService.ts";

describe("v2 Pre-launch Security, Resiliency & Integrity Regression Suite", () => {
  let server: http.Server;
  let actor: Actor;

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";
    server = makeTestApp();
    if (!server.listening) {
      await new Promise((resolve) => server.once("listening", resolve));
    }
    actor = await createActor(server, {
      username: "audit-suite-user",
      email: "audit-suite@example.com",
    });
  });

  afterAll(() => {
    delete process.env.AUTH_REQUIRED;
    resetAccounts();
  });

  it("[P0 #1] refuses changing connector host/url while keeping stored secret (SECRET_NEEDS_REENTRY)", async () => {
    const adapterKind = "test-dest-guard";
    registerAdapter({
      kind: adapterKind as "imap",
      label: "Test Dest Guard",
      configSchema: z.object({ host: z.string(), port: z.number() }),
      secretSchema: z.object({ password: z.string() }),
      redactConfig: (cfg: unknown) => cfg as Record<string, unknown>,
      async test() {
        return { ok: true };
      },
      async *sync() {
        yield* [];
        return {};
      },
    } as unknown as ConnectorAdapter<unknown, unknown>);

    const scope = scopeForOwnerId(actor.user.id);
    const created = await createConnector(scope, {
      kind: adapterKind as "imap",
      name: "Work IMAP",
      config: { host: "imap.legit.example.com", port: 993 },
      secret: { password: "top-secret-password" },
    });

    // Renaming without changing destination succeeds while keeping stored secret
    const renamed = await updateConnector(scope, created.id, {
      name: "Renamed IMAP",
      config: { host: "imap.legit.example.com", port: 993 },
    });
    expect(renamed.name).toBe("Renamed IMAP");

    // Changing host without re-supplying secret must be rejected with 400 SECRET_NEEDS_REENTRY
    await expect(
      updateConnector(scope, created.id, {
        config: { host: "attacker.example.com", port: 993 },
      }),
    ).rejects.toThrow(/Type the password again/i);
  });

  it("[P0 #3] blocks cross-site write requests even when AUTH_REQUIRED=false (implicit principal)", async () => {
    ensureLocalOwner();
    process.env.AUTH_REQUIRED = "false";
    try {
      const res = await request(server)
        .post("/api/contacts")
        .set("Sec-Fetch-Site", "cross-site")
        .send({ name: "CSRF Victim" });

      expect(res.status).toBe(403);
      expect(res.body.error?.code || res.body.code).toBe("CROSS_SITE_REQUEST");
    } finally {
      process.env.AUTH_REQUIRED = "true";
    }
  });

  it("[P0 #4] Google incremental sync preserves unchanged future upcoming_events and removes upcoming_cancelled events", async () => {
    const scope = scopeForOwnerId(actor.user.id);
    contactService.createContact(scope, {
      name: "Calendar Partner",
      emails: [{ email: "calendar-partner@example.com", label: "work" }],
    });

    const connId = "conn-google-inc-test";
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO connectors (id, ownerId, kind, name, status, config, intervalMinutes)
         VALUES (?, ?, 'google', 'Google Test', 'idle', '{}', 60)`,
      )
      .run(connId, scope.ownerId);

    const futureStart1 = new Date(Date.now() + 48 * 3600_000).toISOString();
    const futureEnd1 = new Date(Date.now() + 49 * 3600_000).toISOString();
    const futureStart2 = new Date(Date.now() + 72 * 3600_000).toISOString();
    const futureEnd2 = new Date(Date.now() + 73 * 3600_000).toISOString();

    async function* firstSync(): AsyncGenerator<SyncEvent, unknown, void> {
      yield {
        kind: "upcoming",
        externalId: "gcal-evt-1",
        title: "Keep Me Meeting",
        startsAt: futureStart1,
        endsAt: futureEnd1,
        participants: [{ email: "calendar-partner@example.com" }],
      };
      yield {
        kind: "upcoming",
        externalId: "gcal-evt-2",
        title: "Cancel Me Meeting",
        startsAt: futureStart2,
        endsAt: futureEnd2,
        participants: [{ email: "calendar-partner@example.com" }],
      };
      return {};
    }

    const matcher = buildContactMatcher(scope);
    const connInfo = {
      id: connId,
      ownerId: scope.ownerId,
      kind: "google" as const,
      config: { syncCalendar: true },
    };

    await ingestStream(scope, connInfo, firstSync(), matcher, {
      emails: [],
      phones: [],
    });

    // Second incremental delta sync: only yields a cancellation for gcal-evt-2
    // and does NOT re-yield gcal-evt-1.
    async function* deltaSync(): AsyncGenerator<SyncEvent, unknown, void> {
      yield {
        kind: "upcoming_cancelled",
        externalId: "gcal-evt-2",
      };
      return {};
    }

    await ingestStream(scope, connInfo, deltaSync(), matcher, {
      emails: [],
      phones: [],
    });

    const remaining = sqlite
      .prepare(
        "SELECT externalId, title FROM upcoming_events WHERE connectorId = ? AND ownerId = ?",
      )
      .all(connId, scope.ownerId) as { externalId: string; title: string }[];

    expect(remaining).toEqual([
      { externalId: "gcal-evt-1", title: "Keep Me Meeting" },
    ]);
  });

  it("[P0 #6] bulkCreateContacts queues all created contacts in search_index_queue", async () => {
    const scope = scopeForOwnerId(actor.user.id);
    const result = await contactService.bulkCreateContacts(scope, [
      { name: "Bulk Searchable One", company: "Alpha" },
      { name: "Bulk Searchable Two", company: "Beta" },
    ]);

    expect(result.createdIds).toHaveLength(2);
    const queued = sqlite
      .prepare(
        "SELECT contactId FROM search_index_queue WHERE contactId IN (?, ?) ORDER BY contactId",
      )
      .pluck()
      .all(result.createdIds[0], result.createdIds[1]) as string[];

    expect(queued.sort()).toEqual([...result.createdIds].sort());
  });

  it("[P0 #7] storeEmbedding auto-rebuilds initial 768-dim contact_embeddings table when storing 384-dim local vector", () => {
    const scope = scopeForOwnerId(actor.user.id);
    const contact = contactService.createContact(scope, {
      name: "Vec Width Test",
    });

    // Simulate fresh boot state: 768-dim table and no embeddings_state.dedupe record
    rebuildDedupeEmbeddingTable(768);
    deleteSetting("embeddings_state.dedupe");
    expect(vecTableWidth(sqlite, "contact_embeddings")).toBe("768");

    const vec384 = new Float32Array(384).fill(0.05);
    expect(() => storeEmbedding(contact!.id, vec384)).not.toThrow();
    expect(vecTableWidth(sqlite, "contact_embeddings")).toBe("384");
  });

  it("[P1 #10, #11, #12] enforces mustChangePassword on PATCH /api/auth/me, blocks unfurl for readOnly tokens, and bounds passkey names", async () => {
    // P1 #11: readOnly token cannot call /api/link-preview/unfurl
    const roToken = createToken(
      getUserById(actor.user.id)!,
      { name: "RO Token", readOnly: true },
      "127.0.0.1",
    ).token;

    const unfurlRes = await request(server)
      .get("/api/link-preview/unfurl?url=https://example.com")
      .set("Authorization", `Bearer ${roToken}`);
    expect(unfurlRes.status).toBe(403);
    expect(unfurlRes.body.error?.code || unfurlRes.body.code).toBe(
      "TOKEN_READ_ONLY",
    );

    // P1 #12: passkey rename rejects >100 character name
    expect(() =>
      renamePasskey(
        {} as never,
        actor.user.id,
        "pk-nonexistent",
        "x".repeat(101),
      ),
    ).toThrow(/at most 100 characters/i);

    // P1 #10: when mustChangePassword = 1, GET /api/auth/me works but PATCH /api/auth/me is blocked
    sqlite
      .prepare("UPDATE users SET mustChangePassword = 1 WHERE id = ?")
      .run(actor.user.id);

    const getMe = await request(server)
      .get("/api/auth/me")
      .set("Cookie", actor.cookie);
    expect(getMe.status).toBe(200);

    const patchMe = await request(server)
      .patch("/api/auth/me")
      .set("Cookie", actor.cookie)
      .send({ displayName: "Should Fail" });
    expect(patchMe.status).toBe(403);
    expect(patchMe.body.error?.code || patchMe.body.code).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
  });
});
