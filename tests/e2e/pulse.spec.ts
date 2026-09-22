/**
 * Pulse Office — Playwright e2e spec.
 *
 * Walks the Pulse view, Up next keyboard navigation (J/K/D),
 * duplicate queue redirection, and accessibility.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import type { ContrackInstance } from "./fixtures/instance";

/**
 * The follow-ups these tests create, so they can be taken away again.
 *
 * The instance is shared by every spec in the worker, and "Up next" is a
 * list of whatever is open on it. A test that leaves its own items behind
 * changes what the next test sees: the second one here reads the item at
 * index 1, which is only "Task Two Today" when nothing else is queued.
 */
const created: string[] = [];

/** Add a follow-up and remember it for the cleanup. */
async function addActionItem(
  instance: ContrackInstance,
  contactId: string,
  title: string,
  dueAt: Date,
): Promise<{ id: string }> {
  const item = await instance.api<{ id: string }>(
    "POST",
    `/contacts/${contactId}/action-items`,
    { title, dueAt: dueAt.toISOString() },
  );
  created.push(item.id);
  return item;
}

test.afterEach(async ({ instance }) => {
  const ids = created.splice(0);
  for (const id of ids) {
    // Already completed or already gone is the same outcome as deleted.
    await instance.api("DELETE", `/action-items/${id}`).catch(() => {});
  }
});

