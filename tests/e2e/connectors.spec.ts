/**
 * tests/e2e/connectors.spec.ts — E2E browser tests for Connectors & Calendar.
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

    fixtureServer = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/calendar" });
      res.end(fixture);
    });

    await new Promise<void>((resolve) =>
      fixtureServer.listen(0, "127.0.0.1", resolve),
    );
    const addr = fixtureServer.address() as AddressInfo;
    icsUrl = `http://127.0.0.1:${addr.port}/feed.ics`;
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

  test("phone viewport: connectors view renders and is accessible", async ({
    browser,
  }, testInfo) => {
    const local = await ContrackInstance.start({
      authRequired: false,
      env: {
        CONNECTORS_ALLOW_PRIVATE_HOSTS: "true",
      },
    });

    try {
      const context = await browser.newContext({
        baseURL: local.baseURL,
        ...PHONE,
      });
      const page = await context.newPage();

      await page.goto("/settings/connectors");
      await expect(
        page.getByRole("heading", {
          name: NAMES.connectors.title,
          exact: true,
        }),
      ).toBeVisible();

      await expectPageAccessible(page, testInfo, "connectors-phone");
      await context.close();
    } finally {
      await local.stop();
    }
  });
});
