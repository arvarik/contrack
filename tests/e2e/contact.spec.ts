/**
 * Opening a contact and coming back from one.
 *
 * Where focus goes on navigation is invisible to a pointer user and the whole
 * experience for a keyboard or screen reader user. Before these journeys were
 * written, clicking a row left focus on the row while the contact rendered
 * beside it, and on a phone, where the list leaves the screen, focus fell to
 * the document. Each journey below names the element that must have focus
 * after the step, not just the page that must be showing.
 */
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectVisibleFocus } from "./fixtures/a11y";
import type { Seed } from "./fixtures/seed";

/** The Pixel 7 without its browser type. See mobile-forms.spec.ts. */
const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];

/**
 * A person's row in the full list, by id. Once a contact has been opened it
 * also appears in the Recent block above the list, so a locator by name
 * alone would match two rows.
 */
const listRow = (page: Page, seed: Seed, name: string) =>
  page.locator(`#contact-row-${seed.byName(name).id}`);

/** The open contact's name, the page's only h1. */
const contactHeading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name: new RegExp(name) });

test.describe("desktop", () => {
  test("opening a row with a click puts focus on the contact's name", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    await listRow(page, seed, "Grace Hopper").click();

    await expect(page).toHaveURL(
      new RegExp(`/contact/${seed.byName("Grace Hopper").id}`),
    );
    await expect(contactHeading(page, "Grace Hopper")).toBeFocused();
  });

  test("the arrow keys move through the list without opening anyone, and Enter opens", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    const ada = listRow(page, seed, "Ada Lovelace");
    await expect(ada).toBeVisible();
    await ada.focus();

    await page.keyboard.press("ArrowDown");
    const edsger = listRow(page, seed, "Edsger Dijkstra");
    await expectVisibleFocus(edsger);
    // Moving through the list is not opening: the address has not changed.
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press("End");
    await expect(
      page.locator("#contact-list [data-roving-index]").last(),
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(ada).toBeFocused();

    // Type-ahead: a letter jumps to the next name that starts with it.
    await page.keyboard.press("g");
    await expect(listRow(page, seed, "Grace Hopper")).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/contact/${seed.byName("Grace Hopper").id}`),
    );
    await expect(contactHeading(page, "Grace Hopper")).toBeFocused();

    // Back into the list with Shift+Tab lands on the contact that is open.
    // Everything in the list header sits before the rows, so walking back
    // from the name reaches the list before anything else in it.
    let presses = 0;
    while (presses < 10) {
      await page.keyboard.press("Shift+Tab");
      presses++;
      const inList = await page.evaluate(() =>
        Boolean(document.activeElement?.closest("#contact-list")),
      );
      if (inList) break;
    }
    await expect(listRow(page, seed, "Grace Hopper")).toBeFocused();
  });
});

test.describe("phone", () => {
  test.use({ ...PHONE });

  test("opening a contact focuses its name, and Back returns focus to the row", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    const edsger = listRow(page, seed, "Edsger Dijkstra");
    await edsger.tap();

    await expect(page).toHaveURL(
      new RegExp(`/contact/${seed.byName("Edsger Dijkstra").id}`),
    );
    await expect(contactHeading(page, "Edsger Dijkstra")).toBeFocused();
    // The list is off screen while the contact has it.
    await expect(edsger).toBeHidden();

    await page.getByRole("button", { name: "Back" }).tap();
    await expect(page).toHaveURL(/\/$/);
    await expect(edsger).toBeVisible();
    await expect(edsger).toBeFocused();
  });

  test("the browser's Back button returns focus to the row too", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    const grace = listRow(page, seed, "Grace Hopper");
    await grace.tap();
    await expect(contactHeading(page, "Grace Hopper")).toBeFocused();

    await page.goBack();
    await expect(grace).toBeVisible();
    await expect(grace).toBeFocused();
  });
});