test.describe("Pulse Office", () => {
  test("shows Pulse heading, Today strip, and Up next with seeded overdue item first", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");

    // Seed an overdue item and a today item
    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - 3);

    const todayDate = new Date();

    await addActionItem(
      instance,
      ada.id,
      "Send Apollo blueprints",
      overdueDate,
    );
    await addActionItem(instance, grace.id, "Review compiler draft", todayDate);

    await page.goto("/pulse");

    // Header assertions
    await expect(
      page.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();
    await expect(page.getByLabel("Today summary")).toBeVisible();

    // Up next card and items
    const upNextCard = page.locator('[data-card-id="up-next"]');
    await expect(upNextCard).toBeVisible();
    await expect(upNextCard.getByText("Send Apollo blueprints")).toBeVisible();
    await expect(upNextCard.getByText("Review compiler draft")).toBeVisible();

    // First item is overdue
    const firstItem = page.getByRole("listitem").first();
    await expect(firstItem).toContainText("Send Apollo blueprints");
    await expect(firstItem).toHaveAttribute("aria-current", "true");
  });

  test("walks items with J and completes second item with D", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");

    const overdueDate = new Date();
    overdueDate.setDate(overdueDate.getDate() - 4);

    const todayDate = new Date();

    await addActionItem(instance, ada.id, "Task One Overdue", overdueDate);

    const item2 = await addActionItem(
      instance,
      grace.id,
      "Task Two Today",
      todayDate,
    );

    await page.goto("/pulse");
    await expect(page.getByText("Task One Overdue")).toBeVisible();
    await expect(page.getByText("Task Two Today")).toBeVisible();

    // Focus on body / page, press J to advance to item 2
    await page.keyboard.press("j");

    const items = page.getByRole("listitem");
    await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(items.nth(1)).toContainText("Task Two Today");

    // Press D to mark item 2 done
    await page.keyboard.press("d");

    // Confirm through API that item2 is completed
    await expect
      .poll(async () => {
        const completed = await instance.api<Array<{ id: string }>>(
          "GET",
          "/action-items/completed",
        );
        return completed.some((i) => i.id === item2.id);
      })
      .toBe(true);
  });

  test("inbox row for stale data navigates to / with updated:>6m in search input", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const Database = (await import("better-sqlite3")).default;
    const path = (await import("node:path")).default;
    const db = new Database(path.join(instance.dataDir, "curator.db"));
    db.prepare(
      "UPDATE contacts SET updatedAt = datetime('now', '-7 months') WHERE id = ?",
    ).run(ada.id);
    db.close();

    await page.goto("/pulse");
    const inboxCard = page.locator('[data-card-id="inbox"]');
    await expect(inboxCard).toBeVisible();
    const staleRow = inboxCard.getByText(/contact.*stale data/);
    await expect(staleRow).toBeVisible();

    await staleRow.click();
    await expect(page).toHaveURL(/\/\?q=updated/);
    const searchInput = page.getByRole("textbox", { name: /search/i });
    await expect(searchInput).toHaveValue("updated:>6m");
  });

  test("redirects /pulse?tab=suggestions and /pulse/suggestions to /pulse/duplicates", async ({
    page,
  }) => {
    // 1. Query parameter redirect
    await page.goto("/pulse?tab=suggestions");
    await expect(page).toHaveURL(/\/pulse\/duplicates/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Possible duplicates/,
    );
    const backLink = page
      .getByRole("main")
      .getByRole("link", { name: "Pulse" });
    await expect(backLink).toBeVisible();

    // Click back link to return to Pulse
    await backLink.click();
    await expect(page).toHaveURL(/\/pulse$/);

    // 2. Sub-route redirect
    await page.goto("/pulse/suggestions");
    await expect(page).toHaveURL(/\/pulse\/duplicates/);
  });

  test("legend link in composition card lands on / with the facet pill", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    await instance.api("PATCH", `/contacts/${ada.id}`, {
      industry: "Technology",
    });

    await page.goto("/pulse");
    const compositionCard = page.locator('[data-card-id="composition"]');
    await expect(compositionCard).toBeVisible();

    // Click legend link for Technology inside compositionCard
    const legendLink = compositionCard.getByRole("link", {
      name: /Technology/i,
    });
    await expect(legendLink).toBeVisible();
    const linkHref = await legendLink.getAttribute("href");
    expect(linkHref).toMatch(/^\/\?q=industry:Technology/);

    await legendLink.click();
    await expect(page).toHaveURL(/\/\?q=industry:Technology/);

    const searchInput = page.getByRole("textbox", { name: /search/i });
    await expect(searchInput).toBeVisible();
    const inputValue = await searchInput.inputValue();
    expect(inputValue).toBe("industry:Technology");
  });

  test("renders office on phone viewport and verifies heatmap horizontal scroller", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pulse");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();
    await expect(page.getByLabel("Today summary")).toBeVisible();
    await expect(page.locator('[data-card-id="up-next"]')).toBeVisible();

    // Verify heatmap sits in horizontal scroller
    const activityCard = page.locator('[data-card-id="activity"]');
    await expect(activityCard).toBeVisible();
    const scroller = activityCard.locator(".overflow-x-auto");
    await expect(scroller).toBeVisible();
  });

  test("customize mode: hides Keeping up, Done, reload keeps it hidden, Reset brings it back", async ({
    page,
  }) => {
    await page.goto("/pulse");
    await expect(page.locator('[data-card-id="keeping-up"]')).toBeVisible();

    // Click Customize button
    const customizeBtn = page.getByRole("button", { name: "Customize" });
    await expect(customizeBtn).toBeVisible();
    await customizeBtn.click();

    // Verify editing bar and hidden tray are visible
    await expect(page.getByText("Editing layout")).toBeVisible();

    // Find eye toggle button on the Keeping up card and hide it
    const hideKeepingUpBtn = page.getByRole("button", {
      name: "Hide Keeping up",
    });
    await expect(hideKeepingUpBtn).toBeVisible();
    await hideKeepingUpBtn.click();

    // Card is hidden from column, appears in hidden tray
    await expect(
      page.locator('.grid [data-card-id="keeping-up"]'),
    ).not.toBeVisible();
    const hiddenTray = page.getByTestId("hidden-cards-tray");
    await expect(hiddenTray).toBeVisible();
    await expect(hiddenTray.getByText("Keeping up")).toBeVisible();

    // Click Done
    const doneBtn = page.getByRole("button", { name: "Done", exact: true });
    await doneBtn.click();
    await expect(page.getByText("Editing layout")).not.toBeVisible();

    // Reload page, verify Keeping up is still hidden
    await page.reload();
    await expect(
      page.locator('.grid [data-card-id="keeping-up"]'),
    ).not.toBeVisible();

    // Enter customize mode again and Reset layout
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByText("Editing layout")).toBeVisible();

    const resetBtn = page.getByRole("button", { name: "Reset layout" });
    await resetBtn.click();

    // The Keeping up card is restored to its column
    await expect(page.locator('[data-card-id="keeping-up"]')).toBeVisible();

    // Click Done to finish
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Editing layout")).not.toBeVisible();
  });

  test("Catch up lists the seeded person past cadence, and Keeping up names its bar", async ({
    page,
    seed,
  }) => {
    await page.goto("/pulse");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();

    // Edsger is tracked at every 3 months and 400 days quiet: the one
    // catch-up among the four tracked people. Linus is quiet too, and not
    // tracked, so he is not here.
    const upNext = page.getByRole("list", { name: "Up next items" });
    await expect(upNext.getByText("Catch up")).toBeVisible();
    await expect(
      upNext.getByText("Check in with Edsger Dijkstra"),
    ).toBeVisible();
    await expect(upNext.getByText("10 months past due")).toBeVisible();
    await expect(
      upNext.getByRole("button", { name: "Log note for Edsger Dijkstra" }),
    ).toBeVisible();
    await expect(upNext.getByText("Check in with Linus Torvalds")).toBeHidden();
    await expect(page.getByText("Slipping")).toBeHidden();

    // The Keeping up card: the bar, the line, the four-week line, Manage.
    const card = page.locator('[data-card-id="keeping-up"]');
    await expect(
      card.getByRole("heading", { name: "Keeping up" }),
    ).toBeVisible();
    await expect(card.getByRole("img")).toHaveAccessibleName(
      /^4 tracked: \d+ strong, \d+ fading, \d+ at risk, \d+ with no interactions yet$/,
    );
    await expect(
      card.getByText(/^\d of 4 within cadence, 1 to catch up$/),
    ).toBeVisible();
    await expect(
      card.getByText("Rising and cooling show after four weeks of tracking."),
    ).toBeVisible();
    await expect(card.getByText("4 tracked in the last 30 days")).toBeVisible();
    const manage = card.getByRole("link", { name: "Manage" });
    await expect(manage).toHaveAttribute("href", "/tracked");

    // A legend link lands on its group on the Tracked contacts page.
    await card.getByRole("link", { name: /At risk$/ }).click();
    await expect(page).toHaveURL(/\/tracked#at-risk$/);
    await expect(
      page.getByRole("heading", { level: 2, name: /^At risk/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Edsger Dijkstra" }),
    ).toBeVisible();
    void seed;
  });

  test("customize mode: reorders cards via keyboard", async ({ page }) => {
    await page.goto("/pulse");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();

    // Toggle customize via 'c' key
    await page.keyboard.press("c");
    await expect(page.getByText("Editing layout")).toBeVisible();

    // Focus drag handle on the Keeping up card
    const keepingUpCard = page.locator('[data-card-id="keeping-up"]');
    const handle = keepingUpCard.getByRole("button", {
      name: /drag.*reorder/i,
    });
    await expect(handle).toBeVisible();
    await handle.focus();

    // Move using KeyboardSensor (Space to pick up, Arrow to move, Space to drop)
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    // Done
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Editing layout")).not.toBeVisible();
  });

  test("customize mode on phone offers Move up and Move down", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pulse");

    // Click customize
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByText("Editing layout")).toBeVisible();

    // The Activity card sits second in the Network column, under Keeping
    // up, so it has a Move up that does something.
    const activityCard = page.locator('[data-card-id="activity"]');
    await expect(activityCard).toBeVisible();

    const moveUpBtn = activityCard.getByRole("button", {
      name: "Move Activity up",
    });
    const moveDownBtn = activityCard.getByRole("button", {
      name: "Move Activity down",
    });

    await expect(moveUpBtn).toBeVisible();
    await expect(moveDownBtn).toBeVisible();

    // Click Move Activity up
    await moveUpBtn.click();

    // Now Activity is first in its column, so Move up should be disabled
    await expect(moveUpBtn).toBeDisabled();

    // Done
    await page.getByRole("button", { name: "Done", exact: true }).click();
  });

  test("page passes automated accessibility scans in light, dark, and customize mode", async ({
    page,
  }, testInfo) => {
    await page.goto("/pulse");
    await expect(
      page.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();
    await expectPageAccessible(page, testInfo, "pulse-light");

    // Dark mode
    await page.emulateMedia({ colorScheme: "dark" });
    await expectPageAccessible(page, testInfo, "pulse-dark");

    // Customize mode accessible scan
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByText("Editing layout")).toBeVisible();
    await expectPageAccessible(page, testInfo, "pulse-customize");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.goto("/pulse/duplicates");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectPageAccessible(page, testInfo, "pulse-duplicates");
  });
});
