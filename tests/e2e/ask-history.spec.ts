/**
 * Ask Contrack history pane — Prompt 2 of 3 (the pane).
 *
 * Exercises the history pane journeys:
 * - Asking questions records history entries in Today with newest first.
 * - Clicking an entry re-runs the search with that query.
 * - Pinning keeps entries in Pinned across reloads.
 * - Deleting triggers undo toast, and Undo restores the entry.
 * - Filtering narrows the visible list.
 * - Clearing all removes entries through ConfirmDialog.
 * - The pane closes from the header toggle and from its own "Hide history"
 *   button, and the header toggle opens it again.
 * - Phone view opens history pane as a mobile bottom sheet.
 * - Accessibility scans on open desktop, closed desktop, and notes mode.
 */
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { answerPeopleSearch, personMatch } from "./fixtures/search";
import { expectPageAccessible } from "./fixtures/a11y";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

/**
 * The page header's history toggle. Its name is "History" in both states,
 * and it is pressed while the pane is open. `exact` keeps it apart from the
 * pane's own "Hide history" button.
 */
const hideToggle = (page: Page) =>
  page.getByRole("button", { name: "History", exact: true, pressed: true });
const showToggle = (page: Page) =>
  page.getByRole("button", { name: "History", exact: true, pressed: false });

