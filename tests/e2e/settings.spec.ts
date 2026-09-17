/**
 * Settings revamped — shell, rail, search, rows and redirects.
 *
 * Covers Prompt 1 of the settings revamp:
 * - Desktop two-pane shell with 240px navigation rail
 * - Tab sequence walking the rail in order
 * - SettingRow search, keyboard selection, deep link navigation, flash and focus
 * - Modified indicator dot and reset preference button
 * - Phone single-pane view and back button behavior
 * - Redirection aliases for moved settings paths
 * - Accessibility scans for the revamped settings pages
 */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

test.describe("Settings — Desktop", () => {
  test("shows 240px navigation rail and active page with 'Back to Network'", async ({
    page,
  }) => {
    await page.goto("/settings");
    const rail = page.getByRole("navigation", { name: "Settings" });
    await expect(rail).toBeVisible();

    // Verify rail width is 240px (w-60 in Tailwind)
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.width - 240)).toBeLessThan(2);

    // On wide screens, the back button points to "/" with label "Back to Network"
    const backBtn = page.getByRole("button", { name: "Back to Network" });
    await expect(backBtn).toBeVisible();

    // Clicking Appearance navigates and marks aria-current="page"
    const appearanceLink = rail.getByRole("link", { name: "Appearance" });
    await appearanceLink.click();
    await expect(page).toHaveURL(/\/settings\/appearance/);
    await expect(appearanceLink).toHaveAttribute("aria-current", "page");

    // Heading for Appearance is rendered
    await expect(
      page.getByRole("heading", { name: "Appearance", level: 1 }),
    ).toBeVisible();
  });

  test("tab from search box walks the rail links in order", async ({
    page,
  }) => {
    await page.goto("/settings");
    const searchInput = page.getByRole("searchbox", {
      name: "Search settings",
    });
    await searchInput.focus();

    const rail = page.getByRole("navigation", { name: "Settings" });
    const links = rail.getByRole("link");
    const count = await links.count();
    expect(count).toBeGreaterThan(5);

    for (let i = 0; i < count; i++) {
      await page.keyboard.press("Tab");
      const expectedHref = await links.nth(i).getAttribute("href");
      const activeHref = await page.evaluate(() =>
        (document.activeElement as HTMLAnchorElement)?.getAttribute("href"),
      );
      expect(activeHref).toBe(expectedHref);
    }
  });

  test("search for 'celsius' lists 1 result and Enter navigates with flash and focus", async ({
    page,
  }) => {
    await page.goto("/settings");
    const searchInput = page.getByRole("searchbox", {
      name: "Search settings",
    });
    await searchInput.fill("celsius");

    // Results region opens
    const resultsContainer = page.getByRole("region", {
      name: "Search results",
    });
    await expect(resultsContainer).toBeVisible();

    const options = resultsContainer.getByRole("link");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Temperature unit");

    // Press Enter to navigate to the result
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/network#temp-unit/);

    // Row is focused and flashed
    const tempUnitRow = page.locator("#temp-unit");
    await expect(tempUnitRow).toBeVisible();
    await expect(tempUnitRow).toBeFocused();
    await expect(tempUnitRow).toHaveClass(/ring-2/);
  });

  test("SettingRow shows modified dot and reset button when preference is stored", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");

    const themeRow = page.locator("#theme");
    await expect(themeRow).toBeVisible();

    // Initially with default system theme, no modified dot and no reset button
    const resetBtn = themeRow.getByRole("button", {
      name: "Reset",
    });
    await expect(resetBtn).toBeHidden();

    // Click "Dark" radio to change theme preference
    const darkRadio = themeRow.getByRole("radio", { name: "Dark" });
    await darkRadio.click();

    // Reset button and modified dot indicator should now be visible
    await expect(resetBtn).toBeVisible();
    await expect(themeRow.getByText("Changed from the default")).toBeVisible();

    // Click Reset to default
    await resetBtn.click();

    // Preference is reset: reset button and modified dot disappear
    await expect(resetBtn).toBeHidden();
    await expect(themeRow.getByText("Changed from the default")).toBeHidden();
  });

  test("old URLs redirect to their new paths", async ({ page }) => {
    const redirects: [string, RegExp][] = [
      ["/settings/dedupe", /\/settings\/duplicates$/],
      ["/settings/ai-search", /\/settings\/enrichment$/],
      ["/settings/ai-config", /\/settings\/admin\/ai$/],
      ["/settings/admin/instance", /\/settings\/admin\/general$/],
      ["/settings/ai-stats", /\/settings\/admin\/ai-usage$/],
    ];

    for (const [from, to] of redirects) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });
});

test.describe("Settings — Phone", () => {
  test.use({ ...PHONE });

  test("renders list on phone, opens page with back button, back returns to list", async ({
    page,
  }) => {
    await page.goto("/settings");

    // Heading for Settings is visible
    await expect(
      page.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeVisible();

    // Finding A14: On phone landing page, Back button is omitted
    const backBtn = page.getByRole("button", { name: /^Back to/ });
    await expect(backBtn).toBeHidden();

    // Group items are listed as clickable links
    const appearanceLink = page
      .getByRole("main")
      .getByRole("link", { name: /Appearance/ });
    await expect(appearanceLink).toBeVisible();
    await appearanceLink.click();

    // Navigated to /settings/appearance
    await expect(page).toHaveURL(/\/settings\/appearance/);

    // On subpages, Back button is visible and labeled "Back to Settings"
    const subpageBack = page.getByRole("button", { name: "Back to Settings" });
    await expect(subpageBack).toBeVisible();

    // Click Back to Settings
    await subpageBack.click();
    await expect(page).toHaveURL(/\/settings$/);
  });
});

test.describe("Settings — Accessibility", () => {
  const pages = [
    { name: "settings landing", path: "/settings" },
    { name: "appearance", path: "/settings/appearance" },
    { name: "network", path: "/settings/network" },
    { name: "duplicates", path: "/settings/duplicates" },
    { name: "enrichment", path: "/settings/enrichment" },
    { name: "export", path: "/settings/export" },
    { name: "admin general", path: "/settings/admin/general" },
    { name: "admin ai providers", path: "/settings/admin/ai" },
    { name: "admin mail", path: "/settings/admin/mail" },
  ];

  for (const p of pages) {
    test(`${p.name} page passes WCAG accessibility scan`, async ({
      page,
    }, testInfo) => {
      await page.goto(p.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectPageAccessible(page, testInfo, p.name);
    });
  }
});
