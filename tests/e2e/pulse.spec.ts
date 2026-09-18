/**
 * Pulse Office — Playwright e2e spec.
 *
 * Walks the Pulse view, Up next keyboard navigation (J/K/D),
 * duplicate queue redirection, and accessibility.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";

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

    await instance.api("POST", `/contacts/${ada.id}/action-items`, {
      title: "Send Apollo blueprints",
      dueAt: overdueDate.toISOString(),
    });

    await instance.api("POST", `/contacts/${grace.id}/action-items`, {
      title: "Review compiler draft",
      dueAt: todayDate.toISOString(),
    });

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

    await instance.api("POST", `/contacts/${ada.id}/action-items`, {
      title: "Task One Overdue",
      dueAt: overdueDate.toISOString(),
    });

    const item2 = await instance.api<{ id: string }>(
      "POST",
      `/contacts/${grace.id}/action-items`,
      {
        title: "Task Two Today",
        dueAt: todayDate.toISOString(),
      },
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

  test("page passes automated accessibility scans in light and dark mode", async ({
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

    await page.goto("/pulse/duplicates");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectPageAccessible(page, testInfo, "pulse-duplicates");
  });
});