test.describe("desktop", () => {
  test("records questions, pins, deletes with undo, filters, and clears history", async ({
    page,
    seed,
  }, testInfo) => {
    const ada = personMatch(seed.byName("Ada Lovelace"));
    const grace = personMatch(seed.byName("Grace Hopper"));
    await answerPeopleSearch(page, [ada, grace]);

    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });

    const historyPane = page.getByRole("complementary", {
      name: "Search history",
    });
    await expect(historyPane).toBeVisible();

    // Ask first question
    await input.fill("who knows quantum physics");
    await input.press("Enter");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Verify first question appears in Today group
    const todayHeading = historyPane.getByRole("heading", { name: "Today" });
    await expect(todayHeading).toBeVisible();
    const firstRow = historyPane.getByRole("button", {
      name: "Run again: who knows quantum physics",
    });
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toHaveAttribute("aria-current", "true");

    // Delay to ensure timestamp resolution difference in SQLite
    await page.waitForTimeout(1100);

    // Ask second question
    await input.fill("who writes rust code");
    await input.press("Enter");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Expect both in Today with newest first, second one marked current
    const secondRow = historyPane.getByRole("button", {
      name: "Run again: who writes rust code",
    });
    await expect(secondRow).toBeVisible();
    await expect(secondRow).toHaveAttribute("aria-current", "true");
    await expect(firstRow).not.toHaveAttribute("aria-current", "true");

    // Ordering: secondRow before firstRow in DOM
    const runButtons = historyPane.locator("button[aria-label^='Run again:']");
    await expect(runButtons.first()).toHaveAttribute(
      "aria-label",
      "Run again: who writes rust code",
    );

    // Accessibility check with pane open
    await expectPageAccessible(page, testInfo, "ask-history-desktop-open");

    // Click older entry, expect input to change and search to rerun
    await page.waitForTimeout(1100);
    await firstRow.click();
    await expect(input).toHaveValue("who knows quantum physics");
    await expect(firstRow).toHaveAttribute("aria-current", "true");

    // Pin older entry
    const quantumItem = historyPane
      .getByRole("listitem")
      .filter({ hasText: "who knows quantum physics" });
    await quantumItem.hover();
    await quantumItem.getByRole("button", { name: "Pin question" }).click();

    // Reload page, expect it under Pinned
    await page.reload();
    await expect(
      historyPane.getByRole("heading", { name: "Pinned" }),
    ).toBeVisible();
    const pinnedRow = historyPane.getByRole("button", {
      name: "Run again: who knows quantum physics",
    });
    await expect(pinnedRow).toBeVisible();

    // Delete it: hover and click Delete question
    const pinnedItem = historyPane
      .getByRole("listitem")
      .filter({ hasText: "who knows quantum physics" });
    await pinnedItem.hover();
    await pinnedItem.getByRole("button", { name: "Delete question" }).click();

    // Expect undo toast, then click Undo
    await expect(page.getByText("Question deleted")).toBeVisible();
    const undoButton = page.getByRole("button", { name: "Undo" });
    await expect(undoButton).toBeVisible();
    await undoButton.click();

    // Expect it restored back
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who knows quantum physics",
      }),
    ).toBeVisible();

    // Filter by word: "rust"
    const filterInput = historyPane.getByRole("textbox", {
      name: "Filter history",
    });
    await filterInput.fill("rust");
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who writes rust code",
      }),
    ).toBeVisible();
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who knows quantum physics",
      }),
    ).toBeHidden();

    // Clear filter
    await filterInput.fill("");
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who knows quantum physics",
      }),
    ).toBeVisible();

    // Clear all history through dialog
    const clearButton = historyPane.getByRole("button", { name: "Clear" });
    await clearButton.click();
    const confirmDialog = page.getByRole("dialog", {
      name: "Clear search history",
    });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete all" }).click();
    await expect(confirmDialog).toBeHidden();

    // Empty state
    await expect(
      historyPane.getByText("Your questions will appear here"),
    ).toBeVisible();

    // Toggle pane closed via header button
    await hideToggle(page).click();
    await expect(historyPane).toBeHidden();

    // The same button opens it again
    await showToggle(page).click();
    await expect(historyPane).toBeVisible();

    // The pane closes from its own header too, and the keyboard lands on the
    // header toggle, which is still on the page
    const paneHide = historyPane.getByRole("button", { name: "Hide history" });
    await expect(paneHide).toHaveAttribute("title", /^Hide history/);
    await paneHide.click();
    await expect(historyPane).toBeHidden();
    await expect(showToggle(page)).toBeFocused();

    // Accessibility check with pane closed
    await expectPageAccessible(page, testInfo, "ask-history-desktop-closed");

    // Notes mode accessibility check. The header is the title and its two
    // controls, with no line of description under it.
    await page.goto("/search?mode=notes");
    await expect(
      page
        .getByRole("radiogroup", { name: "What to search" })
        .getByRole("radio", { name: "Notes" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("textbox", { name: "Search your notes" }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "ask-history-notes");

    // The pane's open state is an account preference on the worker's shared
    // instance. Put it back, so the next journey finds the pane it expects.
    await page.goto("/search");
    await showToggle(page).click();
    await expect(hideToggle(page)).toBeVisible();
    await expect(historyPane).toBeVisible();
  });

  test("palette and Ask Contrack pane share unified search history", async ({
    page,
    seed,
  }, testInfo) => {
    const ada = personMatch(seed.byName("Ada Lovelace"));
    await answerPeopleSearch(page, [ada]);

    // 1. Ask a question on the /search page, with the history pane open.
    // Its open state is an account preference, so another journey on the
    // same instance may have closed it.
    await page.goto("/search");
    await expect(hideToggle(page).or(showToggle(page))).toBeVisible();
    if (await showToggle(page).isVisible()) {
      await showToggle(page).click();
    }
    await expect(hideToggle(page)).toBeVisible();
    const searchInput = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await searchInput.fill("who knows python");
    await searchInput.press("Enter");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Verify it appears in Today in the history pane
    const historyPane = page.getByRole("complementary", {
      name: "Search history",
    });
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who knows python",
      }),
    ).toBeVisible();

    // 2. Open command palette and verify page question appears in Recent searches
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette).toHaveAttribute("data-state", "open");
    await expect(palette.getByText("Recent searches")).toBeVisible();
    await expect(palette.getByText("who knows python")).toBeVisible();

    // 3. Ask a ? question in the palette
    const paletteInput = palette.getByRole("combobox");
    await page.waitForTimeout(1100);
    await paletteInput.fill("? who understands compilers");
    // Wait for AI results to settle in palette and call addEntry
    await expect(palette.getByText("Ada Lovelace")).toBeVisible();
    await page.waitForTimeout(600);

    // Close palette
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // 4. Verify ? question from palette appears in the Ask Contrack history pane
    await page.goto("/search");
    await expect(
      historyPane.getByRole("button", {
        name: "Run again: who understands compilers",
      }),
    ).toBeVisible();

    // 5. Navigate to Privacy and AI page in Settings
    await page.goto("/settings/privacy");
    await expect(
      page.getByRole("heading", { name: "Search history" }),
    ).toBeVisible();
    await expect(page.getByText("2 questions")).toBeVisible();

    // Scan accessibility of the Privacy page
    await expectPageAccessible(page, testInfo, "settings-privacy");

    // 6. Clear history from Privacy page
    await page.getByRole("button", { name: "Clear history" }).click();
    const confirmDialog = page.getByRole("dialog", {
      name: "Clear search history",
    });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: "Delete all" }).click();
    await expect(confirmDialog).toBeHidden();
    await expect(page.getByText("0 questions")).toBeVisible();

    // 7. Verify /search history pane is now empty
    await page.goto("/search");
    await expect(
      historyPane.getByText("Your questions will appear here"),
    ).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ ...PHONE });

  test("the pane opens as a mobile bottom sheet from the header history button", async ({
    page,
    seed,
  }) => {
    const ada = personMatch(seed.byName("Ada Lovelace"));
    await answerPeopleSearch(page, [ada]);

    await page.goto("/search");

    // On phone, desktop aside is hidden
    const desktopAside = page.locator("aside[aria-label='Search history']");
    await expect(desktopAside).toBeHidden();

    // The history button opens the mobile sheet
    const historyButton = page.getByRole("button", {
      name: "History",
      exact: true,
    });
    await expect(historyButton).toBeVisible();
    await expect(historyButton).toHaveAttribute("aria-haspopup", "dialog");
    await historyButton.click();

    // The pane appears inside a Modal bottom sheet. The sheet closes from a
    // visible X in the pane's header, not from the side pane's "Hide
    // history" button, and nothing sits over the header's Clear
    const sheet = page.getByRole("dialog", { name: "Search history" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText("Your questions will appear here"),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Hide history" }),
    ).toHaveCount(0);
    await expect(sheet).toBeFocused();

    // Escape closes the sheet and restores focus to the history button
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(historyButton).toBeFocused();

    // So does the X
    await historyButton.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close history" }).click();
    await expect(sheet).toBeHidden();
    await expect(historyButton).toBeFocused();
  });
});
