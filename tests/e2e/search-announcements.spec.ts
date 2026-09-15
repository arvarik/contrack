/**
 * Search announcements — WCAG 2.2 SC 4.1.3, Status Messages.
 *
 * A sighted person sees a spinner, then a count. A screen-reader user hears
 * nothing unless the page says something, so the search page keeps one
 * polite status region and speaks into it: that the search started, what it
 * found, and nothing else. A failure is an alert, which interrupts, and the
 * status region stays quiet so the failure is heard once.
 *
 * The region is asserted by role and name, and its text by the sentence a
 * screen reader would read. Notes searches run against the real server;
 * People searches are answered at the network edge (see fixtures/search).
 */
import { test, expect } from "./fixtures/test";
import {
  answerPeopleSearch,
  failPeopleSearch,
  personMatch,
} from "./fixtures/search";
import type { Page } from "@playwright/test";

const status = (page: Page) =>
  page.getByRole("status", { name: "Search status" });

test.describe("people", () => {
  test("says that the search started, then how many it found", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(
      page,
      [
        personMatch(seed.byName("Ada Lovelace")),
        personMatch(seed.byName("Grace Hopper")),
      ],
      { delayMs: 1_200 },
    );
    await page.goto("/search");
    const region = status(page);
    await expect(region).toHaveText("");

    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("who likes espresso");
    await input.press("Enter");

    await expect(region).toHaveText(
      "Searching your network for “who likes espresso”…",
    );
    await expect(region).toHaveText("2 matches for “who likes espresso”.");
    await expect(page.getByText("2 matches", { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("says when nothing matched", async ({ page }) => {
    await answerPeopleSearch(page, []);
    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("who collects stamps");
    await input.press("Enter");

    await expect(status(page)).toHaveText(
      "No matches for “who collects stamps”.",
    );
    await expect(page.getByText("No matches found")).toBeVisible();
  });

  test("says that AI was unavailable and the matches are by keyword", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(
      page,
      [personMatch(seed.byName("Linus Torvalds"))],
      {
        fallback: true,
      },
    );
    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("Linus");
    await input.press("Enter");

    await expect(status(page)).toHaveText(
      "AI unavailable. 1 match for “Linus” by keyword.",
    );
    await expect(
      page.getByText("AI unavailable — showing keyword matches"),
    ).toBeVisible();
  });

  test("announces a failure as an alert and keeps the status quiet", async ({
    page,
  }) => {
    await failPeopleSearch(page, "The provider is not answering.");
    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("who likes espresso");
    await input.press("Enter");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Search failed");
    await expect(alert).toContainText("The provider is not answering.");
    await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(status(page)).toHaveText("");
  });

  test("does not read restored results again on the way back to the page", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(page, [
      personMatch(seed.byName("Ada Lovelace")),
      personMatch(seed.byName("Grace Hopper")),
    ]);
    await page.goto("/search");
    const input = page.getByRole("textbox", {
      name: "Ask anything about your network",
    });
    await input.fill("who likes espresso");
    await input.press("Enter");
    await expect(status(page)).toHaveText(
      "2 matches for “who likes espresso”.",
    );

    await page.getByRole("link", { name: /^Relationship Pulse/ }).click();
    await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();
    await page.getByRole("link", { name: "AI Search" }).click();

    // The results are back on screen, and the region says nothing about
    // them: the reader is where they left off, not hearing a new answer.
    await expect(page.getByText("2 matches", { exact: true })).toBeVisible();
    await expect(status(page)).toHaveText("");
  });
});

test.describe("notes", () => {
  test("counts the notes that match, across every period", async ({ page }) => {
    await page.goto("/search?mode=notes");
    const region = status(page);
    await expect(region).toHaveText("");

    await page
      .getByRole("textbox", { name: "Search your notes" })
      .fill("hiring");
    await expect(region).toHaveText("3 notes for “hiring”.");
    await expect(page.getByText("3 notes", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Last 30 days" }).click();
    await expect(region).toHaveText("2 notes for “hiring”.");

    await page.getByRole("textbox", { name: "Search your notes" }).fill("zzqx");
    await expect(region).toHaveText("No notes match for “zzqx”.");
    await expect(
      page.getByText("No notes match", { exact: true }),
    ).toBeVisible();
  });

  test("announces a failure as an alert and keeps the status quiet", async ({
    page,
  }) => {
    await page.route("**/api/search/interactions?*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Index unavailable" }),
      }),
    );
    await page.goto("/search?mode=notes");
    await page
      .getByRole("textbox", { name: "Search your notes" })
      .fill("hiring");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Search failed");
    await expect(status(page)).toHaveText("");
  });
});
