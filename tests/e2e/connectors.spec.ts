/**
 * Connectors and the Calendar connector, in the browser.
 *
 * Covers:
 * - Booting dedicated instance with CONNECTORS_ALLOW_PRIVATE_HOSTS="true"
 * - Serving ICS fixture from in-process http.Server
 * - Navigating to Settings → Connectors
 * - Opening AddConnectorSheet gallery and inspecting kinds
 * - Adding Calendar connector with URL, testing connection, and saving
 * - Running manual sync and seeing run stats on card ("1 meeting")
 * - Verifying "via Calendar" badge on contact timeline
 * - Opening RunHistoryDrawer
 * - Removing connector with "delete what it imported" and verifying interaction is deleted
 * - Axe accessibility checks on page, modal form, and run history drawer
 *
 * @module tests/e2e/connectors.spec
 */

import http from "node:http";
import type { AddressInfo } from "node:net";
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { ContrackInstance } from "./fixtures/instance";
import { NAMES } from "../../src/lib/names";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

test.describe("Settings — Connectors & Calendar", () => {
  let fixtureServer: http.Server;
  let icsUrl: string;
  let carddavUrl: string;
  const carddavCards = new Map<string, { etag: string; vcard: string }>();
  const carddavPuts: Array<{ path: string; body: string }> = [];

  function resetCarddavFixture() {
    carddavCards.clear();
    carddavPuts.length = 0;
    carddavCards.set("/dav/addressbooks/alice/default/babbage.vcf", {
      etag: '"etag-babbage-1"',
      vcard: [
        "BEGIN:VCARD",
        "VERSION:3.0",
        "UID:e2e-uid-babbage",
        "N:Babbage;Charles;;;",
        "FN:Charles Babbage",
        "ORG:Analytical Engine",
        "TITLE:Chief Inventor",
        "EMAIL;TYPE=INTERNET,WORK,PREF:charles@analytical.org",
        "NOTE:Met at the Royal Society",
        "X-CUSTOM-PROP:preserve-e2e",
        "END:VCARD",
      ].join("\r\n"),
    });
  }

  test.beforeAll(async () => {
    function toIcsDate(d: Date): string {
      return d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    }

    const pastDate = new Date(Date.now() - 2 * 86400000);
    const pastEndDate = new Date(pastDate.getTime() + 3600000);

    const fixture = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Contrack E2E Tests//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:e2e-meeting-ada@contrack.test
DTSTAMP:20260101T000000Z
DTSTART:${toIcsDate(pastDate)}
DTEND:${toIcsDate(pastEndDate)}
SUMMARY:Architecture Discussion with Ada
DESCRIPTION:Sync on analytical engine design
ORGANIZER;CN=Host:mailto:host@example.com
ATTENDEE;CN=Ada Lovelace:mailto:ada@example.com
END:VEVENT
END:VCALENDAR`;

    const expectedAuth = `Basic ${Buffer.from("alice@example.com:app-pass-e2e").toString("base64")}`;

    fixtureServer = http.createServer(async (req, res) => {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = reqUrl.pathname;
      const method = req.method ?? "GET";

      if (pathname === "/feed.ics") {
        res.writeHead(200, { "Content-Type": "text/calendar" });
        res.end(fixture);
        return;
      }

      // CardDAV endpoints require Basic Auth
      if (req.headers.authorization !== expectedAuth) {
        res.writeHead(401, { "WWW-Authenticate": 'Basic realm="CardDAV"' });
        res.end("Unauthorized");
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");

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
        <d:current-user-principal><d:href>/dav/principals/alice/</d:href></d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

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
        <c:addressbook-home-set><d:href>/dav/addressbooks/alice/</d:href></c:addressbook-home-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      if (pathname === "/dav/addressbooks/alice/" && method === "PROPFIND") {
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
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
          <d:privilege><d:write/></d:privilege>
        </d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/addressbooks/alice/archive/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>
        <d:displayname>Archive Contacts</d:displayname>
        <d:current-user-privilege-set>
          <d:privilege><d:read/></d:privilege>
        </d:current-user-privilege-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`);
        return;
      }

      if (
        pathname === "/dav/addressbooks/alice/default/" &&
        method === "PROPFIND"
      ) {
        const depth = req.headers.depth ?? "0";
        const items: string[] = [];
        if (depth === "1") {
          for (const [href, card] of carddavCards.entries()) {
            items.push(`  <d:response>
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
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
${items.join("\n")}
</d:multistatus>`);
        return;
      }

      if (
        pathname === "/dav/addressbooks/alice/default/" &&
        method === "REPORT"
      ) {
        if (body.includes("addressbook-multiget")) {
          const hrefs = Array.from(
            body.matchAll(/<[^:>]*:?href>([^<]+)<\/[^:>]*:?href>/g),
          ).map((m) => m[1]!);
          const items: string[] = [];
          for (const href of hrefs) {
            const card = carddavCards.get(href);
            if (!card) continue;
            const escaped = card.vcard
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            items.push(`  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${card.etag}</d:getetag>
        <c:address-data>${escaped}</c:address-data>
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
${items.join("\n")}
</d:multistatus>`);
          return;
        }
      }

      if (
        pathname.startsWith("/dav/addressbooks/alice/default/") &&
        method === "GET"
      ) {
        const card = carddavCards.get(pathname);
        if (!card) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/vcard; charset=utf-8",
          ETag: card.etag,
        });
        res.end(card.vcard);
        return;
      }

      if (
        pathname.startsWith("/dav/addressbooks/alice/default/") &&
        method === "PUT"
      ) {
        carddavPuts.push({ path: pathname, body });
        const existing = carddavCards.has(pathname);
        const newEtag = `"etag-${carddavPuts.length + 1}"`;
        carddavCards.set(pathname, { etag: newEtag, vcard: body });
        res.writeHead(existing ? 204 : 201, { ETag: newEtag });
        res.end();
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) =>
      fixtureServer.listen(0, "127.0.0.1", resolve),
    );
    const addr = fixtureServer.address() as AddressInfo;
    icsUrl = `http://127.0.0.1:${addr.port}/feed.ics`;
    carddavUrl = `http://127.0.0.1:${addr.port}/dav/`;
  });

  test.afterAll(async () => {
    if (fixtureServer) {
      await new Promise<void>((resolve) =>
        fixtureServer.close(() => resolve()),
      );
    }
  });

  test("connectors lifecycle: add calendar, test connection, sync meeting, view via badge, and delete imported", async ({
    browser,
  }, testInfo) => {
    const local = await ContrackInstance.start({
      authRequired: false,
      env: {
        CONNECTORS_ALLOW_PRIVATE_HOSTS: "true",
        DISABLE_BACKGROUND_JOBS: "true",
      },
    });

    try {
      // Seed a contact with email ada@example.com
      const contact = await local.api<{ id: string; name: string }>(
        "POST",
        "/contacts",
        {
          name: "Ada Lovelace",
          emails: [{ email: "ada@example.com", isPrimary: true }],
        },
      );

      const context = await browser.newContext({ baseURL: local.baseURL });
      const page = await context.newPage();

      // 1. Navigate to Settings → Connectors
      await page.goto("/settings/connectors");
      await expect(
        page.getByRole("heading", { name: NAMES.connectors.title, level: 1 }),
      ).toBeVisible();

      // Verify empty gallery
      await expectPageAccessible(page, testInfo, "connectors-empty");

      // 2. Choose Calendar from empty state gallery
      const connectBtn = page.getByRole("button", { name: "Connect" }).first();
      await expect(connectBtn).toBeVisible();
      await connectBtn.click();

      // 3. Calendar form opens
      const formDialog = page.getByRole("dialog", {
        name: /connect calendar/i,
      });
      await expect(formDialog).toBeVisible();

      const urlInput = formDialog.locator("#connector-ics-url");
      await urlInput.fill(icsUrl);

      // Test connection
      const testBtn = formDialog.getByRole("button", {
        name: /test connection/i,
      });
      await testBtn.click();
      await expect(formDialog.getByRole("status")).toContainText(
        /connected successfully/i,
      );

      await expectPageAccessible(page, testInfo, "calendar-form");

      // Save connector
      const saveBtn = formDialog.getByRole("button", {
        name: "Connect",
        exact: true,
      });
      await saveBtn.click();

      // Form closes and card appears
      await expect(formDialog).toBeHidden();
      const card = page
        .locator(".card")
        .filter({ hasText: "Personal Calendar" });
      await expect(card).toBeVisible();
      await expect(card.getByText("Active")).toBeVisible();

      // 4. Test AddConnectorSheet gallery when connectors already exist
      const addBtn = page.getByRole("button", { name: /add connector/i });
      await expect(addBtn).toBeVisible();
      await addBtn.click();

      const galleryDialog = page.getByRole("dialog", {
        name: /add a connector/i,
      });
      await expect(galleryDialog).toBeVisible();
      await expectPageAccessible(page, testInfo, "add-connector-gallery");

      // Select IMAP from gallery to test IMAP form opening
      await galleryDialog
        .getByRole("button", { name: /Mailbox \(IMAP\)/i })
        .click();
      const imapDialog = page.getByRole("dialog", {
        name: /Connect Mailbox \(IMAP\)/i,
      });
      await expect(imapDialog).toBeVisible();
      await expectPageAccessible(page, testInfo, "imap-form");
      await imapDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(imapDialog).toBeHidden();

      // Select CardDAV from gallery to test CardDAV form opening & accessibility
      await addBtn.click();
      await expect(galleryDialog).toBeVisible();
      await galleryDialog.getByRole("button", { name: /CardDAV/i }).click();
      const carddavDialog = page.getByRole("dialog", {
        name: /Connect CardDAV/i,
      });
      await expect(carddavDialog).toBeVisible();
      await expectPageAccessible(page, testInfo, "carddav-form");
      await carddavDialog.getByRole("button", { name: "Cancel" }).click();
      await expect(carddavDialog).toBeHidden();

      // 4b. Test Correspondents page
      await page.goto("/settings/connectors/people");
      await expect(
        page.getByRole("heading", { name: "Correspondents", level: 1 }),
      ).toBeVisible();
      await expectPageAccessible(page, testInfo, "correspondents-empty");
      await page.goto("/settings/connectors");

      // 5. Trigger Sync now
      const actionMenuTrigger = card.getByRole("button", {
        name: /actions for personal calendar/i,
      });
      await actionMenuTrigger.click();

      const syncMenuItem = page.getByRole("menuitem", { name: /sync now/i });
      await syncMenuItem.click();

      // Verify stats line on card
      await expect(card.getByText(/1 meeting/i)).toBeVisible();

      // 6. View Contact Timeline for Ada Lovelace
      await page.goto(`/contact/${contact.id}`);
      await expect(
        page.getByText("Architecture Discussion with Ada"),
      ).toBeVisible();
      // Verify SOURCE_BADGE "via Calendar"
      await expect(page.getByText("via Calendar")).toBeVisible();

      // 7. Back to Connectors view and inspect Run History Drawer
      await page.goto("/settings/connectors");
      const cardAgain = page
        .locator(".card")
        .filter({ hasText: "Personal Calendar" });
      await cardAgain
        .getByRole("button", { name: /actions for personal calendar/i })
        .click();

      await page.getByRole("menuitem", { name: /run history/i }).click();
      const drawer = page.getByRole("dialog", { name: /run history/i });
      await expect(drawer).toBeVisible();
      await expectPageAccessible(page, testInfo, "run-history-drawer");

      // Close drawer
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await expect(drawer).toBeHidden();

      // 8. Delete connector with deleteImported=true
      await cardAgain
        .getByRole("button", { name: /actions for personal calendar/i })
        .click();
      await page.getByRole("menuitem", { name: /remove/i }).click();

      const confirmDialog = page.getByRole("dialog", {
        name: /remove personal calendar/i,
      });
      await expect(confirmDialog).toBeVisible();

      const deleteImportedCheckbox = confirmDialog.getByRole("checkbox");
      await deleteImportedCheckbox.check();

      await confirmDialog
        .getByRole("button", { name: /remove connector/i })
        .click();
      await expect(confirmDialog).toBeHidden();
      await expect(
        page.locator(".card").filter({ hasText: "Personal Calendar" }),
      ).toBeHidden();

      // 9. Navigate back to Ada Lovelace: imported meeting is gone
      await page.goto(`/contact/${contact.id}`);
      await expect(
        page.getByText("Architecture Discussion with Ada"),
      ).toBeHidden();
      await expect(page.getByText("via Calendar")).toBeHidden();

      await context.close();
    } finally {
      await local.stop();
    }
  });

  test("carddav lifecycle: connect, discover address books, pull remote contact, and push local changes", async ({
    browser,
  }, testInfo) => {
    resetCarddavFixture();

    const local = await ContrackInstance.start({
      authRequired: false,
      env: {
        CONNECTORS_ALLOW_PRIVATE_HOSTS: "true",
        DISABLE_BACKGROUND_JOBS: "true",
      },
    });

    try {
      const context = await browser.newContext({ baseURL: local.baseURL });
      const page = await context.newPage();

      // 1. Open Settings → Connectors and click Connect CardDAV
      await page.goto("/settings/connectors");
      const connectCarddavBtn = page.getByRole("button", {
        name: "Connect CardDAV",
      });
      await expect(connectCarddavBtn).toBeVisible();
      await connectCarddavBtn.click();

      const formDialog = page.getByRole("dialog", {
        name: /Connect CardDAV/i,
      });
      await expect(formDialog).toBeVisible();

      // 2. Fill credentials and test connection (discovers 2 address books)
      await formDialog.locator("#carddav-url").fill(carddavUrl);
      await formDialog.locator("#carddav-username").fill("alice@example.com");
      await formDialog.locator("#carddav-password").fill("app-pass-e2e");

      const testBtn = formDialog.getByRole("button", {
        name: /test connection/i,
      });
      await testBtn.click();
      await expect(formDialog.getByRole("status")).toContainText(
        "Connected to Personal Address Book",
      );
      const bookSelect = formDialog.getByLabel("Address book", {
        exact: true,
      });
      await expect(bookSelect).toBeVisible();

      // Clicking Test connection again preserves all discovered address books
      await testBtn.click();
      await expect(bookSelect).toBeVisible();
      await expectPageAccessible(page, testInfo, "carddav-form-tested");

      // 3. Save CardDAV connector
      await formDialog
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await expect(formDialog).toBeHidden();

      const card = page
        .locator(".card")
        .filter({ hasText: "Personal Contacts" });
      await expect(card).toBeVisible();
      await expect(card.getByText("Active")).toBeVisible();

      // 4. Run manual sync to pull Charles Babbage from CardDAV server
      await card
        .getByRole("button", { name: /actions for personal contacts/i })
        .click();
      await page.getByRole("menuitem", { name: /sync now/i }).click();
      await expect(card.getByText(/1 contact/i)).toBeVisible();

      // 5. Verify Charles Babbage appears in Contrack with his CardDAV details
      const contacts = await local.api<
        Array<{ id: string; name: string; role: string }>
      >("GET", "/contacts?search=Babbage");
      expect(contacts).toHaveLength(1);
      const babbage = contacts[0]!;
      expect(babbage.name).toBe("Charles Babbage");

      await page.goto(`/contact/${babbage.id}`);
      await expect(
        page.getByRole("heading", { name: "Charles Babbage" }),
      ).toBeVisible();
      await expect(page.getByText("charles@analytical.org")).toBeVisible();

      // 6. Edit Charles Babbage locally and create Grace Hopper, then sync back to CardDAV
      const putRes = await page.request.put(
        `${local.baseURL}/api/contacts/${babbage.id}`,
        {
          data: {
            name: "Charles Babbage",
            role: "Lucasian Professor",
          },
        },
      );
      expect(putRes.ok()).toBe(true);
      await local.api("POST", "/contacts", {
        name: "Grace Hopper",
        company: "US Navy",
        emails: [{ email: "grace@navy.mil", isPrimary: true }],
      });

      await page.goto("/settings/connectors");
      const cardAfter = page
        .locator(".card")
        .filter({ hasText: "Personal Contacts" });
      await cardAfter
        .getByRole("button", { name: /actions for personal contacts/i })
        .click();
      await page.getByRole("menuitem", { name: /sync now/i }).click();

      await expect(cardAfter.getByText(/2 pushed/i)).toBeVisible();

      // Verify PUT requests received by the CardDAV server
      expect(carddavPuts).toHaveLength(2);
      const babbagePut = carddavPuts.find((p) =>
        p.path.endsWith("/babbage.vcf"),
      );
      expect(babbagePut).toBeDefined();
      const unfoldedBabbage = babbagePut!.body.replace(/\r\n[ \t]/g, "");
      expect(unfoldedBabbage).toContain("UID:e2e-uid-babbage");
      expect(unfoldedBabbage).toContain("TITLE:Lucasian Professor");
      expect(unfoldedBabbage).toContain("X-CUSTOM-PROP:preserve-e2e");

      const hopperPut = carddavPuts.find(
        (p) => !p.path.endsWith("/babbage.vcf"),
      );
      expect(hopperPut).toBeDefined();
      expect(hopperPut!.body).toContain("FN:Grace Hopper");
      expect(hopperPut!.body).toContain("grace@navy.mil");

      await context.close();
    } finally {
      await local.stop();
    }
  });
});

// The empty page needs no instance of its own: the worker's shared one has
// no connectors.
test.describe("Settings — Connectors on a phone", () => {
  test.use({ ...PHONE });

  test("the empty Connectors page is accessible", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings/connectors");
    await expect(
      page.getByRole("heading", {
        name: NAMES.connectors.title,
        exact: true,
      }),
    ).toBeVisible();

    await expectPageAccessible(page, testInfo, "connectors-phone");
  });
});
