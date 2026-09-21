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

  test("Shift+drag over Virginia pins selects them, adds follow-up, and Escape clears", async ({
    page,
    instance,
    seed,
  }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Zoom into the East Coast cluster (3 contacts) to reveal Margaret and the 2-contact Virginia cluster
    const cluster3 = page.getByRole("button", {
      name: "3 contacts, 0 at risk, zoom in",
    });
    await expect(cluster3).toBeVisible();
    await cluster3.click();

    // Zoom into the 2-contact Virginia cluster to split Grace Hopper and Katherine Johnson
    const cluster2 = page.getByRole("button", {
      name: "2 contacts, 0 at risk, zoom in",
    });
    await expect(cluster2).toBeVisible();
    await cluster2.click();

    // Locate Grace Hopper (Arlington) and Katherine Johnson (Hampton)
    const gracePin = map.getByRole("button", { name: /Grace Hopper/ });
    const katherinePin = map.getByRole("button", { name: /Katherine Johnson/ });
    await expect(gracePin).toBeVisible();
    await expect(katherinePin).toBeVisible();

    const graceBox = await gracePin.boundingBox();
    const katherineBox = await katherinePin.boundingBox();
    expect(graceBox).not.toBeNull();
    expect(katherineBox).not.toBeNull();

    if (!graceBox || !katherineBox) return;

    // Calculate bounding rectangle covering both pins
    const startX = Math.min(graceBox.x, katherineBox.x) - 20;
    const startY = Math.min(graceBox.y, katherineBox.y) - 20;
    const endX =
      Math.max(
        graceBox.x + graceBox.width,
        katherineBox.x + katherineBox.width,
      ) + 20;
    const endY =
      Math.max(
        graceBox.y + graceBox.height,
        katherineBox.y + katherineBox.height,
      ) + 20;

    // Perform Shift+drag box selection
    await page.keyboard.down("Shift");
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Shift");

    // Toolbar appears showing "2 selected"
    await expect(page.getByText("2 selected")).toBeVisible();

    // Click "Add follow-up"
    await page.getByRole("button", { name: "Add follow-up" }).click();
    const followupDialog = page.getByRole("dialog", {
      name: "Add Follow-up (2 selected)",
    });
    await expect(followupDialog).toBeVisible();

    // Fill title and submit with default "Tomorrow" preset
    await followupDialog.getByLabel("Task Title *").fill("Virginia catch up");
    await followupDialog
      .getByRole("button", { name: "Add to 2 contacts" })
      .click();

    // Verify success toast
    await expect(
      page.getByText("Added follow-up for 2 contacts"),
    ).toBeVisible();

    // Verify action items created for both contacts via API
    const graceId = seed.byName("Grace Hopper").id;
    const katherineId = seed.byName("Katherine Johnson").id;
    const graceItems = await instance.api<Array<{ title: string }>>(
      "GET",
      `/contacts/${graceId}/action-items`,
    );
    const katherineItems = await instance.api<Array<{ title: string }>>(
      "GET",
      `/contacts/${katherineId}/action-items`,
    );

    expect(graceItems.some((item) => item.title === "Virginia catch up")).toBe(
      true,
    );
    expect(
      katherineItems.some((item) => item.title === "Virginia catch up"),
    ).toBe(true);

    // Press Escape to clear selection
    await page.keyboard.press("Escape");
    await expect(page.getByText("2 selected")).toHaveCount(0);

    // Take the two follow-ups back off the instance. The worker's instance
    // is shared with every other spec, and two of them count what is due:
    // Pulse reads the second row of "Up next" by name, and the phone
    // metrics scan measures whatever is on that screen. A follow-up left
    // here lands in both, so this journey passed or failed by the order
    // Playwright happened to choose.
    for (const contactId of [graceId, katherineId]) {
      const items = await instance.api<{ id: string; title: string }[]>(
        "GET",
        `/contacts/${contactId}/action-items`,
      );
      for (const item of items) {
        if (item.title === "Virginia catch up") {
          await instance.api("DELETE", `/action-items/${item.id}`);
        }
      }
    }
  });

  test("Tab to a pin shows hover card, Space pins it focusing first button, Escape returns focus", async ({
    page,
  }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    const adaPin = map.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    await expect(adaPin).toBeVisible();

    // Focus the pin (simulating Tab navigation)
    await adaPin.focus();

    // Hover card appears in tooltip mode (no action buttons)
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(tooltip.getByText("Ada Lovelace")).toBeVisible();
    await expect(
      tooltip.getByRole("button", { name: "Open contact" }),
    ).toHaveCount(0);

    // Press Space to pin the card
    await page.keyboard.press("Space");

    // Card enters pinned dialog mode
    const dialog = page.getByRole("dialog", { name: "Ada Lovelace" });
    await expect(dialog).toBeVisible();

    // Focus automatically lands on the first button ("Open contact")
    const openBtn = dialog.getByRole("button", { name: "Open contact" });
    await expect(openBtn).toBeVisible();
    await expect(openBtn).toBeFocused();

    // Press Escape to close the card
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Ada Lovelace" }),
    ).toHaveCount(0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // Focus returns to the pin
    await expect(adaPin).toBeFocused();
  });

  test("is accessible with card pinned and follow-up modal open", async ({
    page,
  }, testInfo) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    const adaPin = map.getByRole("button", {
      name: "Ada Lovelace, Babbage & Co",
    });
    await expect(adaPin).toBeVisible();
    await adaPin.focus();
    await page.keyboard.press("Space");

    const dialog = page.getByRole("dialog", { name: "Ada Lovelace" });
    await expect(dialog).toBeVisible();

    // Check accessibility with card pinned
    await expectPageAccessible(page, testInfo, "map-hover-card-pinned");

    // Open follow-up modal from hover card
    await dialog.getByRole("button", { name: "Add follow-up" }).click();
    const modal = page.getByRole("dialog", { name: "Add Follow-up" });
    await expect(modal).toBeVisible();

    // Check accessibility with follow-up modal open
    await expectPageAccessible(page, testInfo, "map-followup-modal");
  });

  test("layer Health shows the legend and ?layer=health reloads with it on", async ({
    page,
  }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Health legend is not visible initially
    await expect(
      page.getByRole("group", { name: "Health legend" }),
    ).toHaveCount(0);

    // Switch to Health layer
    const healthRadio = page.getByRole("radio", { name: "Health" });
    await expect(healthRadio).toBeVisible();
    await healthRadio.click();

    // Health legend is now visible
    const legend = page.getByRole("group", { name: "Health legend" });
    await expect(legend).toBeVisible();
    await expect(legend.getByText("Strong")).toBeVisible();
    await expect(legend.getByText("Fading")).toBeVisible();
    await expect(legend.getByText("At risk")).toBeVisible();

    // URL contains ?layer=health
    await expect(page).toHaveURL(/layer=health/);

    // Reloading preserves the health layer and legend
    await page.reload();
    await expect(map).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Health legend" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/layer=health/);

    // Switch back to Pins
    const pinsRadio = page.getByRole("radio", { name: "Pins" });
    await expect(pinsRadio).toBeVisible();
    await pinsRadio.click();
    await expect(
      page.getByRole("group", { name: "Health legend" }),
    ).toHaveCount(0);
    await expect(page).not.toHaveURL(/layer=/);
  });

  test("saves a view named Virginia, reloads, and choosing it restores filter and updates URL", async ({
    page,
  }) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Type a filter
    const filterInput = page.getByRole("textbox", { name: "Filter contacts" });
    await filterInput.fill("Virginia");

    // Open Views menu and click Save current view
    await page.getByRole("button", { name: "Saved views" }).click();
    const saveMenuItem = page.getByRole("menuitem", {
      name: "Save current view…",
    });
    await expect(saveMenuItem).toBeVisible();
    await saveMenuItem.click();

    // Fill view name in the dialog and submit
    const saveModal = page.getByRole("dialog", { name: "Save current view" });
    await expect(saveModal).toBeVisible();
    await saveModal.getByLabel("View name").fill("Virginia");
    await saveModal.getByRole("button", { name: "Save view" }).click();

    // Modal closes
    await expect(saveModal).toHaveCount(0);

    // Reload /map fresh
    await page.goto("/map");
    await expect(map).toBeVisible();
    await expect(filterInput).toHaveValue("");

    // Open Saved views menu and select Virginia
    await page.getByRole("button", { name: "Saved views" }).click();
    // Exact: "Rename Virginia" and "Delete Virginia" are items too.
    const virginiaItem = page.getByRole("menuitem", {
      name: "Virginia",
      exact: true,
    });
    await expect(virginiaItem).toBeVisible();
    await virginiaItem.click();

    // URL now contains ?view= and filter input shows the saved query
    await expect(page).toHaveURL(/[?&]view=/);
    await expect(filterInput).toHaveValue("Virginia");
  });

  test("is accessible with views menu open and save view modal open", async ({
    page,
  }, testInfo) => {
    await page.goto("/map");
    const map = page.getByRole("region", { name: "Contact map" });
    await expect(map).toBeVisible();

    // Open Saved views menu and check accessibility
    await page.getByRole("button", { name: "Saved views" }).click();
    const menu = page.getByRole("menu", { name: "Saved views" });
    await expect(menu).toBeVisible();
    await expectPageAccessible(page, testInfo, "map-views-menu");

    // Open Save view modal and check accessibility
    await page.getByRole("menuitem", { name: "Save current view…" }).click();
    const modal = page.getByRole("dialog", { name: "Save current view" });
    await expect(modal).toBeVisible();
    await expectPageAccessible(page, testInfo, "map-save-view-modal");
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
