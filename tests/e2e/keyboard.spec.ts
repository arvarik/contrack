/**
 * Keyboard navigation — the app is usable with no pointer at all.
 *
 * Each test starts with focus on the body, presses real keys, and asserts
 * where focus went and that a sighted keyboard user could see it there
 * (WCAG 2.1.1, 2.4.3, 2.4.7). The focus ring is checked in both palettes,
 * because it is drawn from a colour token and the dark palette has its own.
 */
import { test, expect } from "./fixtures/test";
import { expectVisibleFocus } from "./fixtures/a11y";
import type { Page } from "@playwright/test";

/** Put focus on the body, so the first Tab starts from the top of the page. */
async function startFromBody(page: Page): Promise<void> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
}

/**
 * Press Tab until focus is inside `selector`, and say how many presses it
 * took, or Infinity if the budget ran out first.
 */
async function tabsToReach(
  page: Page,
  selector: string,
  budget: number,
): Promise<number> {
  for (let presses = 1; presses <= budget; presses++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      (target) => Boolean(document.activeElement?.closest(target)),
      selector,
    );
    if (inside) return presses;
  }
  return Infinity;
}

/** The Network list's rows, the only elements that carry a roving index. */
const LIST_ROW = "#contact-list [data-roving-index]";

/** The sidebar, in Tab order, after the skip link. */
const SIDEBAR_STOPS = [
  { role: "link", name: "Network" },
  { role: "link", name: /^Pulse/ },
  { role: "link", name: "Map" },
  { role: "link", name: "Ask Contrack" },
  { role: "button", name: "Keyboard shortcuts" },
  { role: "link", name: "Settings" },
] as const;

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("the first Tab stop is a skip link that lands on the list's current row", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByText("Ada Lovelace")).toBeVisible();
      await startFromBody(page);

      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to main content" });
      await expect(skip).toBeVisible();
      await expectVisibleFocus(skip);

      // On the Network page the content is the list, not the "no contact
      // selected" pane beside it, so the link lands on the row that owns the
      // list's Tab stop, ready for the arrow keys.
      await page.keyboard.press("Enter");
      await expectVisibleFocus(
        page
          .locator("#contact-list")
          .getByRole("link", { name: /^Ada Lovelace/ }),
      );
    });

    test("every sidebar stop is reachable in order and shows its focus", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.getByText("Ada Lovelace")).toBeVisible();
      await startFromBody(page);
      await page.keyboard.press("Tab"); // the skip link

      for (const stop of SIDEBAR_STOPS) {
        await page.keyboard.press("Tab");
        const target = page.getByRole(stop.role, { name: stop.name });
        await expectVisibleFocus(target);
      }

      // And back the other way.
      await page.keyboard.press("Shift+Tab");
      await expectVisibleFocus(
        page.getByRole("button", { name: "Keyboard shortcuts" }),
      );
    });
  });
}

test("slash focuses the contact search and Escape clears it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Grace Hopper")).toBeVisible();
  await startFromBody(page);

  await page.keyboard.press("/");
  const search = page.getByRole("textbox", { name: "Search contacts" });
  await expectVisibleFocus(search);

  await page.keyboard.type("Ada");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await expect(page.getByText("Grace Hopper")).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.getByText("Grace Hopper")).toBeVisible();
});

test("arrow keys walk the contact list and mark the current row", async ({
  page,
  seed,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await startFromBody(page);

  // Scoped to the list: the phone tab bar is in the DOM at every width and
  // marks its own current tab.
  const current = page.locator('#contact-list [aria-current="page"]');
  const ada = seed.byName("Ada Lovelace");
  const edsger = seed.byName("Edsger Dijkstra");

  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(new RegExp(`/contact/${ada.id}`));
  await expect(current).toContainText("Ada Lovelace");

  await page.keyboard.press("ArrowDown");
  await expect(page).toHaveURL(new RegExp(`/contact/${edsger.id}`));
  await expect(current).toContainText("Edsger Dijkstra");

  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`/contact/${ada.id}`));
  await expect(current).toContainText("Ada Lovelace");
});

test("the search mode is a radiogroup the arrow keys switch", async ({
  page,
}) => {
  await page.goto("/search");
  const group = page.getByRole("radiogroup", { name: "What to search" });
  const people = group.getByRole("radio", { name: "People" });
  const notes = group.getByRole("radio", { name: "Notes" });
  await expect(people).toBeChecked();

  await people.focus();
  await page.keyboard.press("ArrowRight");
  await expect(notes).toBeChecked();
  await expectVisibleFocus(notes);
  await expect(page).toHaveURL(/mode=notes/);
  await expect(
    page.getByRole("textbox", { name: "Search your notes" }),
  ).toBeVisible();

  // Only the selected option is a tab stop, so Tab leaves the group.
  await page.keyboard.press("Tab");
  await expect(people).not.toBeFocused();
  await expect(notes).not.toBeFocused();

  await notes.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(people).toBeChecked();
  await expect(page).not.toHaveURL(/mode=notes/);
});

test("on a contact page the skip link lands on the contact's name", async ({
  page,
  seed,
}) => {
  await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
  const heading = page.getByRole("heading", { level: 1, name: /Ada Lovelace/ });
  await expect(heading).toBeVisible();
  await startFromBody(page);

  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(heading).toBeFocused();
  // A heading is a place, not a control, so it wears no ring of its own.
  await expect(heading).toHaveCSS("outline-style", "none");

  // One more Tab is the name itself, which edits in place.
  await page.keyboard.press("Tab");
  await expectVisibleFocus(heading.getByRole("button"));
});

/**
 * The Tab budget.
 *
 * Before the list became one Tab stop, the first control in a contact was
 * stop 42: the skip link, six sidebar links, six list controls, fifteen rows
 * and thirteen letter buttons. The budget is what the page costs now, and a
 * change that adds stops in front of the content fails here rather than in a
 * keyboard user's afternoon.
 */
test.describe("Tab budget", () => {
  test("a contact's name is within 16 Tabs of the top of the page", async ({
    page,
    seed,
  }) => {
    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
    ).toBeVisible();
    await startFromBody(page);

    const presses = await tabsToReach(page, "#contact-heading", 16);
    expect(presses).toBeLessThanOrEqual(16);
  });

  test("the first row on Network is within 14 Tabs, and the list is one stop", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await startFromBody(page);

    const presses = await tabsToReach(page, LIST_ROW, 14);
    expect(presses).toBeLessThanOrEqual(14);
    await expect(
      page
        .locator("#contact-list")
        .getByRole("link", { name: /^Ada Lovelace/ }),
    ).toBeFocused();

    // One more Tab leaves the list, however many people are in it.
    await page.keyboard.press("Tab");
    const stillInList = await page.evaluate(
      (row) => Boolean(document.activeElement?.closest(row)),
      LIST_ROW,
    );
    expect(stillInList).toBe(false);
  });
});
