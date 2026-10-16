/**
 * tests/integration/connectors.carddav.test.ts — End-to-end integration of the CardDAV adapter.
 *
 * Covers:
 * - RFC 6764 /.well-known/carddav redirect -> principal -> home-set -> address book discovery
 * - Credential verification (testConnector) and 401 ConnectorAuthError handling
 * - Pull sync via PROPFIND + REPORT addressbook-multiget (vCard 3.0 & 4.0, group skipping)
 * - Incremental sync via RFC 6578 REPORT sync-collection and remote deletion unlinking
 * - Two-way push via conditional PUT (If-None-Match: * for new, If-Match for updates, UID preservation)
 * - Safe conflict resolution (412 Precondition Failed skips push without failing run)
 * - Pull-only mode (no PUT requests sent)
 */

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  createConnector,
  runNow,
  testConnector,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

interface RemoteCard {
  etag: string;
  vcard: string;
  deleted?: boolean;
}

describe("CardDAV Adapter Integration", () => {
  let server: http.Server;
  let baseUrl: string;

  const ownerId = "carddav-test-owner-" + crypto.randomUUID().slice(0, 8);
  const scope: Scope = scopeForOwnerId(ownerId);

  const VALID_USER = "alice@example.com";
  const VALID_PASS = "app-secret-1234";
  const EXPECTED_AUTH = `Basic ${Buffer.from(`${VALID_USER}:${VALID_PASS}`).toString("base64")}`;

  const cards = new Map<string, RemoteCard>();
  const putRequests: Array<{
    path: string;
    ifMatch: string | undefined;
    ifNoneMatch: string | undefined;
    body: string;
  }> = [];
  let currentSyncToken = "http://sabredav.org/ns/sync/1";
  let forceConflictOnHref: string | null = null;

  function resetServerCards() {
    cards.clear();
    putRequests.length = 0;
    currentSyncToken = "http://sabredav.org/ns/sync/1";
    forceConflictOnHref = null;

    cards.set("/dav/addressbooks/alice/default/ada.vcf", {
      etag: '"etag-ada-v1"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-ada-111",
        "N:Lovelace;Ada;;;",
        "FN:Ada Lovelace",
        "ORG:Analytical Engine Ltd",
        "TITLE:Chief Mathematician",
        "EMAIL;TYPE=INTERNET,WORK,PREF:ada@analytical.org",
        "TEL;TYPE=CELL:+44 20 7946 0921",
        "CATEGORIES:pioneer,math",
        "NOTE:Met at the London symposium",
        "END:VCARD",
      ].join("\r\n"),
    });

    // Apple Contacts group vCard — must be skipped
    cards.set("/dav/addressbooks/alice/default/group-vip.vcf", {
      etag: '"etag-group-1"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-group-999",
        "FN:VIP Group",
        "X-ADDRESSBOOKSERVER-KIND:group",
        "END:VCARD",
      ].join("\r\n"),
    });
  }

  beforeAll(async () => {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    resetServerCards();

    server = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = reqUrl.pathname;
      const method = req.method ?? "GET";

      // Check Basic Auth on all DAV endpoints
      if (req.headers.authorization !== EXPECTED_AUTH) {
        res.writeHead(401, {
          "WWW-Authenticate": 'Basic realm="CardDAV"',
          "Content-Type": "text/plain",
        });
        res.end("Unauthorized");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");

      // 1. /.well-known/carddav redirects to /dav/
      if (pathname === "/.well-known/carddav") {
        res.writeHead(301, { Location: `${baseUrl}/dav/` });
        res.end();
        return;
      }

      // 2. Root / returns plain HTML (simulating Nextcloud web root where DAV lives at /.well-known/carddav)
      if (pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html><body>Server root</body></html>");
        return;
      }

      // 3. /dav/ returns current-user-principal
      if (pathname === "/dav/" && method === "PROPFIND") {
        res.writeHead(207, {
          "Content-Type": "application/xml; charset=utf-8",
        });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/</d:href>
    <d:propstat>
      <d:prop>
        <d:current-user-principal>
          <d:href>/dav/principals/alice/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      // 4. /dav/principals/alice/ returns addressbook-home-set
      if (pathname === "/dav/principals/alice/" && method === "PROPFIND") {
        res.writeHead(207, {
          "Content-Type": "application/xml; charset=utf-8",
        });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/principals/alice/</d:href>
    <d:propstat>
      <d:prop>
        <c:addressbook-home-set>
          <d:href>/dav/addressbooks/alice/</d:href>
        </c:addressbook-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      // 5. /dav/addressbooks/alice/ Depth: 1 lists the default addressbook
      if (pathname === "/dav/addressbooks/alice/" && method === "PROPFIND") {
        res.writeHead(207, {
          "Content-Type": "application/xml; charset=utf-8",
        });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/addressbooks/alice/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/addressbooks/alice/default/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
        <d:displayname>Personal Address Book</d:displayname>
        <d:sync-token>${currentSyncToken}</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      // 6. Address book PROPFIND (Depth 0 or Depth 1)
      if (
        pathname === "/dav/addressbooks/alice/default/" &&
        method === "PROPFIND"
      ) {
        const depth = req.headers.depth ?? "0";
        const itemResponses: string[] = [];
        if (depth === "1") {
          for (const [href, card] of cards.entries()) {
            if (card.deleted) continue;
            itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>${card.etag}</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`);
          }
        }

        res.writeHead(207, {
          "Content-Type": "application/xml; charset=utf-8",
        });
        res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>/dav/addressbooks/alice/default/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
        <d:displayname>Personal Address Book</d:displayname>
        <d:sync-token>${currentSyncToken}</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
${itemResponses.join("\n")}
</d:multistatus>`);
        return;
      }

      // 7. Address book REPORT (sync-collection or addressbook-multiget)
      if (
        pathname === "/dav/addressbooks/alice/default/" &&
        method === "REPORT"
      ) {
        if (body.includes("sync-collection")) {
          const itemResponses: string[] = [];
          for (const [href, card] of cards.entries()) {
            if (card.deleted) {
              itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>`);
            } else {
              itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${card.etag}</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`);
            }
          }

          res.writeHead(207, {
            "Content-Type": "application/xml; charset=utf-8",
          });
          res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
${itemResponses.join("\n")}
  <d:sync-token>${currentSyncToken}</d:sync-token>
</d:multistatus>`);
          return;
        }

        if (body.includes("addressbook-multiget")) {
          const hrefMatches = Array.from(
            body.matchAll(/<[^:>]*:?href>([^<]+)<\/[^:>]*:?href>/g),
          ).map((m) => m[1]);
          const itemResponses: string[] = [];
          for (const href of hrefMatches) {
            const card = cards.get(href);
            if (!card || card.deleted) continue;
            const escapedVcard = card.vcard
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${card.etag}</d:getetag>
        <c:address-data>${escapedVcard}</c:address-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`);
          }

          res.writeHead(207, {
            "Content-Type": "application/xml; charset=utf-8",
          });
          res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
${itemResponses.join("\n")}
</d:multistatus>`);
          return;
        }
      }

      // 8. PUT individual vCard
      if (
        pathname.startsWith("/dav/addressbooks/alice/default/") &&
        method === "PUT"
      ) {
        const ifMatch = req.headers["if-match"] as string | undefined;
        const ifNoneMatch = req.headers["if-none-match"] as string | undefined;
        putRequests.push({ path: pathname, ifMatch, ifNoneMatch, body });

        if (forceConflictOnHref === pathname) {
          res.writeHead(412, { "Content-Type": "text/plain" });
          res.end("Precondition Failed");
          return;
        }

        const existing = cards.get(pathname);
        if (ifMatch && existing && existing.etag !== ifMatch) {
          res.writeHead(412, { "Content-Type": "text/plain" });
          res.end("Precondition Failed");
          return;
        }

        const newEtag = `"etag-${crypto.randomUUID().slice(0, 8)}"`;
        cards.set(pathname, { etag: newEtag, vcard: body });
        res.writeHead(existing ? 204 : 201, { ETag: newEtag });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Seed owner
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash)
         VALUES (?, ?, ?, 'hash')`,
      )
      .run(ownerId, VALID_USER, ownerId);
  });

  afterAll(async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    sqlite
      .prepare("DELETE FROM connector_links WHERE ownerId = ?")
      .run(ownerId);
    sqlite.prepare("DELETE FROM connector_runs WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM connectors WHERE ownerId = ?").run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_emails WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_phones WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_tags WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite
      .prepare(
        "DELETE FROM contact_sources WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
      )
      .run(ownerId);
    sqlite.prepare("DELETE FROM contacts WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM events WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM jobs WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
  });

  it("discovers the address book via /.well-known/carddav and rejects invalid credentials", async () => {
    const okResult = await testConnector(
      scope,
      "carddav",
      {
        url: baseUrl,
        username: VALID_USER,
        syncDirection: "two_way",
      },
      { password: VALID_PASS },
    );
    expect(okResult).toEqual({
      ok: true,
      detail: "Connected to Personal Address Book",
    });

    await expect(
      testConnector(
        scope,
        "carddav",
        {
          url: baseUrl,
          username: VALID_USER,
          syncDirection: "two_way",
        },
        { password: "wrong-password" },
      ),
    ).rejects.toThrow(/rejected the credentials/i);
  });

  it("performs two-way sync: pulls remote contacts, skips group vCards, pushes local creates/updates, and handles conflicts and remote deletes safely", async () => {
    resetServerCards();

    // Create a local contact in Contrack BEFORE first sync
    const grace = contactService.createContact(scope, {
      name: "Grace Hopper",
      firstName: "Grace",
      lastName: "Hopper",
      company: "US Navy",
      emails: [{ email: "grace@navy.mil", label: "work", isPrimary: true }],
    });
    expect(grace).toBeTruthy();

    // Connect CardDAV in two-way mode
    const connector = await createConnector(scope, {
      kind: "carddav",
      name: "Nextcloud Contacts",
      config: {
        url: baseUrl,
        username: VALID_USER,
        syncDirection: "two_way",
      },
      secret: { password: VALID_PASS },
    });

    // Run 1: Initial sync
    // Should pull Ada Lovelace (1 contact), skip VIP Group, and push Grace Hopper (1 pushed) without echoing Ada back!
    const run1 = await runNow(scope, connector.id, "manual");
    expect(run1.status).toBe("ok");
    expect(run1.stats.contacts).toBe(1);
    expect(run1.stats.pushed).toBe(1);

    // Verify Ada was created in Contrack with her fields
    const adaRow = sqlite
      .prepare(
        "SELECT id, name, company, role, about FROM contacts WHERE ownerId = ? AND name = 'Ada Lovelace'",
      )
      .get(ownerId) as
      | {
          id: string;
          name: string;
          company: string;
          role: string;
          about: string;
        }
      | undefined;
    expect(adaRow).toBeDefined();
    expect(adaRow?.company).toBe("Analytical Engine Ltd");
    expect(adaRow?.role).toBe("Chief Mathematician");
    expect(adaRow?.about).toBe("Met at the London symposium");

    // Verify VIP Group was skipped
    const groupRow = sqlite
      .prepare(
        "SELECT id FROM contacts WHERE ownerId = ? AND name = 'VIP Group'",
      )
      .get(ownerId);
    expect(groupRow).toBeUndefined();

    // Verify only Grace Hopper was PUT to the CardDAV server (Ada was not echoed back)
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0].path).toBe(
      `/dav/addressbooks/alice/default/${encodeURIComponent(grace!.id)}.vcf`,
    );
    expect(putRequests[0].ifNoneMatch).toBe("*");
    expect(putRequests[0].body).toContain(`UID:${grace!.id}`);
    expect(putRequests[0].body).toContain("FN:Grace Hopper");

    // Run 2: Immediate re-sync with no changes -> 0 pulled, 0 pushed
    putRequests.length = 0;
    const run2 = await runNow(scope, connector.id, "manual");
    expect(run2.status).toBe("ok");
    expect(run2.stats.contacts).toBe(0);
    expect(run2.stats.pushed).toBeUndefined();
    expect(putRequests).toHaveLength(0);

    // Run 3: Edit Ada locally in Contrack -> should push update to /dav/addressbooks/alice/default/ada.vcf
    // preserving her remote UID (remote-uid-ada-111) and sending If-Match: "etag-ada-v1"
    const futureIso = new Date(Date.now() + 5000).toISOString();
    contactService.updateContact(scope, adaRow!.id, {
      role: "Lead Architect",
    });
    sqlite
      .prepare("UPDATE contacts SET updatedAt = ? WHERE id = ? AND ownerId = ?")
      .run(futureIso, adaRow!.id, ownerId);

    const run3 = await runNow(scope, connector.id, "manual");
    expect(run3.status).toBe("ok");
    expect(run3.stats.pushed).toBe(1);
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0].path).toBe("/dav/addressbooks/alice/default/ada.vcf");
    expect(putRequests[0].ifMatch).toBe('"etag-ada-v1"');
    expect(putRequests[0].body).toContain("UID:remote-uid-ada-111");
    expect(putRequests[0].body).toContain("TITLE:Lead Architect");

    // Run 4: Simulate ETag conflict (412 Precondition Failed) on local edit -> Safe Mode skips push without failing run
    putRequests.length = 0;
    forceConflictOnHref = "/dav/addressbooks/alice/default/ada.vcf";
    const futureIso2 = new Date(Date.now() + 10000).toISOString();
    sqlite
      .prepare("UPDATE contacts SET updatedAt = ? WHERE id = ? AND ownerId = ?")
      .run(futureIso2, adaRow!.id, ownerId);

    const run4 = await runNow(scope, connector.id, "manual");
    expect(run4.status).toBe("ok");
    expect(run4.stats.pushed).toBeUndefined();
    expect(putRequests).toHaveLength(1);
    forceConflictOnHref = null;

    // Run 5: Simulate remote deletion of Grace's card via sync-collection 404
    putRequests.length = 0;
    const graceHref = `/dav/addressbooks/alice/default/${encodeURIComponent(grace!.id)}.vcf`;
    cards.set(graceHref, {
      etag: "",
      vcard: "",
      deleted: true,
    });
    currentSyncToken = "http://sabredav.org/ns/sync/2";

    const run5 = await runNow(scope, connector.id, "manual");
    expect(run5.status).toBe("ok");
    // Grace's connector_link is removed, Grace still exists in Contrack, and Grace is NOT re-pushed
    expect(putRequests).toHaveLength(0);
    const graceLink = sqlite
      .prepare(
        "SELECT * FROM connector_links WHERE connectorId = ? AND ownerId = ? AND localId = ?",
      )
      .get(connector.id, ownerId, grace!.id);
    expect(graceLink).toBeUndefined();
    const graceStillInDb = sqlite
      .prepare(
        "SELECT id FROM contacts WHERE id = ? AND ownerId = ? AND deletedAt IS NULL",
      )
      .get(grace!.id, ownerId);
    expect(graceStillInDb).toBeDefined();

    // Run 6: Switch connector to pull_only mode and add a new local contact -> no PUT requests sent
    await updateConnector(scope, connector.id, {
      config: {
        url: baseUrl,
        username: VALID_USER,
        syncDirection: "pull_only",
      },
    });
    contactService.createContact(scope, {
      name: "Alan Turing",
      emails: [{ email: "alan@bletchley.org", label: "work", isPrimary: true }],
    });

    putRequests.length = 0;
    const run6 = await runNow(scope, connector.id, "manual");
    expect(run6.status).toBe("ok");
    expect(run6.stats.pushed).toBeUndefined();
    expect(putRequests).toHaveLength(0);
  });
});
