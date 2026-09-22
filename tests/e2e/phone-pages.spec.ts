/**
 * Phone pages — Duplicates, Ask Contrack, and Import on a 390 px phone.
 *
 * Checks:
 * 1. /settings/duplicates:
 *    - Full-width Segmented control ("Auto scan" and "Manual merge") unclipped and unwrapped.
 *    - "Merge activity" moves into an ActionMenu in the header below sm.
 *    - expectPageAccessible and expectFloors hold.
 * 2. /search:
 *    - Coverage card and indexing explanation shown in empty state before search when < 100%.
 *    - Compact bar remains in the header.
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
  });

  test("ask contrack on phone: coverage card shown in empty state before search when < 100%", async ({
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
    await expect(page.getByText("Ask anything")).toBeVisible();

    // Explanatory sentence is visible
    await expect(
      page.getByText(
        "Indexing turns contacts into searchable concepts so you can find people by meaning rather than exact words.",
      ),
    ).toBeVisible();

    // Full coverage bar is visible inside the empty state
    await expect(
      page.getByRole("heading", { name: "Semantic search coverage" }),
    ).toBeVisible();

    // Compact bar in the header is also present
    await expect(
      page.getByRole("heading", { level: 1, name: "Ask Contrack" }),
    ).toBeVisible();

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
