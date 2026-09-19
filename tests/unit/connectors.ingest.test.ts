/**
 * tests/unit/connectors.ingest.test.ts — Unit tests for the connector ingestion engine.
 *
 * Covers:
 * - Idempotency (same event twice writes once, increments seenCount)
 * - Correspondent ghost promotion when crossing ghostThreshold
 * - Upcoming refresh replacing stale rows
 * - Batch commits via transactions
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../../server/db.ts");
vi.unmock("../server/db.ts");

import crypto from "node:crypto";
import { sqlite } from "../../server/db.ts";
import { buildContactMatcher } from "../../server/connectors/matching.ts";
import { ingestStream } from "../../server/connectors/ingest.ts";
import type { SyncEvent } from "../../server/connectors/types.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

describe("connectors ingestStream", () => {
  const ownerId = "test-ingest-user-" + crypto.randomUUID().slice(0, 8);
  const connectorId = "conn-" + crypto.randomUUID().slice(0, 8);
  const scope: Scope = scopeForOwnerId(ownerId);

  let contactId: string;

  beforeEach(() => {
    // 1. Create owner
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(ownerId, `${ownerId}@example.com`, ownerId);

    // 2. Create connector
    sqlite
      .prepare(
        `INSERT INTO connectors (id, ownerId, kind, name, status, config, createdAt, updatedAt)
         VALUES (?, ?, 'ics', 'Test Calendar', 'active', '{}', datetime('now'), datetime('now'))`,
      )
      .run(connectorId, ownerId);

    // 3. Create a known contact
    contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, addedAt, updatedAt)
         VALUES (?, ?, 'Known Alice', datetime('now'), datetime('now'))`,
      )
      .run(contactId, ownerId);

    sqlite
      .prepare(
        `INSERT INTO contact_emails (id, contactId, email, isPrimary)
         VALUES (?, ?, 'alice@example.com', 1)`,
      )
      .run(crypto.randomUUID(), contactId);
  });

  afterEach(() => {
    sqlite
      .prepare("DELETE FROM upcoming_events WHERE ownerId = ?")
      .run(ownerId);
    sqlite
      .prepare("DELETE FROM connector_links WHERE ownerId = ?")
      .run(ownerId);
    sqlite.prepare("DELETE FROM interactions WHERE ownerId = ?").run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_emails WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM connectors WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
  });

  it("is idempotent: ingesting the same interaction event twice writes once", async () => {
    const matcher = buildContactMatcher(scope);
    const selfAddresses = { emails: ["me@example.com"], phones: [] };

    const event: SyncEvent = {
      kind: "interaction",
      externalId: "cal-event-101",
      type: "meeting",
      title: "Sync with Alice",
      content: "Discuss roadmap",
      date: "2026-02-01T14:00:00Z",
      participants: [
        { email: "me@example.com", name: "Me" },
        { email: "alice@example.com", name: "Alice" },
      ],
    };

    async function* makeStream(ev: SyncEvent) {
      yield ev;
    }

    // First ingestion
    const res1 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: {} },
      makeStream(event),
      matcher,
      selfAddresses,
    );

    expect(res1.stats.interactions).toBe(1);
    expect(res1.stats.skipped).toBe(0);

    const interactions1 = sqlite
      .prepare("SELECT * FROM interactions WHERE ownerId = ?")
      .all(ownerId);
    expect(interactions1).toHaveLength(1);

    const links1 = sqlite
      .prepare(
        "SELECT * FROM connector_links WHERE connectorId = ? AND externalId = ?",
      )
      .all(connectorId, "cal-event-101") as Array<{
      seenCount: number;
      localId: string;
    }>;
    expect(links1).toHaveLength(1);
    expect(links1[0].seenCount).toBe(1);
    expect(links1[0].localId).toBe((interactions1[0] as { id: string }).id);

    // Second ingestion (same externalId)
    const res2 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: {} },
      makeStream(event),
      matcher,
      selfAddresses,
    );

    expect(res2.stats.interactions).toBe(0);
    expect(res2.stats.skipped).toBe(1);

    const interactions2 = sqlite
      .prepare("SELECT * FROM interactions WHERE ownerId = ?")
      .all(ownerId);
    expect(interactions2).toHaveLength(1); // No new interaction created

    const links2 = sqlite
      .prepare(
        "SELECT * FROM connector_links WHERE connectorId = ? AND externalId = ?",
      )
      .all(connectorId, "cal-event-101") as Array<{ seenCount: number }>;
    expect(links2[0].seenCount).toBe(2);
  });

  it("promotes unknown correspondents to ghost contacts when crossing ghostThreshold", async () => {
    const matcher = buildContactMatcher(scope);
    const selfAddresses = { emails: ["me@example.com"], phones: [] };
    const strangerEmail = "stranger@unknown.org";

    const makeEvent = (id: string): SyncEvent => ({
      kind: "interaction",
      externalId: id,
      type: "meeting",
      title: `Meeting ${id}`,
      date: "2026-02-02T10:00:00Z",
      participants: [
        { email: "me@example.com", name: "Me" },
        { email: strangerEmail, name: "Mysterious Stranger" },
      ],
    });

    // ghostThreshold = 3
    // Run 1: first encounter -> correspondent link created, seenCount = 1
    async function* s1() {
      yield makeEvent("stranger-event-1");
    }
    const r1 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: { ghostThreshold: 3 } },
      s1(),
      matcher,
      selfAddresses,
    );
    expect(r1.stats.correspondents).toBe(1);
    expect(r1.stats.ghosts).toBe(0);

    // Run 2: second encounter -> seenCount = 2, still correspondent
    async function* s2() {
      yield makeEvent("stranger-event-2");
    }
    const r2 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: { ghostThreshold: 3 } },
      s2(),
      matcher,
      selfAddresses,
    );
    expect(r2.stats.correspondents).toBe(0);
    expect(r2.stats.ghosts).toBe(0);

    // Run 3: third encounter -> reaches threshold 3! Promoted to ghost contact!
    async function* s3() {
      yield makeEvent("stranger-event-3");
    }
    const r3 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: { ghostThreshold: 3 } },
      s3(),
      matcher,
      selfAddresses,
    );
    expect(r3.stats.ghosts).toBe(1);

    // Verify ghost contact exists in DB
    const ghostContact = sqlite
      .prepare("SELECT * FROM contacts WHERE ownerId = ? AND isGhost = 1")
      .get(ownerId) as
      { id: string; name: string; isGhost: number } | undefined;
    expect(ghostContact).toBeDefined();
    expect(ghostContact?.name).toBe("Mysterious Stranger");
    expect(ghostContact?.isGhost).toBe(1);

    // Verify correspondent link now points to the ghost contact
    const link = sqlite
      .prepare(
        "SELECT * FROM connector_links WHERE connectorId = ? AND kind = 'correspondent' AND externalId = ?",
      )
      .get(connectorId, strangerEmail) as {
      localId: string;
      seenCount: number;
    };
    expect(link.seenCount).toBe(3);
    expect(link.localId).toBe(ghostContact?.id);
  });

  it("replaces stale upcoming_events rows on new sync pass", async () => {
    const matcher = buildContactMatcher(scope);
    const selfAddresses = { emails: ["me@example.com"], phones: [] };

    // Pass 1: events A and B
    async function* pass1() {
      yield {
        kind: "upcoming" as const,
        externalId: "event-a",
        title: "Future Event A",
        startsAt: "2026-03-01T10:00:00Z",
        endsAt: "2026-03-01T11:00:00Z",
        participants: [{ email: "alice@example.com" }],
      };
      yield {
        kind: "upcoming" as const,
        externalId: "event-b",
        title: "Future Event B",
        startsAt: "2026-03-02T10:00:00Z",
        endsAt: "2026-03-02T11:00:00Z",
        participants: [],
      };
    }

    const r1 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: {} },
      pass1(),
      matcher,
      selfAddresses,
    );
    expect(r1.stats.upcoming).toBe(2);

    const rows1 = sqlite
      .prepare(
        "SELECT externalId FROM upcoming_events WHERE connectorId = ? ORDER BY externalId ASC",
      )
      .all(connectorId) as Array<{ externalId: string }>;
    expect(rows1.map((r) => r.externalId)).toEqual(["event-a", "event-b"]);

    // Pass 2: event B is gone, replaced by event C, event A is updated
    async function* pass2() {
      yield {
        kind: "upcoming" as const,
        externalId: "event-a",
        title: "Future Event A Updated",
        startsAt: "2026-03-01T10:00:00Z",
        endsAt: "2026-03-01T11:30:00Z",
        participants: [{ email: "alice@example.com" }],
      };
      yield {
        kind: "upcoming" as const,
        externalId: "event-c",
        title: "Future Event C",
        startsAt: "2026-03-03T10:00:00Z",
        endsAt: "2026-03-03T11:00:00Z",
        participants: [],
      };
    }

    const r2 = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: {} },
      pass2(),
      matcher,
      selfAddresses,
    );
    expect(r2.stats.upcoming).toBe(2);

    const rows2 = sqlite
      .prepare(
        "SELECT externalId, title FROM upcoming_events WHERE connectorId = ? ORDER BY externalId ASC",
      )
      .all(connectorId) as Array<{ externalId: string; title: string }>;

    // event-b should be deleted! event-a updated, event-c inserted!
    expect(rows2).toEqual([
      { externalId: "event-a", title: "Future Event A Updated" },
      { externalId: "event-c", title: "Future Event C" },
    ]);
  });

  it("commits in transactions according to batchSize", async () => {
    const matcher = buildContactMatcher(scope);
    const selfAddresses = { emails: ["me@example.com"], phones: [] };

    const events: SyncEvent[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "interaction",
      externalId: `batch-event-${i}`,
      type: "meeting",
      title: `Batch Meeting ${i}`,
      date: `2026-02-0${i + 1}T10:00:00Z`,
      participants: [
        { email: "me@example.com", isSelf: true },
        { email: "alice@example.com" },
      ],
    }));

    async function* generateBatch() {
      for (const ev of events) {
        yield ev;
      }
    }

    let progressCallbacks = 0;
    const res = await ingestStream(
      scope,
      { id: connectorId, ownerId, kind: "ics", config: {} },
      generateBatch(),
      matcher,
      selfAddresses,
      {
        batchSize: 2,
        onProgress: () => {
          progressCallbacks++;
        },
      },
    );

    expect(res.stats.interactions).toBe(5);
    // With 5 events and batchSize 2: batches at 2, 4, remaining 1 at end, plus final progress callback
    expect(progressCallbacks).toBeGreaterThanOrEqual(3);

    const savedCount = sqlite
      .prepare("SELECT COUNT(*) as count FROM interactions WHERE ownerId = ?")
      .get(ownerId) as { count: number };
    expect(savedCount.count).toBe(5);
  });
});
