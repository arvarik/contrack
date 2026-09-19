/**
 * End-to-end tests for map features (Prompt 1: Filters and place search).
 *
 * Exercises the filter toolbar, facet filtering, place search navigation,
 * and accessibility on desktop and mobile.
 */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { stubBasemap } from "./fixtures/map";

test.describe("map features - filters and place search", () => {
  test.beforeEach(async ({ page }) => {
    await stubBasemap(page);
  });

  test("filters by company facet token leaving one pin on the map", async ({
    page,
  }) => {
    await page.goto("/map");

    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Verify Ada's pin is visible initially
    const adaPin = map.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    await expect(adaPin).toBeVisible();

    // Filter by company:Babbage
    const filterInput = page.getByRole("textbox", { name: "Filter contacts" });
    await filterInput.fill("company:Babbage ");

    // Ada's pin remains visible
    await expect(adaPin).toBeVisible();

    // Other contacts are excluded
    await expect(
      map.getByRole("button", { name: "Grace Hopper, US Navy" }),
    ).toHaveCount(0);
    await expect(
      map.getByRole("button", { name: "Linus Torvalds, Linux Foundation" }),
    ).toHaveCount(0);
  });

  test("focuses filter input on / shortcut key", async ({ page }) => {
    await page.goto("/map");

    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    const filterInput = page.getByRole("textbox", { name: "Filter contacts" });

    // Press / on page
    await page.keyboard.press("/");
    await expect(filterInput).toBeFocused();
  });

  test("Go to place search navigates map using mock geo search", async ({
    page,
  }) => {
    // Mock the /api/geo/search endpoint
    await page.route("**/api/geo/search?q=*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          query: "Reykjavik",
          lat: 64.1466,
          lng: -21.9426,
          provider: "Nominatim",
          cached: false,
        }),
      });
    });

    await page.goto("/map");

    // Click Go to button
    const gotoBtn = page.getByRole("button", { name: "Go to place" });
    await gotoBtn.click();

    const placeInput = page.getByRole("textbox", { name: "Go to place" });
    await expect(placeInput).toBeVisible();

    await placeInput.fill("Reykjavik");
    await placeInput.press("Enter");

    // Place input completes and switches back to filter mode
    await expect(
      page.getByRole("textbox", { name: "Filter contacts" }),
    ).toBeVisible();
  });

  test("shows inline error when place search finds nothing", async ({
    page,
  }) => {
    await page.route("**/api/geo/search?q=*", async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "NO_RESULT",
            message: "Nothing found for that place",
          },
        }),
      });
    });

    await page.goto("/map");

    await page.getByRole("button", { name: "Go to place" }).click();
    const placeInput = page.getByRole("textbox", { name: "Go to place" });
    await placeInput.fill("NowhereLand");
    await placeInput.press("Enter");

    await expect(page.getByRole("alert")).toContainText(
      "Nothing found for that place",
    );
  });

  test("at-risk stats chip applies score:<40 and shows pill", async ({
    page,
  }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // The at-risk chip is in the stats strip
    const statsStrip = page.getByRole("region", {
      name: "Map viewport statistics",
    });
    const atRiskChip = statsStrip.getByRole("button", { name: /at risk/i });
    await expect(atRiskChip).toBeVisible();
    await atRiskChip.click();

    // Filter pill appears for score:<40
    const scorePill = page.getByRole("button", { name: /score.*40/i });
    await expect(scorePill).toBeVisible();

    // Map now shows only the at-risk contact (Edsger Dijkstra)
    await expect(
      map.getByRole("button", { name: "Edsger Dijkstra, UT Austin" }),
    ).toBeVisible();
    await expect(
      map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
    ).toHaveCount(0);
  });

  test("pane toggle with i persists across reload", async ({ page }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    const pane = page.getByRole("complementary", { name: "Map insights" });
    await expect(pane).toBeVisible();

    // Press "i" to close
    await page.keyboard.press("i");
    await expect(pane).toHaveCount(0);

    // Reload and verify pane remains closed
    await page.reload();
    await expect(map).toBeVisible();
    await expect(pane).toHaveCount(0);

    // Press "i" to reopen
    await page.keyboard.press("i");
    await expect(pane).toBeVisible();
  });

  test("is accessible on desktop with toolbar and insights pane open", async ({
    page,
  }, testInfo) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Map insights" }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "map-toolbar-desktop");
  });
});

const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

test.describe("map features on phone", () => {
  test.use({ ...PHONE });

  test.beforeEach(async ({ page }) => {
    await stubBasemap(page);
  });

  test("opens mobile filter sheet and is accessible", async ({
    page,
  }, testInfo) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Click Filters button
    const filtersBtn = page.getByRole("button", { name: "Filters" });
    await expect(filtersBtn).toBeVisible();
    await filtersBtn.tap();

    // Modal sheet appears
    const sheet = page.getByRole("dialog", { name: "Filters" });
    await expect(sheet).toBeVisible();

    // Check accessibility with filter sheet open
    await expectPageAccessible(page, testInfo, "map-filter-sheet-mobile");
  });

  test("opens mobile insights sheet and is accessible", async ({
    page,
  }, testInfo) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Click Insights button on mobile toolbar
    const insightsBtn = page.getByRole("button", { name: "Insights" });
    await expect(insightsBtn).toBeVisible();
    await insightsBtn.tap();

    // Modal sheet appears
    const sheet = page.getByRole("dialog", { name: "Map insights" });
    await expect(sheet).toBeVisible();

    // Check accessibility with insights sheet open
    await expectPageAccessible(page, testInfo, "map-insights-sheet-mobile");
  });
});
