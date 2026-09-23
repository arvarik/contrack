/**
 * Phone pages — Duplicates, Ask Contrack, and Import on a 390 px phone.
 *
 * Checks:
 * 1. /settings/duplicates:
 *    - Full-width Segmented control ("Auto scan" and "Manual merge") unclipped and unwrapped.
 *    - "Merge activity" moves into an ActionMenu in the header below sm.
 *    - expectPageAccessible and expectFloors hold.
 * 2. /search:
 *    - The coverage row is shown under the search box before a search when < 100%.
 *    - No coverage card, hero or explanation around it.
 * 3. /settings/import:
 *    - Drop zone appears before "How to export from..." disclosure.
 *    - Last chosen source is persisted in localStorage and restored on reload.
 * 4. Screenshots in both light and dark modes on phone.
 */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { expectFloors } from "./fixtures/metrics";
import fs from "node:fs/promises";
import path from "node:path";

const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

const ALLOW = [".maplibregl-ctrl-attrib"];

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  "docs/screenshots/phone-pages",
);

async function ensureScreenshotDir() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

test.describe("phone pages (390 px)", () => {
  test.use({
    ...PHONE,
    viewport: { width: 390, height: 844 },
  });

  test.beforeAll(async () => {
    await ensureScreenshotDir();
  });

  test("duplicates on phone: segmented tabs unclipped, action menu opens merge activity, accessible", async ({
    page,
  }, testInfo) => {
    await page.goto("/settings/duplicates");
    await expect(
      page.getByRole("heading", { level: 1, name: "Duplicates" }),
    ).toBeVisible();

    // Segmented tab controls
    const autoScan = page.getByRole("radio", { name: "Auto scan" });
    const manualMerge = page.getByRole("radio", { name: "Manual merge" });

    await expect(autoScan).toBeVisible();
    await expect(manualMerge).toBeVisible();

    // Verify neither label is clipped or wrapped
    const autoScanClipped = await autoScan.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    const manualMergeClipped = await manualMerge.evaluate(
      (el) => el.scrollWidth > el.clientWidth,
    );
    expect(autoScanClipped).toBe(false);
    expect(manualMergeClipped).toBe(false);

    // One scroller: the settings card and the tool scroll with the page. A
    // box that scrolls inside the page catches a flick and stops the page.
    const scrollers = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("#main-content *")).filter(
          (el) =>
            /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 1,
        ).length,
    );
    expect(scrollers).toBe(1);

    // Below sm, "Merge activity" moves into an ActionMenu in the header
    const actionMenuBtn = page.getByRole("button", {
      name: "Duplicates actions",
    });
    await expect(actionMenuBtn).toBeVisible();

    await actionMenuBtn.click();
    const mergeActivityItem = page.getByRole("menuitem", {
      name: "Merge activity",
    });
    await expect(mergeActivityItem).toBeVisible();
    await mergeActivityItem.click();

    // Merge activity slide-out opens
    await expect(
      page.getByRole("heading", { name: "Merge activity", exact: true }),
    ).toBeVisible();

    // Close merge activity slide-out
    await page.getByRole("button", { name: "Close merge activity" }).click();
    await expect(
      page.getByRole("heading", { name: "Merge activity", exact: true }),
    ).not.toBeVisible();

    // Accessibility and floor checks
    await expectPageAccessible(page, testInfo, "duplicates-phone");
    await expectFloors(page, testInfo, "duplicates-phone", { allow: ALLOW });

    // Capture screenshots in light and dark
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "duplicates-phone-light.png"),
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "duplicates-phone-dark.png"),
    });

    // Manual merge: the picker takes its full height in the page's one
    // scroller, and Compare sticks on top of the tab bar while a person
    // picks. Picking and comparing write nothing.
    await manualMerge.click();
    await page.getByRole("button", { name: /Ada Lovelace/ }).click();
    await page.getByRole("button", { name: /Grace Hopper/ }).click();
    const compare = page.getByRole("button", { name: /Compare 2 contacts/ });
    await expect(compare).toBeInViewport();
    const tabBar = await page
      .getByRole("navigation", { name: "Primary" })
      .boundingBox();
    const compareBox = await compare.boundingBox();
    expect(compareBox!.y + compareBox!.height).toBeLessThanOrEqual(tabBar!.y);
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll("#main-content *")).filter(
            (el) =>
              /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
              el.scrollHeight > el.clientHeight + 1,
          ).length,
      ),
    ).toBe(1);

    // The picked contacts and the search stick to the top of the scroller,
    // so both stay in reach from the bottom of the list.
    await page.evaluate(() => {
      const scroller = Array.from(
        document.querySelectorAll("#main-content *"),
      ).find(
        (el) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 1,
      )!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    await expect(
      page.getByRole("textbox", { name: "Search contacts to merge" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Remove Grace Hopper" }),
    ).toBeInViewport();
    await expect(compare).toBeInViewport();

    // The Compare stage opens at its top, with Back on the screen. It used
    // to open where the list was scrolled to, 998 px down.
    await compare.click();
    await expect(
      page.getByRole("button", { name: "Back", exact: true }),
    ).toBeInViewport();
  });

  test("ask contrack on phone: coverage row shown under the search box before search when < 100%", async ({
    page,
  }) => {
    // Intercept search coverage to guarantee under 100%
    await page.route("**/api/search/coverage", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 10,
          indexed: 6,
          missing: 4,
          pending: 0,
          failed: 0,
          coverage: 60,
          isIndexing: false,
          provider: {
            kind: "builtin",
            providerId: null,
            model: null,
            isPaid: false,
          },
          failedItems: [],
        }),
      });
    });

    await page.goto("/search");
    await expect(
      page.getByRole("heading", { level: 1, name: "Ask Contrack" }),
    ).toBeVisible();

    // One slim row under the search box says how far indexing has got, with
    // the action that finishes it
    const row = page.getByRole("region", { name: "Semantic search coverage" });
    await expect(row).toBeVisible();
    await expect(row.getByText("6 of 10 contacts indexed")).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Index missing" }),
    ).toBeVisible();
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    const inputBox = await input.boundingBox();
    const rowBox = await row.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.y).toBeGreaterThan(inputBox!.y);

    // The suggestions are still the empty page's content
    await expect(
      page.getByRole("heading", { name: "Try asking" }),
    ).toBeVisible();

    // No coverage card, hero or explanation around it
    await expect(
      page.getByRole("heading", { name: "Semantic search coverage" }),
    ).toHaveCount(0);
    await expect(page.getByText("Ask anything", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText(/Indexing turns contacts/)).toHaveCount(0);

    // Capture screenshots in light and dark
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "search-phone-light.png"),
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "search-phone-dark.png"),
    });
  });

  test("import panel on phone: drop zone first, disclosure under it, and remembers source", async ({
    page,
  }) => {
    await page.goto("/settings/import");
    await expect(
      page.getByRole("heading", { level: 1, name: "Import" }),
    ).toBeVisible();

    // Check that drop zone appears before the disclosure
    const dropZone = page.getByLabel(/Upload .* file/);
    const disclosure = page.locator("details", {
      hasText: "How to export from",
    });

    await expect(dropZone).toBeVisible();
    await expect(disclosure).toBeVisible();

    const isPreceding = await page.evaluate(() => {
      const zone = document.querySelector('[aria-label^="Upload "]');
      const det = document.querySelector("details");
      return Boolean(
        zone &&
        det &&
        zone.compareDocumentPosition(det) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(isPreceding).toBe(true);

    const dropZoneBox = await dropZone.boundingBox();
    const disclosureBox = await disclosure.boundingBox();
    expect(dropZoneBox).not.toBeNull();
    expect(disclosureBox).not.toBeNull();
    expect(dropZoneBox!.y).toBeLessThan(disclosureBox!.y);

    // Switch to LinkedIn and verify persistence in localStorage
    const linkedinTab = page.getByRole("tab", { name: "LinkedIn" });
    await linkedinTab.click();
    await expect(linkedinTab).toHaveAttribute("aria-selected", "true");

    const savedSource = await page.evaluate(() =>
      localStorage.getItem("contrack.import.lastSource"),
    );
    expect(savedSource).toBe("linkedin");

    // Reload page and verify that LinkedIn remains selected
    await page.reload();
    await expect(
      page.getByRole("heading", { level: 1, name: "Import" }),
    ).toBeVisible();
    const reloadedLinkedinTab = page.getByRole("tab", { name: "LinkedIn" });
    await expect(reloadedLinkedinTab).toHaveAttribute("aria-selected", "true");

    // Capture screenshots in light and dark
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "import-phone-light.png"),
    });

    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "import-phone-dark.png"),
    });
  });
});
