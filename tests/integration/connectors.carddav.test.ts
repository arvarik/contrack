/**
 * tests/integration/connectors.carddav.test.ts — End-to-end integration of the CardDAV adapter.
 *
 * Covers:
 * - RFC 6764 /.well-known/carddav redirect -> principal -> home-set -> address book discovery
 * - Root 401 fallback to /.well-known/carddav (iCloud style)
 * - Multiple address books: ranking writable Personal book over read-only "Recently contacted" and persisting addressBookUrl
 * - Plain http:// rejection when CONNECTORS_ALLOW_PRIVATE_HOSTS is not enabled
 * - Cross-host / sibling-host redirect stripping of Authorization header
 * - Two-way sync: skipping pre-existing & archived contacts on initial run, pulling remote cards, pushing new & edited contacts
 * - Preserving server-side properties (PHOTO, NICKNAME, structured ADR, Apple X-ABLabel, X-* fields, UID) via GET + patchVCard
 * - Gating push on vcardContentHash so trigger-bumped updatedAt (lastContactedAt, aiBriefing) produces zero PUTs
 * - SQLite space-formatted updatedAt timestamps vs ISO timestamps
 * - 403 and 412 on PUT: keeping connector active and preserving pull cursor
 * - Weak ETag handling (never sending W/"..." in If-Match)
 * - 507 Insufficient Storage pagination on sync-collection REPORT
 * - 200 non-XML response on sync-collection falling back to PROPFIND
 * - Multiget > 5 MB response cap halving batch and retrying
 * - Absolute and URL-encoded hrefs, missing getetag, and 404 entries in multiget
 * - Merged contacts (canonicalId) updating the existing card instead of creating a duplicate
 */

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  canFollowDiscoveryRedirect,
  formatEtagHeader,
  isWeakEtag,
  normalizeHrefPath,
  parseTimestampMs,
  vcardContentHash,
} from "../../server/connectors/adapters/carddav.ts";
import {
  createConnector,
  getConnector,
  runNow,
  testConnector,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import { mergeContacts } from "../../server/services/dedupe/merging.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

interface RemoteCard {
  etag: string | null;
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
  let getRequestsCount = 0;
  let discoveryCount = 0;
  let reverseBookOrder = false;
  let rootReturns401 = false;
  let syncReportReturnsHtml200 = false;
  let syncReportTruncate507Once = false;
  let multigetOversizedWhenBatchGt1 = false;
  let multigetExtra404Href: string | null = null;
  let currentSyncToken = "http://sabredav.org/ns/sync/1";
  let forceStatusOnPutHref: { href: string; status: number } | null = null;

  function resetServerCards() {
    cards.clear();
    putRequests.length = 0;
    getRequestsCount = 0;
    discoveryCount = 0;
    reverseBookOrder = false;
    rootReturns401 = false;
    syncReportReturnsHtml200 = false;
    syncReportTruncate507Once = false;
    multigetOversizedWhenBatchGt1 = false;
    multigetExtra404Href = null;
    currentSyncToken = "http://sabredav.org/ns/sync/1";
    forceStatusOnPutHref = null;

    cards.set("/dav/addressbooks/alice/default/ada.vcf", {
      etag: '"etag-ada-v1"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-ada-111",
        "N:Lovelace;Ada;Augusta;Countess;",
        "FN:Ada Lovelace",
        "NICKNAME:Enchantress of Numbers",
        "ORG:Analytical Engine Ltd;Research",
        "TITLE:Chief Mathematician",
        "EMAIL;TYPE=INTERNET,WORK,PREF:ada@analytical.org",
        "item1.TEL;type=pref:+44 20 7946 0921",
        "item1.X-ABLabel:_$!<Mobile>!$_",
        "item2.ADR;type=HOME;type=pref:;;10 St James Square;London;Greater London;SW1Y 4LE;UK",
        "item2.X-ABLabel:_$!<Home>!$_",
        "CATEGORIES:pioneer,math",
        "NOTE:Met at the London symposium",
        "X-ABUID:550E8400-E29B-41D4-A716-446655440000:ABPerson",
        "X-CUSTOM-PROP:preserve-me",
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
      const pathname = normalizeHrefPath(reqUrl.pathname, "http://127.0.0.1");
      const method = req.method ?? "GET";

      // Redirect test endpoints
      if (pathname === "/redirect-same-origin") {
        res.writeHead(302, { Location: `${baseUrl}/echo-auth` });
        res.end();
        return;
      }
      if (pathname === "/redirect-other-port") {
        res.writeHead(302, {
          Location: `http://localhost:${(server.address() as AddressInfo).port}/echo-auth`,
        });
        res.end();
        return;
      }
      if (pathname === "/echo-auth") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ auth: req.headers.authorization ?? null }));
        return;
      }

      // Root / can simulate iCloud returning 401 on root before /.well-known/carddav
      if (pathname === "/" && rootReturns401) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Root"' });
        res.end("Unauthorized root");
        return;
      }

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
        discoveryCount++;
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

      // 5. /dav/addressbooks/alice/ Depth: 1 lists multiple address books:
      // a read-only "Recently contacted" book first, and writable "Personal Address Book" second
      if (pathname === "/dav/addressbooks/alice/" && method === "PROPFIND") {
        const readOnlyBook = `  <d:response>
    <d:href>/dav/addressbooks/alice/z-server-generated--system/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
        <d:displayname>Recently contacted</d:displayname>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
        </d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
        const personalBook = `  <d:response>
    <d:href>/dav/addressbooks/alice/default/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
        <d:displayname>Personal Address Book</d:displayname>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
          <d:privilege><d:write/></d:privilege>
        </d:current-user-privilege-set>
        <d:sync-token>${currentSyncToken}</d:sync-token>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

        const booksXml = reverseBookOrder
          ? `${personalBook}\n${readOnlyBook}`
          : `${readOnlyBook}\n${personalBook}`;

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
${booksXml}
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
            const etagProp = card.etag
              ? `\n        <d:getetag>${card.etag}</d:getetag>`
              : "";
            // Return one href as a full URL to verify absolute/encoded href normalization
            const wireHref = href.includes("Descartes")
              ? `${baseUrl}${href.replace("%C3%A9", "%c3%a9")}`
              : href;
            itemResponses.push(`  <d:response>
    <d:href>${wireHref}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>${etagProp}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`);
          }
          if (multigetExtra404Href) {
            itemResponses.push(`  <d:response>
    <d:href>${multigetExtra404Href}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>"etag-vanished"</d:getetag>
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
          if (syncReportReturnsHtml200) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<html><body>Not a WebDAV report</body></html>");
            return;
          }

          const allEntries = Array.from(cards.entries());
          if (syncReportTruncate507Once && allEntries.length >= 2) {
            syncReportTruncate507Once = false;
            const [firstHref, firstCard] = allEntries[0]!;
            res.writeHead(207, {
              "Content-Type": "application/xml; charset=utf-8",
            });
            res.end(`<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:response>
    <d:href>${firstHref}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${firstCard.etag ?? ""}</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/addressbooks/alice/default/</d:href>
    <d:status>HTTP/1.1 507 Insufficient Storage</d:status>
  </d:response>
  <d:sync-token>${currentSyncToken}-page1</d:sync-token>
</d:multistatus>`);
            return;
          }

          const itemResponses: string[] = [];
          for (const [href, card] of allEntries) {
            if (card.deleted) {
              itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>`);
            } else {
              const etagProp = card.etag
                ? `<d:getetag>${card.etag}</d:getetag>`
                : "";
              itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        ${etagProp}
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
          ).map((m) => normalizeHrefPath(m[1]!, baseUrl));

          if (multigetOversizedWhenBatchGt1 && hrefMatches.length > 1) {
            res.writeHead(207, {
              "Content-Type": "application/xml; charset=utf-8",
            });
            // Stream > 5 MB to trigger the cap error on multi-item batch
            const hugeChunk = "X".repeat(1024 * 1024);
            for (let c = 0; c < 6; c++) {
              res.write(hugeChunk);
            }
            res.end();
            return;
          }

          const itemResponses: string[] = [];
          for (const href of hrefMatches) {
            if (href === multigetExtra404Href) {
              itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:status>HTTP/1.1 404 Not Found</d:status>
  </d:response>`);
              continue;
            }
            const card = cards.get(href);
            if (!card || card.deleted) continue;
            const escapedVcard = card.vcard
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            const etagProp = card.etag
              ? `\n        <d:getetag>${card.etag}</d:getetag>`
              : "";
            itemResponses.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>${etagProp}
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

      // 8. GET individual vCard
      if (
        pathname.startsWith("/dav/addressbooks/alice/default/") &&
        method === "GET"
      ) {
        getRequestsCount++;
        const card = cards.get(pathname);
        if (!card || card.deleted) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        const headers: Record<string, string> = {
          "Content-Type": "text/vcard; charset=utf-8",
        };
        if (card.etag) headers.ETag = card.etag;
        res.writeHead(200, headers);
        res.end(card.vcard);
        return;
      }

      // 9. PUT individual vCard
      if (
        pathname.startsWith("/dav/addressbooks/alice/default/") &&
        method === "PUT"
      ) {
        const ifMatch = req.headers["if-match"] as string | undefined;
        const ifNoneMatch = req.headers["if-none-match"] as string | undefined;
        putRequests.push({ path: pathname, ifMatch, ifNoneMatch, body });

        if (forceStatusOnPutHref && forceStatusOnPutHref.href === pathname) {
          res.writeHead(forceStatusOnPutHref.status, {
            "Content-Type": "text/plain",
          });
          res.end(`Forced HTTP ${forceStatusOnPutHref.status}`);
          return;
        }

        const existing = cards.get(pathname);
        // RFC 9110 strong comparison: weak ETags never match If-Match
        if (ifMatch) {
          if (
            ifMatch.startsWith("W/") ||
            existing?.etag?.startsWith("W/") ||
            (existing?.etag && existing.etag !== ifMatch)
          ) {
            res.writeHead(412, { "Content-Type": "text/plain" });
            res.end("Precondition Failed");
            return;
          }
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
      .prepare("DELETE FROM dedupe_merge_log WHERE ownerId = ?")
      .run(ownerId);
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
        "DELETE FROM contact_addresses WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)",
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

  it("discovers the writable address book (even when root returns 401 or a read-only book is listed first) and rejects plain http:// when private hosts are off", async () => {
    rootReturns401 = true;
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
    rootReturns401 = false;

    expect(okResult.ok).toBe(true);
    expect(okResult.detail).toBe("Connected to Personal Address Book");
    expect(okResult.addressBooks).toHaveLength(2);
    expect(okResult.addressBooks?.[0]?.displayName).toBe(
      "Personal Address Book",
    );
    expect(okResult.addressBooks?.[1]?.readOnly).toBe(true);

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

    // Rejects plain http:// when CONNECTORS_ALLOW_PRIVATE_HOSTS is not enabled
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "false";
    try {
      await expect(
        testConnector(
          scope,
          "carddav",
          {
            url: "http://example.com/dav/",
            username: VALID_USER,
            syncDirection: "two_way",
          },
          { password: VALID_PASS },
        ),
      ).rejects.toThrow(/https:\/\//i);
    } finally {
      process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    }
  });

  it("keeps Authorization on same-origin redirects and strips it on cross-host or sibling-host redirects", async () => {
    const sameOrigin = await safeFetch(`${baseUrl}/redirect-same-origin`, {
      headers: { Authorization: "Basic secret-token" },
      allowPrivate: true,
    });
    expect(await sameOrigin.response.json()).toEqual({
      auth: "Basic secret-token",
    });

    const crossHost = await safeFetch(`${baseUrl}/redirect-other-port`, {
      headers: { Authorization: "Basic secret-token" },
      allowPrivate: true,
    });
    expect(await crossHost.response.json()).toEqual({ auth: null });

    expect(
      canFollowDiscoveryRedirect(
        "https://me.github.io",
        "https://evil.github.io/dav",
      ),
    ).toBe(false);
    expect(
      canFollowDiscoveryRedirect("https://a.co.uk", "https://b.co.uk/dav"),
    ).toBe(false);
    expect(
      canFollowDiscoveryRedirect(
        "https://example.com",
        "http://example.com/dav",
      ),
    ).toBe(false);
    expect(
      canFollowDiscoveryRedirect(
        "https://example.com",
        "https://dav.example.com/dav",
      ),
    ).toBe(true);
  });

  it("performs two-way sync, preserves server-side properties on update, skips trigger-only updatedAt bumps, and handles 403/412/merges/caps", async () => {
    resetServerCards();

    // 1. Pre-existing contact created BEFORE connecting the CardDAV server
    const preExisting = contactService.createContact(scope, {
      name: "Charles Babbage",
      firstName: "Charles",
      lastName: "Babbage",
      emails: [
        { email: "charles@analytical.org", label: "work", isPrimary: true },
      ],
    });
    sqlite
      .prepare(
        "UPDATE contacts SET addedAt = '2026-01-01 00:00:00', updatedAt = '2026-01-01 00:00:00' WHERE id = ?",
      )
      .run(preExisting!.id);

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

    // 2. Contact created AFTER connecting -> should be pushed
    const grace = contactService.createContact(scope, {
      name: "Grace Hopper",
      firstName: "Grace",
      lastName: "Hopper",
      company: "US Navy",
      emails: [{ email: "grace@navy.mil", label: "work", isPrimary: true }],
    });
    expect(grace).toBeTruthy();

    discoveryCount = 0;

    // Run 1: Initial sync
    // Pulls Ada Lovelace (1 contact), skips VIP Group, skips pre-existing Charles Babbage, and pushes Grace Hopper (1 pushed)
    const run1 = await runNow(scope, connector.id, "manual");
    expect(run1.status).toBe("ok");
    expect(run1.stats.contacts).toBe(1);
    expect(run1.stats.pushed).toBe(1);
    expect(discoveryCount).toBe(1);

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

    // Only Grace Hopper was PUT (Charles Babbage was not uploaded)
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]!.path).toBe(
      `/dav/addressbooks/alice/default/${encodeURIComponent(grace!.id)}.vcf`,
    );
    expect(putRequests[0]!.ifNoneMatch).toBe("*");

    // Run 2: Flip book order on server + bump Ada's updatedAt via non-card columns (lastContactedAt, aiBriefing)
    // Address book URL is persisted in cursor (0 rediscoveries), and vcardContentHash gate prevents spurious PUTs!
    reverseBookOrder = true;
    putRequests.length = 0;
    sqlite
      .prepare(
        `UPDATE contacts
         SET lastContactedAt = datetime('now'),
             aiBriefing = 'Updated AI briefing',
             updatedAt = datetime('now', '+1 hour')
         WHERE id = ? AND ownerId = ?`,
      )
      .run(adaRow!.id, ownerId);

    const run2 = await runNow(scope, connector.id, "manual");
    expect(run2.status).toBe("ok");
    expect(run2.stats.contacts).toBe(0);
    expect(run2.stats.pushed).toBeUndefined();
    expect(putRequests).toHaveLength(0);
    expect(discoveryCount).toBe(1); // Did not re-run discovery

    // Run 3: Edit Ada's role locally with SQLite space-formatted updatedAt ('YYYY-MM-DD HH:MM:SS')
    // Must GET the remote card and preserve NICKNAME, structured ADR, Apple labels, X-* properties, and server UID!
    contactService.updateContact(scope, adaRow!.id, {
      role: "Lead Architect",
    });
    const spaceTimestamp = new Date(Date.now() + 6 * 3600 * 1000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    sqlite
      .prepare("UPDATE contacts SET updatedAt = ? WHERE id = ? AND ownerId = ?")
      .run(spaceTimestamp, adaRow!.id, ownerId);

    const beforeGets = getRequestsCount;
    const run3 = await runNow(scope, connector.id, "manual");
    expect(run3.status).toBe("ok");
    expect(run3.stats.pushed).toBe(1);
    expect(getRequestsCount).toBeGreaterThan(beforeGets);
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]!.path).toBe(
      "/dav/addressbooks/alice/default/ada.vcf",
    );
    expect(putRequests[0]!.ifMatch).toBe('"etag-ada-v1"');
    const unfoldedBody = putRequests[0]!.body.replace(/\r\n[ \t]/g, "");
    expect(unfoldedBody).toContain("UID:remote-uid-ada-111");
    expect(unfoldedBody).toContain("TITLE:Lead Architect");
    expect(unfoldedBody).toContain("NICKNAME:Enchantress of Numbers");
    expect(unfoldedBody).toContain("N:Lovelace;Ada;Augusta;Countess;");
    expect(unfoldedBody).toContain("ORG:Analytical Engine Ltd;Research");
    expect(unfoldedBody).toContain("item1.TEL;type=pref:+44 20 7946 0921");
    expect(unfoldedBody).toContain("item1.X-ABLabel:_$!<Mobile>!$_");
    expect(unfoldedBody).toContain(
      "item2.ADR;type=HOME;type=pref:;;10 St James Square;London;Greater London;SW1Y 4LE;UK",
    );
    expect(unfoldedBody).toContain("item2.X-ABLabel:_$!<Home>!$_");
    expect(unfoldedBody).toContain(
      "X-ABUID:550E8400-E29B-41D4-A716-446655440000:ABPerson",
    );
    expect(unfoldedBody).toContain("X-CUSTOM-PROP:preserve-me");

    // Run 4: 403 Forbidden on PUT does NOT brick connector (stays active, not needs_reauth) and saves pull cursor
    putRequests.length = 0;
    cards.set("/dav/addressbooks/alice/default/descartes.vcf", {
      etag: null, // missing getetag
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-descartes",
        "N:Descartes;René;;;",
        "FN:René Descartes",
        "EMAIL:rene@philosophy.fr",
        "END:VCARD",
      ].join("\r\n"),
    });
    currentSyncToken = "http://sabredav.org/ns/sync/2";
    forceStatusOnPutHref = {
      href: "/dav/addressbooks/alice/default/ada.vcf",
      status: 403,
    };
    contactService.updateContact(scope, adaRow!.id, {
      role: "Refused Role Change",
    });

    const run4 = await runNow(scope, connector.id, "manual");
    expect(run4.status).toBe("ok");
    expect(run4.stats.contacts).toBe(1); // René Descartes pulled
    expect(run4.stats.pushed).toBeUndefined(); // 403 skipped safely
    const connAfter403 = getConnector(scope, connector.id);
    expect(connAfter403?.status).toBe("active");
    forceStatusOnPutHref = null;

    // Run 5: Weak ETag on remote card -> PUT omits If-Match so strong comparison does not 412
    putRequests.length = 0;
    const adaCard = cards.get("/dav/addressbooks/alice/default/ada.vcf")!;
    cards.set("/dav/addressbooks/alice/default/ada.vcf", {
      etag: 'W/"weak-etag-ada-v2"',
      vcard: adaCard.vcard,
    });
    currentSyncToken = "http://sabredav.org/ns/sync/3";
    // Pull the weak ETag first, then edit Ada
    await runNow(scope, connector.id, "manual");
    putRequests.length = 0;
    contactService.updateContact(scope, adaRow!.id, {
      role: "Weak ETag Architect",
    });
    const run5 = await runNow(scope, connector.id, "manual");
    expect(run5.status).toBe("ok");
    expect(run5.stats.pushed).toBe(1);
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]!.ifMatch).toBeUndefined();

    // Run 6: Merge Ada (duplicate) into a canonical survivor contact -> link re-points to survivor,
    // updating /dav/addressbooks/alice/default/ada.vcf instead of creating a duplicate card!
    putRequests.length = 0;
    const canonicalAda = contactService.createContact(scope, {
      name: "Augusta Ada King",
      firstName: "Augusta",
      lastName: "King",
      role: "Countess of Lovelace",
      emails: [
        { email: "augusta@analytical.org", label: "work", isPrimary: true },
      ],
    });
    mergeContacts(scope, canonicalAda!.id, adaRow!.id, "test-rid");

    const run6 = await runNow(scope, connector.id, "manual");
    expect(run6.status).toBe("ok");
    expect(run6.stats.pushed).toBe(1);
    expect(putRequests).toHaveLength(1);
    expect(putRequests[0]!.path).toBe(
      "/dav/addressbooks/alice/default/ada.vcf",
    );
    expect(putRequests[0]!.body).toContain("FN:Augusta Ada King");
    expect(putRequests[0]!.body).toContain("UID:remote-uid-ada-111");

    // Run 7: 507 Insufficient Storage truncation in sync-collection REPORT + multiget > 5 MB batch halving
    putRequests.length = 0;
    cards.set("/dav/addressbooks/alice/default/Ren%C3%A9%20Descartes.vcf", {
      etag: '"etag-rene-encoded"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-rene-2",
        "N:Descartes;René;;;",
        "FN:René Descartes II",
        "EMAIL:rene2@philosophy.fr",
        "END:VCARD",
      ].join("\r\n"),
    });
    currentSyncToken = "http://sabredav.org/ns/sync/4";
    syncReportTruncate507Once = true;
    multigetOversizedWhenBatchGt1 = true;

    const run7 = await runNow(scope, connector.id, "manual");
    expect(run7.status).toBe("ok");
    expect(run7.stats.contacts).toBeGreaterThanOrEqual(1);
    multigetOversizedWhenBatchGt1 = false;

    // Run 8: 200 OK non-XML response to sync-collection falls back to PROPFIND + handles 404 entry in multiget
    syncReportReturnsHtml200 = true;
    multigetExtra404Href = "/dav/addressbooks/alice/default/vanished.vcf";
    cards.set("/dav/addressbooks/alice/default/noether.vcf", {
      etag: '"etag-noether-1"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:remote-uid-noether",
        "N:Noether;Emmy;;;",
        "FN:Emmy Noether",
        "EMAIL:emmy@gottingen.de",
        "END:VCARD",
      ].join("\r\n"),
    });

    const run8 = await runNow(scope, connector.id, "manual");
    expect(run8.status).toBe("ok");
    expect(run8.stats.contacts).toBeGreaterThanOrEqual(1);
    syncReportReturnsHtml200 = false;
    multigetExtra404Href = null;

    // Run 9: Switch to pull_only mode -> no PUT requests sent
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
    const run9 = await runNow(scope, connector.id, "manual");
    expect(run9.status).toBe("ok");
    expect(run9.stats.pushed).toBeUndefined();
    expect(putRequests).toHaveLength(0);
  });

  it("correctly parses SQLite and ISO timestamps, weak ETags, and vCard content hashes", () => {
    const isoMs = parseTimestampMs("2026-10-16T12:00:00.000Z");
    const sqliteLaterMs = parseTimestampMs("2026-10-16 18:00:00");
    expect(sqliteLaterMs).toBeGreaterThan(isoMs);

    expect(isWeakEtag('W/"123"')).toBe(true);
    expect(isWeakEtag('w/"123"')).toBe(true);
    expect(isWeakEtag('"123"')).toBe(false);
    expect(formatEtagHeader('W/"123"')).toBe("");
    expect(formatEtagHeader('"123"')).toBe('"123"');

    const h1 = vcardContentHash({
      name: "Ada Lovelace",
      updatedAt: "2026-10-16T12:00:00.000Z",
    });
    const h2 = vcardContentHash({
      name: "Ada Lovelace",
      updatedAt: "2026-10-16 18:00:00",
    });
    expect(h1).toBe(h2);
  });
});
