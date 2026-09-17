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
 * - Phone view opens history pane as a mobile bottom sheet.
 * - Accessibility scans on open desktop, closed desktop, and notes mode.
 */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { answerPeopleSearch, personMatch } from "./fixtures/search";
import { expectPageAccessible } from "./fixtures/a11y";

const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

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
    const toggleButton = page.getByRole("button", { name: "Search history" });
    await toggleButton.click();
    await expect(historyPane).toBeHidden();

    // Accessibility check with pane closed
    await expectPageAccessible(page, testInfo, "ask-history-desktop-closed");

    // Notes mode accessibility check
    await page.goto("/search?mode=notes");
    await expect(
      page
        .getByRole("radiogroup", { name: "What to search" })
        .getByRole("radio", { name: "Notes" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("Find what was said, and when")).toBeVisible();
    await expectPageAccessible(page, testInfo, "ask-history-notes");
  });
});

test.describe("phone", () => {
  test.use({ ...PHONE });

  test("the pane opens as a mobile bottom sheet from the header clock button", async ({
    page,
    seed,
  }) => {
    const ada = personMatch(seed.byName("Ada Lovelace"));
    await answerPeopleSearch(page, [ada]);

    await page.goto("/search");

    // On phone, desktop aside is hidden
    const desktopAside = page.locator("aside[aria-label='Search history']");
    await expect(desktopAside).toBeHidden();

    // Clock button opens mobile sheet
    const clockButton = page.getByRole("button", { name: "Search history" });
    await expect(clockButton).toBeVisible();
    await clockButton.click();

    // The pane appears inside a Modal bottom sheet
    const sheet = page.getByRole("dialog", { name: "Search history" });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText("Your questions will appear here"),
    ).toBeVisible();

    // Escape closes the sheet and restores focus to Clock button
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(clockButton).toBeFocused();
  });
});
