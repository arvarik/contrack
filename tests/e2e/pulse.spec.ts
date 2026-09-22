/**
 * Pulse Office — Playwright e2e spec.
 *
 * Walks the Pulse view, the masthead, Up next keyboard navigation (J/K/D,
 * the arrows and Enter on a focused row), the Enter guard on other controls,
 * duplicate queue redirection, customize mode, the phone, and accessibility.
 */
import { devices } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import type { ContrackInstance } from "./fixtures/instance";
import type { Page } from "@playwright/test";

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

/** A date `days` from now, at the current time of day. */
function daysFromNow(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Customize lives in the More menu of the masthead. Open it and choose the
 * item. The `c` key still toggles it, and one test uses that instead.
 */
async function openCustomize(page: Page) {
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Customize layout" }).click();
  await expect(page.getByText("Editing layout")).toBeVisible();
}

test.afterEach(async ({ instance }) => {
  const ids = created.splice(0);
  for (const id of ids) {
    // Already completed or already gone is the same outcome as deleted.
    await instance.api("DELETE", `/action-items/${id}`).catch(() => {});
  }
});

test.describe("Pulse Office", () => {
  test("shows Pulse heading, the masthead, and Up next with seeded overdue item first", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");

    // Seed an overdue item and a today item
    await addActionItem(
      instance,
      ada.id,
      "Send Apollo blueprints",
      daysFromNow(-3),
    );
    await addActionItem(
      instance,
      grace.id,
      "Review compiler draft",
      new Date(),
    );

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

    await addActionItem(instance, ada.id, "Task One Overdue", daysFromNow(-4));

    const item2 = await addActionItem(
      instance,
      grace.id,
      "Task Two Today",
      new Date(),
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

  test("Enter on a focused control activates it and never opens the highlighted contact", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    await addActionItem(instance, ada.id, "Enter guard item", daysFromNow(-2));

    await page.goto("/pulse");
    // A highlighted row exists, so the old window handler would have fired.
    await expect(page.getByRole("listitem").first()).toHaveAttribute(
      "aria-current",
      "true",
    );

    // A button: Enter opens the menu and the URL stays put.
    const more = page.getByRole("button", { name: "More" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "Customize layout" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/pulse$/);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: "Customize layout" }),
    ).toBeHidden();
    await expect(page).toHaveURL(/\/pulse$/);

    // A link: Enter follows the link, not the highlighted row.
    const manage = page
      .locator('[data-card-id="keeping-up"]')
      .getByRole("link", { name: "Manage" });
    await manage.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tracked$/);
  });

  test("the masthead reads the day: one sentence names each count, and a count jumps to its card", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");
    const margaret = seed.byName("Margaret Hamilton");

    await addActionItem(instance, ada.id, "Masthead overdue", daysFromNow(-1));
    await addActionItem(instance, grace.id, "Masthead today", new Date());
    // The seed has no birthdays. One in three days puts a count in the
    // sentence, and a birthday is harmless to the other specs, so it stays.
    const soon = daysFromNow(3);
    const mm = String(soon.getMonth() + 1).padStart(2, "0");
    const dd = String(soon.getDate()).padStart(2, "0");
    await instance.api("PATCH", `/contacts/${margaret.id}`, {
      birthday: `1992-${mm}-${dd}`,
    });

    await page.goto("/pulse");
    const masthead = page.getByLabel("Today summary");
    await expect(
      masthead.getByRole("heading", { level: 1, name: "Pulse" }),
    ).toBeVisible();

    // The date is the display line and the largest text on the page.
    const dateSize = await masthead
      .locator("p")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(dateSize).toBe(32);
    const largest = await page.evaluate(() => {
      let max = 0;
      for (const el of Array.from(document.body.querySelectorAll("*"))) {
        if (!el.textContent?.trim()) continue;
        if (el.children.length > 0 && !el.childNodes.length) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size > max) max = size;
      }
      return max;
    });
    expect(largest).toBe(32);

    await expect(masthead).toContainText(
      "1 overdue, 1 due today, 1 birthday this week.",
    );
    // Other specs in the worker may have completed a follow-up today.
    await expect(masthead.getByRole("img")).toHaveAccessibleName(
      /^(2 to do|\d+ of \d+ done)$/,
    );

    // Each count is a button that jumps to its card.
    await masthead
      .getByRole("button", { name: "1 birthday this week" })
      .click();
    await expect(page.locator('[data-card-id="coming-up"]')).toBeInViewport();
    await masthead.getByRole("button", { name: "1 overdue" }).click();
    await expect(page.locator('[data-card-id="up-next"]')).toBeInViewport();
    await masthead.getByRole("button", { name: "1 due today" }).click();
    await expect(page.locator('[data-card-id="up-next"]')).toBeInViewport();
    await expect(page).toHaveURL(/\/pulse$/);
  });

  test("rows take the keyboard: Tab reaches the highlighted row, the arrows move it, Enter opens the contact", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");
    await addActionItem(instance, ada.id, "Keyboard row one", daysFromNow(-5));
    await addActionItem(instance, grace.id, "Keyboard row two", new Date());

    await page.goto("/pulse");
    const rows = page.getByRole("listitem");
    await expect(rows.first()).toContainText("Keyboard row one");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");

    // The highlighted row is the list's one tab stop. The control before
    // it in the page is the Keyboard tip in the card's header.
    await page.getByRole("button", { name: "Keyboard", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(rows.first()).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    await expect(rows.nth(1)).toBeFocused();
    await expect(rows.nth(1)).toContainText("Keyboard row two");
    await expect(rows.first()).not.toHaveAttribute("aria-current", "true");

    await page.keyboard.press("ArrowUp");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect(rows.first()).toBeFocused();

    // J from a focused row keeps focus on the rows too.
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/contact/${grace.id}$`));
  });

  test("the queue scrolls inside its card at 1440, and the group heading stays put", async ({
    page,
    instance,
    seed,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const people = [
      seed.byName("Ada Lovelace"),
      seed.byName("Grace Hopper"),
      seed.byName("Katherine Johnson"),
    ];
    // Twelve rows: six overdue, three today, three this week.
    for (let i = 0; i < 12; i++) {
      const person = people[i % 3];
      const offset = i < 6 ? -(i + 2) : i < 9 ? 0 : i - 6;
      await addActionItem(
        instance,
        person.id,
        `Pane row ${i + 1}`,
        daysFromNow(offset),
      );
    }

    await page.goto("/pulse");
    const list = page.getByRole("group", { name: "Up next items" });
    await expect(list.getByText("Pane row 12")).toBeAttached();
    const shape = await list.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(shape.overflowY).toBe("auto");
    expect(shape.scrollHeight).toBeGreaterThan(shape.clientHeight);

    // The pane scrolls, the page does not grow with it, and Overdue sticks.
    const pageScroller = page.locator("main .overflow-y-auto").first();
    const pageHeightBefore = await pageScroller.evaluate(
      (el) => el.scrollHeight,
    );
    await list.evaluate((el) => el.scrollBy(0, 400));
    const overdue = list.getByRole("heading", { level: 3, name: /^Overdue/ });
    await expect(overdue).toBeInViewport();
    const [headingTop, listTop] = await Promise.all([
      overdue.evaluate((el) => el.getBoundingClientRect().top),
      list.evaluate((el) => el.getBoundingClientRect().top),
    ]);
    expect(Math.abs(headingTop - listTop)).toBeLessThan(2);
    expect(await pageScroller.evaluate((el) => el.scrollHeight)).toBe(
      pageHeightBefore,
    );
  });

  test("a click on a row opens the contact, and the Completed line shows and expands", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const grace = seed.byName("Grace Hopper");
    await addActionItem(instance, ada.id, "Row click item", daysFromNow(-2));
    const done = await addActionItem(
      instance,
      grace.id,
      "Already done item",
      daysFromNow(-1),
    );
    await instance.api("PATCH", `/action-items/${done.id}/complete`);

    await page.goto("/pulse");

    // Completed is one line with a count and a Show.
    const completed = page.locator('[data-card-id="completed"]');
    await expect(completed).toContainText(/\d+ completed recently/);
    await expect(completed.getByRole("heading", { level: 2 })).toHaveText(
      /^Completed/,
    );
    const show = completed.getByRole("button", { name: "Show" });
    await expect(show).toHaveAttribute("aria-expanded", "false");
    await show.click();
    const list = page.getByRole("list", { name: "Completed follow-ups" });
    await expect(list.getByText("Already done item")).toBeVisible();
    await expect(
      list.getByRole("link", { name: "Grace Hopper" }),
    ).toHaveAttribute("href", `/contact/${grace.id}`);
    await completed.getByRole("button", { name: "Hide" }).click();
    await expect(list).toHaveCount(0);

    // A click on the row's title, not on a control, opens the contact.
    const row = page
      .getByRole("listitem")
      .filter({ hasText: "Row click item" });
    await row.getByText("Row click item").click();
    await expect(page).toHaveURL(new RegExp(`/contact/${ada.id}$`));
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

    // Customize from the More menu
    await openCustomize(page);

    // The tray waits for a hidden card.
    await expect(page.getByTestId("hidden-cards-tray")).toHaveCount(0);

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
    await openCustomize(page);

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
    const upNext = page.getByRole("group", { name: "Up next items" });
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
    await expect(page.locator('[data-card-id="keeping-up"]')).toBeVisible();

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

    // Move using KeyboardSensor (Space to pick up, Arrow to move, Space to
    // drop). The sensor arms its key listener in a timer queued by the Space
    // keydown, so an arrow pressed in the same few milliseconds scrolls the
    // page instead and the drop lands on the card itself. A timer queued
    // after the sensor's runs after it, and the move is announced before
    // the drop, so the journey waits for both.
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByText(
        "Draggable item keeping-up was moved over droppable area activity.",
      ),
    ).toBeAttached();
    await page.keyboard.press("Space");

    // Keeping up moved down one place: Activity is now first in Network.
    // The order arrives with the preference round trip, so poll for it.
    const networkOrder = () =>
      page
        .locator(".grid [data-card-id]")
        .evaluateAll((cards) =>
          cards
            .map((c) => c.getAttribute("data-card-id"))
            .filter((id) =>
              ["keeping-up", "activity", "composition"].includes(id ?? ""),
            ),
        );
    await expect
      .poll(networkOrder)
      .toEqual(["activity", "keeping-up", "composition"]);

    // Put it back, then Done
    await page.getByRole("button", { name: "Reset layout" }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Editing layout")).not.toBeVisible();
  });

  test("customize mode on phone offers Move up and Move down", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pulse");

    await openCustomize(page);

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

    // Put it back, then Done
    await page.getByRole("button", { name: "Reset layout" }).click();
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
    await openCustomize(page);
    await expectPageAccessible(page, testInfo, "pulse-customize");
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.goto("/pulse/duplicates");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectPageAccessible(page, testInfo, "pulse-duplicates");
  });
});

/**
 * The same page on a phone. `defaultBrowserType` is stripped because a device
 * that names an engine fails inside a `describe`.
 */
const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

test.describe("Pulse on a phone", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("nothing scrolls sideways, the masthead is lean, the counts are text, and the tray waits for a hidden card", async ({
    page,
  }, testInfo) => {
    await page.goto("/pulse");
    const masthead = page.getByLabel("Today summary");
    await expect(masthead).toBeVisible();
    const firstCard = page.locator(".grid [data-card-id]").first();
    await expect(firstCard).toBeVisible();

    // Nothing on the page scrolls sideways.
    const page_ = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(page_.scrollWidth).toBe(page_.innerWidth);
    const headerOverflow = await masthead.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(headerOverflow).toBe(0);

    // The masthead stays under 180 px before the first card.
    const distance = await page.evaluate(() => {
      const header = document.querySelector(
        'header[aria-label="Today summary"]',
      );
      const card = document.querySelector(".grid [data-card-id]");
      if (!header || !card) return Number.NaN;
      return (
        card.getBoundingClientRect().top - header.getBoundingClientRect().top
      );
    });
    expect(distance).toBeLessThan(180);

    // The date is 24 px on a phone, and the sentence is plain text.
    const dateSize = await masthead
      .locator("p")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(dateSize).toBe(24);
    await expect(masthead.locator("p").getByRole("button")).toHaveCount(0);
    await expect(
      masthead.getByRole("button", { name: "Log a note" }),
    ).toBeVisible();
    await expect(masthead.getByRole("button", { name: "More" })).toBeVisible();

    await expectPageAccessible(page, testInfo, "pulse-phone");

    // Customize mode shows no tray until a card is hidden.
    await openCustomize(page);
    await expect(page.getByTestId("hidden-cards-tray")).toHaveCount(0);
    await expect(
      page.getByText("Use the arrows to move a card and the eye to hide one."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Hide Keeping up" }).click();
    await expect(page.getByTestId("hidden-cards-tray")).toBeVisible();

    // Put the layout back so the shared instance is left as it was found.
    await page.getByRole("button", { name: "Reset layout" }).click();
    await expect(page.getByTestId("hidden-cards-tray")).toHaveCount(0);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Editing layout")).toBeHidden();
  });

  test("rows keep their words, snooze is a 44 px target at rest, a birthday row has none, and a tap opens the contact", async ({
    page,
    instance,
    seed,
  }) => {
    const ada = seed.byName("Ada Lovelace");
    const margaret = seed.byName("Margaret Hamilton");
    await addActionItem(instance, ada.id, "Phone tap item", daysFromNow(-3));
    const soon = daysFromNow(2);
    const mm = String(soon.getMonth() + 1).padStart(2, "0");
    const dd = String(soon.getDate()).padStart(2, "0");
    await instance.api("PATCH", `/contacts/${margaret.id}`, {
      birthday: `1992-${mm}-${dd}`,
    });

    await page.goto("/pulse");
    const list = page.getByRole("group", { name: "Up next items" });

    // The pane has no cap on a phone.
    expect(await list.evaluate((el) => getComputedStyle(el).overflowY)).toBe(
      "visible",
    );

    // A name is never cut. Edsger is the seeded catch-up.
    const edsger = list.getByRole("link", { name: "Edsger Dijkstra" });
    await expect(edsger).toBeVisible();
    const clipped = await edsger.evaluate(
      (el) => el.scrollWidth > el.clientWidth + 1,
    );
    expect(clipped).toBe(false);

    // Snooze sits in the flow on a follow-up row, visible at rest, with the
    // 44 px tap box hit-area draws (the same box the metrics fixture reads).
    const followUp = page
      .getByRole("listitem")
      .filter({ hasText: "Phone tap item" });
    const snooze = followUp.getByRole("button", { name: "Snooze item" });
    await expect(snooze).toBeVisible();
    const hit = await snooze.evaluate((el) => {
      const own = el.getBoundingClientRect();
      const after = getComputedStyle(el, "::after");
      return {
        width: Math.max(own.width, parseFloat(after.width) || 0),
        height: Math.max(own.height, parseFloat(after.height) || 0),
        opacity: getComputedStyle(el.parentElement as Element).opacity,
      };
    });
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.opacity).toBe("1");

    // A birthday row has no button at its right edge, only the wish.
    const birthdayRow = page
      .getByRole("listitem")
      .filter({ hasText: "Wish Margaret Hamilton a happy birthday" });
    await expect(birthdayRow).toBeVisible();
    await expect(
      birthdayRow.getByRole("button", { name: "Snooze item" }),
    ).toHaveCount(0);
    await expect(birthdayRow.getByRole("button")).toHaveCount(1);

    // A tap on the row opens the contact.
    await followUp.getByText("Phone tap item").tap();
    await expect(page).toHaveURL(new RegExp(`/contact/${ada.id}$`));
  });
});
