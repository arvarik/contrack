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
              ? `${baseUrl}${href.replaceAll("%C3%A9", "%c3%a9")}`
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

    // Passing a selected addressBookUrl on a subsequent test preserves the full list of address books
    const secondBookUrl = okResult.addressBooks?.[1]?.url;
    const selectedResult = await testConnector(
      scope,
      "carddav",
      {
        url: baseUrl,
        username: VALID_USER,
        addressBookUrl: secondBookUrl,
        syncDirection: "pull_only",
      },
      { password: VALID_PASS },
    );
    expect(selectedResult.ok).toBe(true);
    expect(selectedResult.detail).toBe("Connected to Recently contacted");
    expect(selectedResult.addressBooks).toHaveLength(2);

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

    // Run 10: Deleting a card on the CardDAV server unlinks the contact without moving it to Trash
    const noetherBefore = sqlite
      .prepare(
        "SELECT id, deletedAt FROM contacts WHERE ownerId = ? AND name = 'Emmy Noether'",
      )
      .get(ownerId) as { id: string; deletedAt: string | null } | undefined;
    expect(noetherBefore).toBeDefined();
    expect(noetherBefore?.deletedAt).toBeNull();

    cards.set("/dav/addressbooks/alice/default/noether.vcf", {
      etag: '"etag-noether-deleted"',
      vcard: "",
      deleted: true,
    });
    currentSyncToken = "http://sabredav.org/ns/sync/5";

    const run10 = await runNow(scope, connector.id, "manual");
    expect(run10.status).toBe("ok");
    const noetherAfter = sqlite
      .prepare("SELECT deletedAt FROM contacts WHERE id = ? AND ownerId = ?")
      .get(noetherBefore!.id, ownerId) as
      { deletedAt: string | null } | undefined;
    expect(noetherAfter?.deletedAt).toBeNull();
    const noetherLinkAfter = sqlite
      .prepare(
        "SELECT 1 FROM connector_links WHERE connectorId = ? AND externalId = '/dav/addressbooks/alice/default/noether.vcf'",
      )
      .get(connector.id);
    expect(noetherLinkAfter).toBeUndefined();
    const noetherSourceAfter = sqlite
      .prepare(
        "SELECT 1 FROM contact_sources WHERE contactId = ? AND platform = 'carddav' AND externalId = '/dav/addressbooks/alice/default/noether.vcf'",
      )
      .get(noetherBefore!.id);
    expect(noetherSourceAfter).toBeDefined();
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

  describe("CardDAV hardening edge cases", () => {
    interface MiniCard {
      etag: string;
      vcard: string;
    }
    interface MiniDav {
      url: string;
      books: Record<string, Map<string, MiniCard>>;
      tombstones: Set<string>;
      flags: {
        rejectSync: boolean;
        emptyListing: boolean;
        truncate507: boolean;
        omitEtags: boolean;
        getFails: boolean;
        false404OnGet: boolean;
        put401: boolean;
        failPutPrefix: string | null;
        homeSetOverride: string | null;
      };
      puts: Array<{
        path: string;
        body: string;
        ifMatch?: string;
        ifNoneMatch?: string;
      }>;
      close: () => Promise<void>;
    }

    const xmlEsc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const multiStatusXml = (inner: string) =>
      `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">\n${inner}\n</d:multistatus>`;
    const miniVcard = (fn: string, extra: string[] = []) =>
      [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `FN:${fn}`,
        `N:${fn.split(" ")[1] ?? ""};${fn.split(" ")[0]};;;`,
        ...extra,
        "END:VCARD",
      ].join("\r\n");

    const miniServers: MiniDav[] = [];
    afterAll(async () => {
      for (const s of miniServers) await s.close();
    });

    async function startMiniDav(): Promise<MiniDav> {
      const prefix = `tok-${crypto.randomUUID().slice(0, 6)}-`;
      let rev = 1;
      const books: MiniDav["books"] = {
        "/dav/ab/a/": new Map(),
        "/dav/ab/b/": new Map(),
      };
      const tombstones = new Set<string>();
      const flags: MiniDav["flags"] = {
        rejectSync: false,
        emptyListing: false,
        truncate507: false,
        omitEtags: false,
        getFails: false,
        false404OnGet: false,
        put401: false,
        failPutPrefix: null,
        homeSetOverride: null,
      };
      const puts: MiniDav["puts"] = [];
      const bookOf = (p: string) =>
        Object.keys(books).find(
          (b) => (p.startsWith(b) && p !== b) || books[b]!.has(p),
        );

      const srv = http.createServer(async (req, res) => {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        const p = normalizeHrefPath(u.pathname, "http://127.0.0.1");
        const m = req.method ?? "GET";
        if ((p === "/avatar.png" || p === "/avatar2.png") && m === "GET") {
          const png = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "base64",
          );
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(png);
          return;
        }
        if (req.headers.authorization !== EXPECTED_AUTH) {
          res.writeHead(401);
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = Buffer.concat(chunks).toString("utf8");
        const sendXml = (s: number, xml: string) => {
          res.writeHead(s, { "Content-Type": "application/xml" });
          res.end(xml);
        };
        if (p === "/" || p === "/.well-known/carddav") {
          res.writeHead(301, { Location: "/dav/" });
          res.end();
          return;
        }
        if (p === "/dav/" && m === "PROPFIND") {
          return sendXml(
            207,
            multiStatusXml(
              `<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav/p/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
            ),
          );
        }
        if (p === "/dav/p/" && m === "PROPFIND") {
          const homeHref = flags.homeSetOverride ?? "/dav/ab/";
          return sendXml(
            207,
            multiStatusXml(
              `<d:response><d:href>/dav/p/</d:href><d:propstat><d:prop><c:addressbook-home-set><d:href>${homeHref}</d:href></c:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
            ),
          );
        }
        if (p === "/dav/ab/" && m === "PROPFIND") {
          return sendXml(
            207,
            multiStatusXml(
              Object.keys(books)
                .map(
                  (b) =>
                    `<d:response><d:href>${b}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:addressbook/></d:resourcetype><d:displayname>Book ${b}</d:displayname><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
                )
                .join("\n"),
            ),
          );
        }
        const book = books[p];
        if (book && m === "PROPFIND") {
          const asksSyncToken = body.includes("sync-token");
          const truncPropstat =
            req.headers.depth === "1" && flags.truncate507
              ? `<d:propstat><d:prop/><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:propstat>`
              : "";
          const self = `<d:response><d:href>${p}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:addressbook/></d:resourcetype><d:displayname>Book ${p}</d:displayname><d:sync-token>${prefix}${rev}</d:sync-token></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>${truncPropstat}</d:response>`;
          const items =
            req.headers.depth === "1" && !flags.emptyListing
              ? [
                  ...[...book].map(([h, c]) => {
                    const etagXml = flags.omitEtags
                      ? ""
                      : `<d:getetag>${c.etag}</d:getetag>`;
                    // Emulate Nextcloud/Baïkal returning a 404 propstat for <d:sync-token/> on card items
                    const missingSyncTokenPropstat = asksSyncToken
                      ? `<d:propstat><d:prop><d:sync-token/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>`
                      : "";
                    return `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:resourcetype/>${etagXml}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>${missingSyncTokenPropstat}</d:response>`;
                  }),
                  ...[...tombstones]
                    .filter((h) => h.startsWith(p))
                    .map(
                      (h) =>
                        `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:resourcetype/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>`,
                    ),
                ]
              : [];
          return sendXml(207, multiStatusXml([self, ...items].join("\n")));
        }
        if (book && m === "REPORT" && body.includes("sync-collection")) {
          const tok =
            /<d:sync-token>([^<]*)<\/d:sync-token>/.exec(body)?.[1] ?? "";
          if (flags.rejectSync || !tok.startsWith(prefix)) {
            return sendXml(
              403,
              `<?xml version="1.0"?><d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>`,
            );
          }
          const live = [...book].map(([h, c]) => {
            const etagXml = flags.omitEtags
              ? ""
              : `<d:getetag>${c.etag}</d:getetag>`;
            return `<d:response><d:href>${h}</d:href><d:propstat><d:prop>${etagXml}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
          });
          const dead = [...tombstones]
            .filter((h) => h.startsWith(p))
            .map(
              (h) =>
                `<d:response><d:href>${h}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`,
            );
          return sendXml(
            207,
            multiStatusXml(
              [
                ...live,
                ...dead,
                `<d:sync-token>${prefix}${rev}</d:sync-token>`,
              ].join("\n"),
            ),
          );
        }
        if (book && m === "REPORT" && body.includes("addressbook-multiget")) {
          const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map(
            (mm) => normalizeHrefPath(mm[1]!, "http://127.0.0.1"),
          );
          return sendXml(
            207,
            multiStatusXml(
              hrefs
                .map((h) => {
                  const c = book.get(h);
                  if (!c) {
                    return `<d:response><d:href>${h}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
                  }
                  const etagXml = flags.omitEtags
                    ? ""
                    : `<d:getetag>${c.etag}</d:getetag>`;
                  return `<d:response><d:href>${h}</d:href><d:propstat><d:prop>${etagXml}<c:address-data>${xmlEsc(c.vcard)}</c:address-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
                })
                .join("\n"),
            ),
          );
        }
        const bp = bookOf(p);
        if (bp && m === "GET") {
          if (flags.getFails) {
            res.writeHead(503);
            res.end();
            return;
          }
          if (flags.false404OnGet) {
            res.writeHead(404);
            res.end();
            return;
          }
          const c = books[bp]!.get(p);
          if (!c) {
            res.writeHead(404);
            res.end();
            return;
          }
          const headers: Record<string, string> = {
            "Content-Type": "text/vcard",
          };
          if (!flags.omitEtags) {
            headers.ETag = c.etag;
          }
          res.writeHead(200, headers);
          res.end(c.vcard);
          return;
        }
        if (bp && m === "PUT") {
          if (flags.put401) {
            res.writeHead(401);
            res.end();
            return;
          }
          if (flags.failPutPrefix && p.startsWith(flags.failPutPrefix)) {
            req.socket.destroy();
            return;
          }
          const ifMatch = req.headers["if-match"] as string | undefined;
          const ifNoneMatch = req.headers["if-none-match"] as
            string | undefined;
          puts.push({ path: p, body, ifMatch, ifNoneMatch });
          const ex = books[bp]!.get(p);
          if (
            (ifMatch && (!ex || ex.etag !== ifMatch)) ||
            (ifNoneMatch === "*" && ex)
          ) {
            res.writeHead(412);
            res.end();
            return;
          }
          const etag = `"e-${crypto.randomUUID().slice(0, 8)}"`;
          books[bp]!.set(p, { etag, vcard: body });
          tombstones.delete(p);
          rev++;
          res.writeHead(ex ? 204 : 201, flags.omitEtags ? {} : { ETag: etag });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const dav: MiniDav = {
        url,
        books,
        tombstones,
        flags,
        puts,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      };
      miniServers.push(dav);
      return dav;
    }

    function newOwner(): Scope {
      const id = crypto.randomUUID();
      sqlite
        .prepare(
          `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'h')`,
        )
        .run(id, `${id}@x.test`, id);
      return scopeForOwnerId(id);
    }

    it("unlinks contacts on server delete while keeping contact_sources, and re-uploads if edited later", async () => {
      const s = newOwner();
      const dav = await startMiniDav();
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/remote.vcf", {
        etag: '"r1"',
        vcard: miniVcard("Remote Pulled", ["EMAIL:remote@example.com"]),
      });
      const preExisting = contactService.createContact(s, {
        name: "Owner PreExisting",
        company: "Acme",
      })!;
      sqlite
        .prepare(
          "UPDATE contacts SET addedAt='2026-01-01 00:00:00', updatedAt='2026-01-01 00:00:00' WHERE id=?",
        )
        .run(preExisting.id);

      const conn = await createConnector(s, {
        kind: "carddav",
        name: "dav",
        config: {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${dav.url}/dav/ab/a/`,
          pushExistingContacts: true,
        },
        secret: { password: VALID_PASS },
      });
      contactService.createContact(s, {
        name: "Owner AddedAfter",
      });

      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(2);

      // Delete both pushed cards and the pulled card on the server
      for (const put of dav.puts) {
        dav.books["/dav/ab/a/"]!.delete(put.path);
        dav.tombstones.add(put.path);
      }
      dav.books["/dav/ab/a/"]!.delete("/dav/ab/a/remote.vcf");
      dav.tombstones.add("/dav/ab/a/remote.vcf");

      await runNow(s, conn.id, "manual");
      const rows = sqlite
        .prepare("SELECT id, name, deletedAt FROM contacts WHERE ownerId = ?")
        .all(s.ownerId) as Array<{
        id: string;
        name: string;
        deletedAt: string | null;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.deletedAt === null)).toBe(true);
      const remainingLinks = sqlite
        .prepare("SELECT 1 FROM connector_links WHERE connectorId = ?")
        .all(conn.id);
      expect(remainingLinks).toHaveLength(0);

      // The pulled contact still keeps its CardDAV contact_sources provenance row
      const remoteRow = rows.find((r) => r.name === "Remote Pulled")!;
      const sources = sqlite
        .prepare("SELECT platform FROM contact_sources WHERE contactId = ?")
        .all(remoteRow.id) as Array<{ platform: string }>;
      expect(sources.map((src) => src.platform)).toContain("carddav");

      // Editing an unlinked contact in Contrack uploads it again as a new card
      dav.puts.length = 0;
      contactService.updateContact(s, preExisting.id, { company: "Acme v2" });
      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.body).toContain("ORG:Acme v2");
    });

    it("detects full-scan deletions when server returns 404 propstat for sync-token, and skips deletions on 507 truncation", async () => {
      const s = newOwner();
      const dav = await startMiniDav();
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/one.vcf", {
        etag: '"e1"',
        vcard: miniVcard("Card One"),
      });
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/two.vcf", {
        etag: '"e2"',
        vcard: miniVcard("Card Two"),
      });

      const conn = await createConnector(s, {
        kind: "carddav",
        name: "dav",
        config: {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${dav.url}/dav/ab/a/`,
        },
        secret: { password: VALID_PASS },
      });
      await runNow(s, conn.id, "manual");
      expect(
        sqlite
          .prepare(
            "SELECT externalId FROM connector_links WHERE connectorId = ?",
          )
          .all(conn.id),
      ).toHaveLength(2);

      // Force full PROPFIND scan (which returns 404 propstat on <d:sync-token/> per card,
      // and a 404 propstat response for tombstoned cards)
      dav.flags.rejectSync = true;
      dav.books["/dav/ab/a/"]!.delete("/dav/ab/a/two.vcf");
      dav.tombstones.add("/dav/ab/a/two.vcf");

      // When 507 Insufficient Storage truncation is present in a propstat, deletions are skipped
      dav.flags.truncate507 = true;
      await runNow(s, conn.id, "manual");
      expect(
        sqlite
          .prepare(
            "SELECT externalId FROM connector_links WHERE connectorId = ?",
          )
          .all(conn.id),
      ).toHaveLength(2);

      // Without 507 truncation, full scan unlinks the deleted card despite 404 sync-token propstat
      dav.flags.truncate507 = false;
      await runNow(s, conn.id, "manual");
      const links = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id) as Array<{ externalId: string }>;
      expect(links.map((l) => l.externalId)).toEqual(["/dav/ab/a/one.vcf"]);
    });

    it("supports non-prefix card hrefs and cleans up old-book links across two_way, pull_only, ETag-less, failed-push, 507, empty-listing, and server switches", async () => {
      const s = newOwner();
      const davA = await startMiniDav();
      const davB = await startMiniDav();

      // Server returns a card href outside /dav/ab/a/ (e.g. proxy/alias path /cards/aliased.vcf)
      davA.books["/dav/ab/a/"]!.set("/cards/aliased.vcf", {
        etag: '"alias1"',
        vcard: miniVcard("Aliased Card", ["EMAIL:alias@example.com"]),
      });
      davA.books["/dav/ab/b/"]!.set("/dav/ab/b/other.vcf", {
        etag: '"b1"',
        vcard: miniVcard("Other Person"),
      });
      davB.books["/dav/ab/a/"]!.set("/dav/ab/a/serverb.vcf", {
        etag: '"sb1"',
        vcard: miniVcard("ServerB Person"),
      });

      const conn = await createConnector(s, {
        kind: "carddav",
        name: "dav",
        config: {
          url: davA.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${davA.url}/dav/ab/a/`,
        },
        secret: { password: VALID_PASS },
      });
      await runNow(s, conn.id, "manual");
      // Second run with non-prefix href must keep the link and not create duplicate contacts
      await runNow(s, conn.id, "manual");
      const aliasLinks = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id) as Array<{ externalId: string }>;
      expect(aliasLinks.map((l) => l.externalId)).toEqual([
        "/cards/aliased.vcf",
      ]);
      const aliasContacts = sqlite
        .prepare(
          "SELECT id FROM contacts WHERE ownerId = ? AND name = 'Aliased Card' AND deletedAt IS NULL",
        )
        .all(s.ownerId) as Array<{ id: string }>;
      expect(aliasContacts).toHaveLength(1);

      // Adding a trailing slash to config.url must not trigger a false book switch or re-fetch unchanged cards
      await updateConnector(s, conn.id, {
        config: {
          url: `${davA.url}/`,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${davA.url}/dav/ab/a/`,
        },
        secret: { password: VALID_PASS },
      });
      const runTrailingSlash = await runNow(s, conn.id, "manual");
      expect(runTrailingSlash.stats.contacts).toBe(0);
      expect(
        sqlite
          .prepare(
            "SELECT externalId FROM connector_links WHERE connectorId = ?",
          )
          .all(conn.id),
      ).toHaveLength(1);

      // Switch to book B when listing is empty or 507-truncated, or when push fails with 401:
      // 1) Empty listing on switch run must NOT wipe links prematurely
      davA.flags.emptyListing = true;
      await updateConnector(s, conn.id, {
        config: {
          url: davA.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${davA.url}/dav/ab/b/`,
        },
        secret: { password: VALID_PASS },
      });
      await runNow(s, conn.id, "manual");
      expect(
        sqlite
          .prepare(
            "SELECT externalId FROM connector_links WHERE connectorId = ?",
          )
          .all(conn.id),
      ).toHaveLength(1);
      davA.flags.emptyListing = false;

      // 2) 507 truncation on switch run must also defer link cleanup
      davA.flags.truncate507 = true;
      await runNow(s, conn.id, "manual");
      expect(
        (
          sqlite
            .prepare(
              "SELECT externalId FROM connector_links WHERE connectorId = ?",
            )
            .all(conn.id) as Array<{ externalId: string }>
        ).some((l) => l.externalId === "/cards/aliased.vcf"),
      ).toBe(true);
      davA.flags.truncate507 = false;

      // 3) If push fails with 401 on the switch run (after editing Aliased Card), the next run still cleans up old-book links
      contactService.updateContact(s, aliasContacts[0]!.id, {
        company: "EditedDuringSwitch",
      });
      davA.flags.put401 = true;
      const runFailedPush = await runNow(s, conn.id, "manual");
      expect(runFailedPush.status).toBe("error");
      davA.flags.put401 = false;

      // Now run on ETag-less Book B: cleanup finishes, unlinks /cards/aliased.vcf, and resets cursor etags/cardHashes
      davA.flags.omitEtags = true;
      davA.puts.length = 0;
      const runBookB = await runNow(s, conn.id, "manual");
      expect(runBookB.status).toBe("ok");
      expect(davA.puts.some((p) => p.path === "/cards/aliased.vcf")).toBe(
        false,
      );
      const linksAfterBookB = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id) as Array<{ externalId: string }>;
      expect(
        linksAfterBookB.some((l) => l.externalId === "/cards/aliased.vcf"),
      ).toBe(false);
      expect(
        linksAfterBookB.some((l) => l.externalId === "/dav/ab/b/other.vcf"),
      ).toBe(true);
      const cursorAfterBookB = JSON.parse(
        (
          sqlite
            .prepare("SELECT cursor FROM connectors WHERE id = ?")
            .get(conn.id) as { cursor: string }
        ).cursor,
      ) as {
        etags: Record<string, string>;
        cardHashes: Record<string, string>;
      };
      expect(cursorAfterBookB.etags["/cards/aliased.vcf"]).toBeUndefined();
      expect(cursorAfterBookB.cardHashes["/cards/aliased.vcf"]).toBeUndefined();
      davA.flags.omitEtags = false;

      // Switch back to book A in pull_only mode: must unlink book B's cards
      await updateConnector(s, conn.id, {
        config: {
          url: davA.url,
          username: VALID_USER,
          syncDirection: "pull_only",
          addressBookUrl: `${davA.url}/dav/ab/a/`,
        },
      });
      await runNow(s, conn.id, "manual");
      const linksAfterPullSwitch = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id) as Array<{ externalId: string }>;
      expect(linksAfterPullSwitch.map((l) => l.externalId)).toEqual([
        "/cards/aliased.vcf",
      ]);

      // Switch to Server B using direct discovery (without passing addressBookUrl)
      await updateConnector(s, conn.id, {
        config: {
          url: davB.url,
          username: VALID_USER,
          syncDirection: "two_way",
        },
        secret: { password: VALID_PASS },
      });
      const runServerB = await runNow(s, conn.id, "manual");
      expect(runServerB.status).toBe("ok");
      const linksAfterServerB = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id) as Array<{ externalId: string }>;
      expect(
        linksAfterServerB.some((l) => l.externalId === "/cards/aliased.vcf"),
      ).toBe(false);
      expect(
        linksAfterServerB.some((l) => l.externalId === "/dav/ab/a/serverb.vcf"),
      ).toBe(true);
    });

    it("preserves links on an empty full-scan PROPFIND listing and guards local edits on cards with photos when ETag changes", async () => {
      const s = newOwner();
      const dav = await startMiniDav();
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/photo.vcf", {
        etag: '"p1"',
        vcard: miniVcard("Photo Person", [
          "ORG:OldOrg",
          `PHOTO;VALUE=URI:${dav.url}/avatar.png`,
        ]),
      });

      const conn = await createConnector(s, {
        kind: "carddav",
        name: "dav",
        config: {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${dav.url}/dav/ab/a/`,
        },
        secret: { password: VALID_PASS },
      });
      await runNow(s, conn.id, "manual");

      const photoContact = sqlite
        .prepare(
          "SELECT id, company, avatarUrl FROM contacts WHERE ownerId = ? AND name = 'Photo Person'",
        )
        .get(s.ownerId) as {
        id: string;
        company: string;
        avatarUrl: string | null;
      };
      expect(photoContact.company).toBe("OldOrg");

      // Edit Photo Person locally, and bump the server ETag to '"p2"' with identical vCard bytes
      // so sync re-fetches the card and exercises the remoteCardHash stale-copy guard
      contactService.updateContact(s, photoContact.id, { company: "NewOrg" });
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/photo.vcf", {
        etag: '"p2"',
        vcard: miniVcard("Photo Person", [
          "ORG:OldOrg",
          `PHOTO;VALUE=URI:${dav.url}/avatar.png`,
        ]),
      });
      dav.puts.length = 0;
      const runStale = await runNow(s, conn.id, "manual");
      expect(runStale.status).toBe("ok");
      const afterStale = sqlite
        .prepare("SELECT company FROM contacts WHERE id = ?")
        .get(photoContact.id) as { company: string };
      expect(afterStale.company).toBe("NewOrg");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.body).toContain("ORG:NewOrg");

      // Edit Photo Person a second time after push (which stored remoteCardHash including PHOTO)
      // and bump the server ETag to '"p2b"' with the server's post-PUT vCard: must not overwrite ThirdOrg!
      contactService.updateContact(s, photoContact.id, { company: "ThirdOrg" });
      const currentServerCard = dav.books["/dav/ab/a/"]!.get(
        "/dav/ab/a/photo.vcf",
      )!;
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/photo.vcf", {
        etag: '"p2b"',
        vcard: currentServerCard.vcard,
      });
      dav.puts.length = 0;
      await runNow(s, conn.id, "manual");
      const afterSecondEdit = sqlite
        .prepare("SELECT company FROM contacts WHERE id = ?")
        .get(photoContact.id) as { company: string };
      expect(afterSecondEdit.company).toBe("ThirdOrg");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.body).toContain("ORG:ThirdOrg");

      // When the server's PHOTO URI actually changes with a new ETag, sync yields the update
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/photo.vcf", {
        etag: '"p3"',
        vcard: miniVcard("Photo Person", [
          "ORG:ThirdOrg",
          `PHOTO;VALUE=URI:${dav.url}/avatar2.png`,
        ]),
      });
      const runPhotoChanged = await runNow(s, conn.id, "manual");
      expect(runPhotoChanged.stats.contacts).toBe(1);

      // Simulate an empty PROPFIND listing on a full scan: links must not be wiped
      dav.flags.rejectSync = true;
      dav.flags.emptyListing = true;
      await runNow(s, conn.id, "manual");
      const linksAfterEmpty = sqlite
        .prepare("SELECT externalId FROM connector_links WHERE connectorId = ?")
        .all(conn.id);
      expect(linksAfterEmpty).toHaveLength(1);
    });

    it("supports iCloud cross-host addressBookUrl discovery, rejects missing books on save, and handles GET/PUT recovery", async () => {
      const s = newOwner();
      const dav = await startMiniDav();
      const davPartition = await startMiniDav();

      // 1. iCloud cross-host discovery: entry server on 127.0.0.1 points home-set to partition host on localhost
      davPartition.books["/dav/ab/a/"]!.set("/dav/ab/a/icloud.vcf", {
        etag: '"ic1"',
        vcard: miniVcard("iCloud Person", ["EMAIL:icloud@example.com"]),
      });
      const partitionOrigin = davPartition.url.replace(
        "127.0.0.1",
        "localhost",
      );
      dav.flags.homeSetOverride = `${partitionOrigin}/dav/ab/`;
      const partitionBookUrl = `${partitionOrigin}/dav/ab/a/`;

      const icloudTest = await testConnector(
        s,
        "carddav",
        {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: partitionBookUrl,
        },
        { password: VALID_PASS },
      );
      expect(icloudTest.ok).toBe(true);
      expect(icloudTest.detail).toBe("Connected to Book /dav/ab/a/");

      const icloudConn = await createConnector(s, {
        kind: "carddav",
        name: "icloud",
        config: {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: partitionBookUrl,
        },
        secret: { password: VALID_PASS },
      });
      expect(icloudConn.id).toBeDefined();
      const icloudRun = await runNow(s, icloudConn.id, "manual");
      expect(icloudRun.status).toBe("ok");
      expect(icloudRun.stats.contacts).toBe(1);
      dav.flags.homeSetOverride = null;

      // 2. testConnector with a missing addressBookUrl falls back and returns the full book list with a warning
      const testMissing = await testConnector(
        s,
        "carddav",
        {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${dav.url}/dav/ab/missing/`,
        },
        { password: VALID_PASS },
      );
      expect(testMissing.ok).toBe(true);
      expect(testMissing.detail).toMatch(
        /Selected address book was not found; switched to/i,
      );
      expect(testMissing.addressBooks).toHaveLength(2);

      // 3. createConnector with an addressBookUrl not in the server's discovered list rejects immediately
      // (both via home-set discovery and direct address book URL discovery)
      await expect(
        createConnector(s, {
          kind: "carddav",
          name: "bad-book",
          config: {
            url: dav.url,
            username: VALID_USER,
            syncDirection: "two_way",
            addressBookUrl: `${dav.url}/dav/ab/missing/`,
          },
          secret: { password: VALID_PASS },
        }),
      ).rejects.toThrow(
        /Selected address book was not found on the CardDAV server/i,
      );

      await expect(
        createConnector(s, {
          kind: "carddav",
          name: "wrong-origin-direct-book",
          config: {
            url: `${dav.url}/dav/ab/a/`,
            username: VALID_USER,
            syncDirection: "two_way",
            addressBookUrl: "https://evil.example.com/dav/ab/a/",
          },
          secret: { password: VALID_PASS },
        }),
      ).rejects.toThrow(
        /Selected address book was not found on the CardDAV server/i,
      );

      // 4. GET failure before PUT skips the PUT rather than stripping NICKNAME / X-* fields
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/k.vcf", {
        etag: '"k1"',
        vcard: miniVcard("Kept Fields", ["NICKNAME:Kiki", "X-CUSTOM:keep"]),
      });
      const conn = await createConnector(s, {
        kind: "carddav",
        name: "dav",
        config: {
          url: dav.url,
          username: VALID_USER,
          syncDirection: "two_way",
          addressBookUrl: `${dav.url}/dav/ab/a/`,
        },
        secret: { password: VALID_PASS },
      });
      await runNow(s, conn.id, "manual");
      const keptContact = sqlite
        .prepare(
          "SELECT id FROM contacts WHERE ownerId = ? AND name = 'Kept Fields'",
        )
        .get(s.ownerId) as { id: string };
      contactService.updateContact(s, keptContact.id, { company: "NewCo" });
      dav.flags.getFails = true;
      dav.puts.length = 0;
      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(0);

      // A false 404 on GET sends If-None-Match: * on PUT, so the server rejects with 412
      // instead of overwriting NICKNAME / X-CUSTOM on the live card
      dav.flags.getFails = false;
      dav.flags.false404OnGet = true;
      dav.puts.length = 0;
      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.ifNoneMatch).toBe("*");
      expect(dav.books["/dav/ab/a/"]!.get("/dav/ab/a/k.vcf")!.vcard).toContain(
        "NICKNAME:Kiki",
      );

      // When GET recovers, the pending edit is pushed with NICKNAME and X-CUSTOM preserved
      dav.flags.false404OnGet = false;
      dav.puts.length = 0;
      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.body).toContain("ORG:NewCo");
      expect(dav.puts[0]!.body).toContain("NICKNAME:Kiki");
      expect(dav.puts[0]!.body).toContain("X-CUSTOM:keep");

      // When a linked card is genuinely missing on GET (404) during push, push re-creates it with If-None-Match: *
      dav.books["/dav/ab/a/"]!.delete("/dav/ab/a/k.vcf");
      dav.puts.length = 0;
      contactService.updateContact(s, keptContact.id, {
        company: "ReCreatedCo",
      });
      await runNow(s, conn.id, "manual");
      expect(dav.puts).toHaveLength(1);
      expect(dav.puts[0]!.ifNoneMatch).toBe("*");
      expect(dav.puts[0]!.body).toContain("ORG:ReCreatedCo");
      expect(dav.books["/dav/ab/a/"]!.has("/dav/ab/a/k.vcf")).toBe(true);

      // 5. Partial PUT failure midway preserves links for already-uploaded contacts and uploads the rest on retry
      const localA = contactService.createContact(s, { name: "Aaa Local" })!;
      const localB = contactService.createContact(s, { name: "Bbb Local" })!;
      dav.puts.length = 0;
      dav.flags.failPutPrefix = `/dav/ab/a/${encodeURIComponent(localB.id)}`;
      await runNow(s, conn.id, "manual");
      const linkForA = sqlite
        .prepare(
          "SELECT externalId FROM connector_links WHERE connectorId = ? AND localId = ?",
        )
        .get(conn.id, localA.id);
      expect(linkForA).toBeDefined();
      const linkForBBefore = sqlite
        .prepare(
          "SELECT externalId FROM connector_links WHERE connectorId = ? AND localId = ?",
        )
        .get(conn.id, localB.id);
      expect(linkForBBefore).toBeUndefined();

      // Next run uploads B without duplicating A
      dav.flags.failPutPrefix = null;
      await runNow(s, conn.id, "manual");
      const aRows = sqlite
        .prepare(
          "SELECT id FROM contacts WHERE ownerId = ? AND name = 'Aaa Local' AND deletedAt IS NULL",
        )
        .all(s.ownerId);
      expect(aRows).toHaveLength(1);
      const linkForBAfter = sqlite
        .prepare(
          "SELECT externalId FROM connector_links WHERE connectorId = ? AND localId = ?",
        )
        .get(conn.id, localB.id) as { externalId: string } | undefined;
      expect(linkForBAfter).toBeDefined();
      expect(dav.books["/dav/ab/a/"]!.has(linkForBAfter!.externalId)).toBe(
        true,
      );

      // 6. Oversized > 5 MB card is not recorded in cursor.etags so it retries when shrunk
      const bigPadding = "X".repeat(5 * 1024 * 1024 + 500);
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/huge.vcf", {
        etag: '"huge-1"',
        vcard: miniVcard("Huge Card", [`NOTE:${bigPadding}`]),
      });
      dav.flags.rejectSync = true;
      await runNow(s, conn.id, "manual");
      const hugeBefore = sqlite
        .prepare(
          "SELECT id FROM contacts WHERE ownerId = ? AND name = 'Huge Card'",
        )
        .get(s.ownerId);
      expect(hugeBefore).toBeUndefined();

      // Shrink card while keeping the same ETag '"huge-1"' -> next sync fetches it!
      dav.books["/dav/ab/a/"]!.set("/dav/ab/a/huge.vcf", {
        etag: '"huge-1"',
        vcard: miniVcard("Huge Card", ["NOTE:Normal size"]),
      });
      await runNow(s, conn.id, "manual");
      const hugeAfter = sqlite
        .prepare(
          "SELECT id FROM contacts WHERE ownerId = ? AND name = 'Huge Card'",
        )
        .get(s.ownerId);
      expect(hugeAfter).toBeDefined();
    });
  });
});
