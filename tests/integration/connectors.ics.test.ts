/**
 * tests/integration/connectors.ics.test.ts — End-to-end integration of ICS calendar adapter.
 *
 * Covers:
 * - In-process HTTP server serving an ICS fixture
 * - CONNECTORS_ALLOW_PRIVATE_HOSTS=true allowing loopback URL
 * - Meeting interaction linked to seeded contact
 * - Contact lastContactedAt backdated to meeting date
 * - upcoming_events populated for future calendar events
 * - Idempotency across successive sync passes (no duplicate interactions)
 */

import crypto from "node:crypto";
import http from "http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import { createConnector, runNow } from "../../server/connectors/service.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

describe("ICS Calendar Adapter Integration", () => {
  let fixtureServer: http.Server;
  let icsUrl: string;

  const ownerId = "ics-test-owner-" + crypto.randomUUID().slice(0, 8);
  const scope: Scope = scopeForOwnerId(ownerId);
  let contactId: string;

  function toIcsDate(d: Date): string {
    return d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  }

  // Use seconds-truncated Date objects for clean ISO matching
  const pastDate = new Date(
    Math.floor((Date.now() - 5 * 86400000) / 1000) * 1000,
  );
  const pastEndDate = new Date(pastDate.getTime() + 3600000);
  const futureDate = new Date(
    Math.floor((Date.now() + 5 * 86400000) / 1000) * 1000,
  );
  const futureEndDate = new Date(futureDate.getTime() + 3600000);

  const ICS_FIXTURE = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Contrack Integration Tests//EN
CALSCALE:GREGORIAN

BEGIN:VEVENT
UID:past-strat-meeting-1@test.org
DTSTAMP:20260101T000000Z
DTSTART:${toIcsDate(pastDate)}
DTEND:${toIcsDate(pastEndDate)}
SUMMARY:Strategy Session with Partner
DESCRIPTION:Quarterly review and sync
ORGANIZER;CN=Host:mailto:host@example.com
ATTENDEE;CN=Strategic Partner:mailto:partner@example.com
END:VEVENT

BEGIN:VEVENT
UID:future-planning-meeting-2@test.org
DTSTAMP:20260101T000000Z
DTSTART:${toIcsDate(futureDate)}
DTEND:${toIcsDate(futureEndDate)}
SUMMARY:Future Planning Q4
DESCRIPTION:Discussion of upcoming priorities
ORGANIZER;CN=Host:mailto:host@example.com
ATTENDEE;CN=Strategic Partner:mailto:partner@example.com
END:VEVENT

END:VCALENDAR`;

  beforeAll(async () => {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";

    // 1. Start in-process HTTP fixture server
    fixtureServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/calendar" });
      res.end(ICS_FIXTURE);
    });

    await new Promise<void>((resolve) =>
      fixtureServer.listen(0, "127.0.0.1", resolve),
    );
    const addr = fixtureServer.address() as AddressInfo;
    icsUrl = `http://127.0.0.1:${addr.port}/calendar.ics`;

    // 2. Seed owner
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, 'host@example.com', ?, 'hash')`,
      )
      .run(ownerId, ownerId);

    // 3. Seed contact matching the attendee
    contactId = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, addedAt, updatedAt)
         VALUES (?, ?, 'Strategic Partner', ?, ?)`,
      )
      .run(contactId, ownerId, nowIso, nowIso);

    sqlite
      .prepare(
        `INSERT INTO contact_emails (id, contactId, email, isPrimary)
         VALUES (?, ?, 'partner@example.com', 1)`,
      )
      .run(crypto.randomUUID(), contactId);
  });

  afterAll(async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;

    if (fixtureServer) {
      await new Promise<void>((resolve) =>
        fixtureServer.close(() => resolve()),
      );
    }

    sqlite
      .prepare("DELETE FROM upcoming_events WHERE ownerId = ?")
      .run(ownerId);
    sqlite
      .prepare("DELETE FROM connector_links WHERE ownerId = ?")
      .run(ownerId);
    sqlite.prepare("DELETE FROM connector_runs WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM connectors WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM interactions WHERE ownerId = ?").run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_emails WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
  });

  it("syncs calendar feed, links past meeting to contact, backdates lastContactedAt, populates upcoming_events, and is idempotent", async () => {
    // 1. Create connector pointing to local fixture
    const connector = await createConnector(scope, {
      kind: "ics",
      name: "Local Test Calendar",
      config: {
        url: icsUrl,
        lookbackDays: 365,
        maxAttendees: 25,
        includeDescription: true,
      },
    });

    expect(connector.id).toBeTruthy();

    // 2. First sync pass
    const run1 = await runNow(scope, connector.id, "manual");
    expect(run1.status).toBe("ok");
    expect(run1.stats.interactions).toBe(1);
    expect(run1.stats.upcoming).toBe(1);

    // Verify interaction in DB
    const interactions = sqlite
      .prepare("SELECT * FROM interactions WHERE ownerId = ?")
      .all(ownerId) as Array<{
      id: string;
      contactId: string;
      type: string;
      title: string;
      date: string;
      source: string;
      content: string;
    }>;

    expect(interactions).toHaveLength(1);
    const meeting = interactions[0];
    expect(meeting.contactId).toBe(contactId);
    expect(meeting.type).toBe("meeting");
    expect(meeting.title).toBe("Strategy Session with Partner");
    expect(meeting.source).toBe("ics");
    expect(meeting.content).toContain("Quarterly review and sync");

    // Verify contact lastContactedAt was backdated to the meeting date
    const contactRow = sqlite
      .prepare("SELECT lastContactedAt FROM contacts WHERE id = ?")
      .get(contactId) as { lastContactedAt: string | null };

    expect(contactRow.lastContactedAt).toBeTruthy();
    expect(new Date(contactRow.lastContactedAt!).toISOString()).toBe(
      pastDate.toISOString(),
    );

    // Verify upcoming_events in DB
    const upcoming = sqlite
      .prepare("SELECT * FROM upcoming_events WHERE connectorId = ?")
      .all(connector.id) as Array<{
      title: string;
      startsAt: string;
      contactIds: string;
    }>;

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].title).toBe("Future Planning Q4");
    expect(new Date(upcoming[0].startsAt).toISOString()).toBe(
      futureDate.toISOString(),
    );
    expect(JSON.parse(upcoming[0].contactIds)).toContain(contactId);

    // 3. Second sync pass (Idempotency test)
    const run2 = await runNow(scope, connector.id, "manual");
    expect(run2.status).toBe("ok");
    expect(run2.stats.interactions).toBe(0); // None created!
    expect(run2.stats.skipped).toBe(1); // Past meeting was skipped

    // Interactions count is still exactly 1
    const interactionsAfter = sqlite
      .prepare("SELECT COUNT(*) AS count FROM interactions WHERE ownerId = ?")
      .get(ownerId) as { count: number };
    expect(interactionsAfter.count).toBe(1);

    // Upcoming events count is still exactly 1
    const upcomingAfter = sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM upcoming_events WHERE connectorId = ?",
      )
      .get(connector.id) as { count: number };
    expect(upcomingAfter.count).toBe(1);
  });
});
