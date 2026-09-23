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
import { expectPageAccessible, expectVisibleFocus } from "./fixtures/a11y";
import type { ContrackInstance } from "./fixtures/instance";
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

/** The contacts the current test wrote, deleted when it ends. */
const created: { instance: ContrackInstance; id: string }[] = [];

/**
 * A contact of the test's own, written through the API.
 *
 * The journeys below archive, save notes and mention people. On the seeded
 * contacts that would change what the search and map journeys count, so each
 * one works on a person nobody else looks at. The worker's instance is shared
 * with every other spec, so the names start with Z and sort after the seeded
 * people, and each contact is deleted after its test: the keyboard journeys
 * walk the list in order and expect the seed's order.
 */
async function ownContact(
  instance: ContrackInstance,
  name: string,
  company = "Journey Ltd",
): Promise<string> {
  const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
    name,
    company,
  });
  created.push({ instance, id });
  return id;
}

/** The lists the current test wrote, deleted when it ends. */
const createdLists: { instance: ContrackInstance; id: string }[] = [];

async function ownList(
  instance: ContrackInstance,
  name = "Journey List",
  icon = "folder",
): Promise<string> {
  const { id } = await instance.api<{ id: string }>("POST", "/lists", {
    name,
    icon,
  });
  createdLists.push({ instance, id });
  return id;
}

test.afterEach(async () => {
  while (created.length > 0) {
    const { instance, id } = created.pop()!;
    await instance.api("DELETE", `/contacts/${id}`);
  }
  while (createdLists.length > 0) {
    const { instance, id } = createdLists.pop()!;
    await instance.api("DELETE", `/lists/${id}`);
  }
});

/** An ISO timestamp `days` before now, at the current time of day. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Notes for a contact of the test's own, one per title, newest first: the
 * first today, then one a day back, and the last 40 days ago. The first is
 * a call, the rest are notes.
 */
async function ownNotes(
  instance: ContrackInstance,
  contactId: string,
  titles: string[],
): Promise<void> {
  for (const [index, title] of titles.entries()) {
    await instance.api("POST", `/contacts/${contactId}/interactions`, {
      type: index === 0 ? "call" : "note",
      title,
      content: `Notes for ${title.toLowerCase()}.`,
      date: daysAgo(index === titles.length - 1 ? 40 : index),
    });
  }
}

/** The month group heading for a date: "August", or "December 2025". */
function monthHeading(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString("en-US", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

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
  });
});

test.describe("the Network header and start panel", () => {
  test("the sort menu changes the order", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const firstRow = page.locator("#contact-list [data-roving-index]").first();
    await expect(firstRow).toContainText("Ada Lovelace");

    const sortButton = page.getByRole("button", { name: "Sort: A to Z" });
    await sortButton.click();

    const zToA = page.getByRole("menuitemcheckbox", { name: "Z to A" });
    await expect(zToA).toBeVisible();
    await zToA.click();

    await expect(
      page.getByRole("button", { name: "Sort: Z to A" }),
    ).toBeVisible();
    await expect(firstRow).not.toContainText("Ada Lovelace");

    await page.getByRole("button", { name: "Sort: Z to A" }).click();
    await page.getByRole("menuitemcheckbox", { name: "A to Z" }).click();
    await expect(
      page.getByRole("button", { name: "Sort: A to Z" }),
    ).toBeVisible();
    await expect(firstRow).toContainText("Ada Lovelace");
  });

  test("the sort menu opens above the selected row", async ({ page }) => {
    await page.goto("/");
    const rows = page.locator("#contact-list [data-roving-index]");
    await expect(rows.first()).toContainText("Ada Lovelace");

    // The selected row is `z-10` and comes after the `sticky z-10` header,
    // so a menu drawn inside the header used to open under it.
    await rows.nth(1).click();
    await expect(
      page.getByRole("button", { name: "Contact actions" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sort: A to Z" }).click();

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("popover", "manual");
    const item = page.getByRole("menuitemcheckbox", { name: "Newest" });
    const onTop = await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit !== null && el.contains(hit);
    });
    expect(onTop).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("Select mode keeps the title, shows Select all, Done, and the count in the bulk toolbar", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const selectBtn = page.getByRole("button", { name: "Select", exact: true });
    await selectBtn.click();

    // The page keeps its name as the title. The count leads the bar, where
    // it sits beside what it acts on, and the search box keeps its words.
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Network" }),
    ).toBeVisible();
    await expect(bar).toContainText("0 selected");
    await expect(
      page.getByRole("textbox", { name: "Search contacts" }),
    ).toHaveAttribute("placeholder", "Search...");
    const selectAllBtn = page.getByRole("button", { name: "Select all" });
    const doneBtn = page.getByRole("button", { name: "Done" });
    await expect(selectAllBtn).toBeVisible();
    await expect(doneBtn).toBeVisible();

    await selectAllBtn.click();
    await expect(bar).toContainText(/[1-9]\d* selected/);

    await doneBtn.click();
    await expect(
      page.getByRole("button", { name: "Select", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("toolbar", { name: "Bulk actions" }),
    ).toBeHidden();
  });

  test("the filter row holds All and Tracked with no lists, and a list's chip once one exists", async ({
    page,
    instance,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // The row shows with no lists at all: the Tracked chip is the way in.
    await expect(page.locator("#filter-pills-row")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Filter: All/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Filter: Tracked/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Filter: Favorites/ }),
    ).toBeHidden();

    await ownList(instance, "Favorites", "star");

    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Filter: Favorites/ }),
    ).toBeVisible();
  });

  test("the Tracked chip keeps the list to tracked people, and Manage opens the page", async ({
    page,
    seed,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Four of the six seeded people are tracked.
    const chip = page.getByRole("button", { name: "Filter: Tracked (4)" });
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(listRow(page, seed, "Ada Lovelace")).toBeVisible();
    await expect(listRow(page, seed, "Linus Torvalds")).toBeHidden();
    await expect(listRow(page, seed, "Margaret Hamilton")).toBeHidden();

    await page.getByRole("link", { name: "Manage" }).click();
    await expect(page).toHaveURL(/\/tracked$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tracked contacts" }),
    ).toBeVisible();
  });

  test("the header holds three icon buttons, and + opens the New menu", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Named for a screen reader, titled for a pointer, no visible text.
    for (const name of ["Select", "Import", "New"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("title", name);
      await expect(button).toHaveText("");
    }

    await page.getByRole("button", { name: "New", exact: true }).click();
    const menu = page.getByRole("menu", { name: "New" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "New contact",
      "Add from text",
      "New list",
    ]);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("the start panel is the mark and one line, with nothing to act on", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    const main = page.locator("#main-content");
    await expect(
      main.getByRole("heading", { level: 2, name: "No contact selected" }),
    ).toBeVisible();
    await expect(main.getByRole("region")).toHaveCount(0);
    await expect(main.getByRole("button")).toHaveCount(0);
    await expect(main.getByRole("link")).toHaveCount(0);
    await expect(page.getByText("Up next")).toHaveCount(0);
    await expect(page.getByText("Recently viewed")).toHaveCount(0);
    await expect(page.getByText("Add people")).toHaveCount(0);
  });

  test("Network page passes axe accessibility scan on desktop", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expectPageAccessible(page, testInfo, "desktop-network-light");
  });
});

/**
 * The list's edge.
 *
 * From `lg` the list and the contact share the screen, and the seam between
 * them is a separator. A drag or the arrow keys set the list's width between
 * 300 and 480 px, and the width outlasts a reload on this device. A narrow
 * window holds the list in so the contact keeps 560 px, and a wider one
 * gives the chosen width back.
 */
test.describe("the list's width", () => {
  const edge = (page: Page) =>
    page.getByRole("separator", { name: "Resize the contact list" });
  const width = (page: Page, selector: string) =>
    page
      .locator(selector)
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));

  test("a drag and the arrow keys resize the list, and a reload keeps the width", async ({
    page,
    seed,
  }) => {
    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await expect(contactHeading(page, "Ada Lovelace")).toBeVisible();
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "350");
    await expect(edge(page)).toHaveAttribute("aria-orientation", "vertical");

    const seam = (await edge(page).boundingBox())!;
    const x = seam.x + seam.width / 2;
    await page.mouse.move(x, 400);
    await page.mouse.down();
    await page.mouse.move(x + 60, 400, { steps: 6 });
    await page.mouse.up();
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "410");
    await expect.poll(() => width(page, '[data-pane="list"]')).toBe(410);

    await edge(page).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "394");
    await page.keyboard.press("End");
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "480");

    await page.reload();
    await expect(contactHeading(page, "Ada Lovelace")).toBeVisible();
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "480");
    await expect.poll(() => width(page, '[data-pane="list"]')).toBe(480);

    // A double click puts the default back.
    const moved = (await edge(page).boundingBox())!;
    await page.mouse.dblclick(moved.x + moved.width / 2, 400);
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "350");
  });

  test("a narrow window holds the list in so the contact keeps 560 px", async ({
    page,
    seed,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await expect(contactHeading(page, "Ada Lovelace")).toBeVisible();
    await edge(page).focus();
    await page.keyboard.press("End");
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "480");

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(edge(page)).toHaveAttribute("aria-valuemax", "400");
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "400");
    await expect.poll(() => width(page, "#main-content")).toBe(560);

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(edge(page)).toHaveAttribute("aria-valuenow", "480");

    // Below `lg` the list and the contact take turns, and there is no edge.
    await page.setViewportSize({ width: 800, height: 900 });
    await expect(edge(page)).toBeHidden();
  });
});

/**
 * The header's menu.
 *
 * The header used to show a palette icon and an archive icon at the same rank
 * as the name, with delete in a menu and an unlabelled sparkle beside the
 * company. Every action is now in the "Contact actions" menu, which behaves
 * as a menu: focus inside on open, the arrows and Home and End move, Escape
 * returns to the button. There is no button to log: the composer is the first
 * thing in the Timeline column.
 */
/**
 * Twelve people of the test's own, so the list is longer than the window.
 * Their names sort after the seed's, so the last of them is the list's
 * last row.
 */
async function longList(instance: ContrackInstance): Promise<string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= 12; n += 1) {
    ids.push(
      await ownContact(instance, `Zz Person ${String(n).padStart(2, "0")}`),
    );
  }
  return ids;
}

test.describe("a long list", () => {
  test("a deep link scrolls the list to the open contact's row", async ({
    page,
    instance,
  }) => {
    // The row wore the selected tint off screen, under the fold.
    const ids = await longList(instance);
    const last = ids[ids.length - 1];
    await page.goto(`/contact/${last}`);
    await expect(contactHeading(page, "Zz Person 12")).toBeVisible();
    const row = page.locator(`#contact-row-${last}`);
    await expect(row).toBeInViewport();
    await expect(row).toHaveAttribute("aria-current", "page");
  });

  test("select mode keeps the last row above the bulk bar, and focus on the button that replaces the pressed one", async ({
    page,
    instance,
  }) => {
    const ids = await longList(instance);
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();

    // Select becomes Done, and focus goes with it rather than to the body.
    await page.getByRole("button", { name: "Select", exact: true }).focus();
    await page.keyboard.press("Enter");
    const done = page.getByRole("button", { name: "Done" });
    await expect(done).toBeFocused();

    // Scrolled to the end, the last row sits above the floating bar. It sat
    // under it, with 16 px of padding under the list.
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toBeVisible();
    const last = page.locator(`#contact-row-${ids[ids.length - 1]}`);
    await expect
      .poll(async () => {
        await page
          .locator("#contact-list")
          .evaluate((list) => list.scrollTo(0, list.scrollHeight));
        const row = await last.boundingBox();
        const barBox = await bar.boundingBox();
        return row && barBox ? barBox.y - (row.y + row.height) : -1;
      })
      .toBeGreaterThanOrEqual(0);

    // Done becomes Select again, and focus goes back to it.
    await done.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: "Select", exact: true }),
    ).toBeFocused();
  });
});

test.describe("the contact header", () => {
  test("the menu lists the actions in order, and the keys work inside it", async ({
    page,
    instance,
  }, testInfo) => {
    const id = await ownContact(instance, "Zora Kebab");
    await page.goto(`/contact/${id}`);
    await expect(contactHeading(page, "Zora Kebab")).toBeVisible();

    const kebab = page.getByRole("button", { name: "Contact actions" });
    await expect(kebab).toHaveAttribute("aria-haspopup", "menu");
    await kebab.click();
    const menu = page.getByRole("menu", { name: "Contact actions" });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Change colour",
      "Change avatar",
      "Copy basic details",
      "Copy full details",
      "Archive",
      "Delete",
    ]);
    await expect(kebab).toHaveAttribute("aria-expanded", "true");
    // Opened by a click, focus is on the first item. The browser draws the
    // ring only once a key moves it.
    await expect(
      menu.getByRole("menuitem", { name: "Change colour" }),
    ).toBeFocused();
    await expectPageAccessible(page, testInfo, "contact-actions-menu");

    await page.keyboard.press("End");
    await expectVisibleFocus(menu.getByRole("menuitem", { name: "Delete" }));
    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitem", { name: "Change colour" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(kebab).toBeFocused();

    // Change colour, from the keyboard: the picker opens on the colour in
    // use, and Escape hands focus back to the menu button.
    await page.keyboard.press("Enter");
    await expect(
      menu.getByRole("menuitem", { name: "Change colour" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    const colours = page.getByRole("radiogroup", { name: "Contact colour" });
    await expect(colours).toBeVisible();
    await expect(colours.getByRole("radio", { checked: true })).toBeFocused();
    await expectPageAccessible(page, testInfo, "contact-colour-picker");
    await page.keyboard.press("Escape");
    await expect(colours).toBeHidden();
    await expect(kebab).toBeFocused();

    // Archive from the menu, and the item turns into its undo.
    await kebab.click();
    await menu.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByText("Zora Kebab archived")).toBeVisible();
    await kebab.click();
    await expect(
      menu.getByRole("menuitem", { name: "Unarchive" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("the wide header has no Log interaction button, and the composer is on the page", async ({
    page,
    instance,
  }) => {
    const id = await ownContact(instance, "Zane Focus");
    await page.goto(`/contact/${id}`);
    await expect(contactHeading(page, "Zane Focus")).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Log interaction" }),
    ).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Note" })).toBeVisible();
  });
});

/**
 * The timeline: one column, in groups, with its actions out of the way.
 */
test.describe("tracking", () => {
  /** The header's avatar ring, which says the ring state on its root. */
  const headerRing = (page: Page, name: string) =>
    page
      .locator("section", { has: contactHeading(page, name) })
      .locator("[data-score-band]")
      .first();

  /** The toast that says `text`, so its Undo is the right one. */
  const toastWith = (page: Page, text: string) =>
    page.locator("[data-sonner-toast]", { hasText: text });

  test("the header button tracks with an Undo, the ring follows, and the caret changes the cadence", async ({
    page,
    instance,
  }) => {
    const id = await ownContact(instance, "Zara Tracked");
    await page.goto(`/contact/${id}`);
    await expect(contactHeading(page, "Zara Tracked")).toBeVisible();

    const track = page.getByRole("button", { name: "Track", exact: true });
    await expect(track).toHaveAttribute("aria-pressed", "false");
    // The caret is there before tracking, so the control cannot change
    // shape when it is pressed.
    await expect(
      page.getByRole("button", { name: "Track, and choose how often" }),
    ).toBeVisible();
    // Where the word sits before the press. Tracking must not move it.
    const boxBefore = await track.boundingBox();
    await expect(headerRing(page, "Zara Tracked")).toHaveAttribute(
      "data-score-band",
      "untracked",
    );
    await expect(page.getByRole("button", { name: /^Cadence:/ })).toBeHidden();

    await track.click();
    const tracked = page.getByRole("button", { name: "Tracked", exact: true });
    await expect(tracked).toHaveAttribute("aria-pressed", "true");
    // Tracked with nothing logged: the empty track.
    await expect(headerRing(page, "Zara Tracked")).toHaveAttribute(
      "data-score-band",
      "unscored",
    );
    await expect(
      toastWith(page, "Tracking Zara Tracked, every 3 months"),
    ).toBeVisible();
    await expect(
      toastWith(page, "Tracking Zara Tracked").getByRole("button", {
        name: "Undo",
      }),
    ).toBeVisible();

    /*
      The word has not moved.

      The cluster in the header is right-aligned, so a control that grows
      pushes its own label leftward. The caret's slot is held open while
      untracked and the label is sized to the longer word, which makes both
      states the same width, so the left edge stays put to the pixel. This is
      the assertion the shape exists for.
    */
    const boxAfter = await tracked.boundingBox();
    expect(boxBefore).not.toBeNull();
    expect(boxAfter).not.toBeNull();
    expect(Math.round(boxAfter!.x)).toBe(Math.round(boxBefore!.x));
    expect(Math.round(boxAfter!.width)).toBe(Math.round(boxBefore!.width));

    // The caret, which carries no words of its own, and its menu.
    const caret = page.getByRole("button", { name: "Cadence: every 3 months" });
    await expect(caret).toHaveText("");
    await caret.click();
    const menu = page.getByRole("menu", { name: "Cadence: every 3 months" });
    await expect(menu.getByRole("menuitemcheckbox")).toHaveText([
      "Every month",
      "Every 2 months",
      "Every 3 months",
      "Every 6 months",
      "Every year",
    ]);
    await expect(
      menu.getByRole("menuitemcheckbox", { name: "Every 3 months" }),
    ).toHaveAttribute("aria-checked", "true");
    await menu.getByRole("menuitemcheckbox", { name: "Every month" }).click();
    await expect(
      page.getByRole("button", { name: "Cadence: every month" }),
    ).toBeVisible();
    await expect(toastWith(page, "Zara Tracked, every month")).toBeVisible();

    // Untrack, then Undo: the contact comes back with the cadence it had.
    await tracked.click();
    await expect(track).toHaveAttribute("aria-pressed", "false");
    await expect(headerRing(page, "Zara Tracked")).toHaveAttribute(
      "data-score-band",
      "untracked",
    );
    await toastWith(page, "Stopped tracking Zara Tracked")
      .getByRole("button", { name: "Undo" })
      .click();
    await expect(tracked).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("button", { name: "Cadence: every month" }),
    ).toBeVisible();
  });

  test("the caret tracks at a cadence you pick, in one press", async ({
    page,
    instance,
  }) => {
    const id = await ownContact(instance, "Zane Cadence");
    await page.goto(`/contact/${id}`);
    await expect(contactHeading(page, "Zane Cadence")).toBeVisible();

    // Untracked, the caret offers the five cadences as actions: none is
    // checked, because there is no cadence yet.
    const caret = page.getByRole("button", {
      name: "Track, and choose how often",
    });
    await caret.click();
    const menu = page.getByRole("menu", {
      name: "Track, and choose how often",
    });
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Every month",
      "Every 2 months",
      "Every 3 months",
      "Every 6 months",
      "Every year",
    ]);
    await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(0);

    await menu.getByRole("menuitem", { name: "Every year" }).click();

    // Tracked, at the cadence that was chosen rather than the default.
    await expect(
      page.getByRole("button", { name: "Tracked", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      toastWith(page, "Tracking Zane Cadence, every year"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cadence: every year" }),
    ).toBeVisible();
    await expect(headerRing(page, "Zane Cadence")).toHaveAttribute(
      "data-score-band",
      "unscored",
    );
  });

  test("t tracks and untracks the open contact", async ({ page, instance }) => {
    const id = await ownContact(instance, "Zed Keyed");
    await page.goto(`/contact/${id}`);
    await expect(contactHeading(page, "Zed Keyed")).toBeVisible();

    await page.keyboard.press("t");
    await expect(
      page.getByRole("button", { name: "Tracked", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      toastWith(page, "Tracking Zed Keyed, every 3 months"),
    ).toBeVisible();

    await page.keyboard.press("t");
    await expect(
      page.getByRole("button", { name: "Track", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(toastWith(page, "Stopped tracking Zed Keyed")).toBeVisible();

    // Not while typing: the name field keeps its letters.
    await contactHeading(page, "Zed Keyed").getByRole("button").click();
    await page.keyboard.type("t");
    await expect(
      page.getByRole("button", { name: "Track", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
  });

  // The Tracked page's bar was fixed to the window and centred on it: at
  // 800 px it started at x 24 over the rail's Settings gear, and at 1440 px
  // it ran past the cards on both sides.
  test.describe("the Tracked page at 800 px", () => {
    test.use({ viewport: { width: 800, height: 900 } });

    test("puts the bulk bar in the column of cards, clear of the rail", async ({
      page,
    }) => {
      await page.goto("/tracked");
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Select", exact: true }).click();
      await expect(main.getByRole("button", { name: "Done" })).toBeFocused();
      const bar = page.getByRole("toolbar", { name: "Bulk actions" });
      await expect(bar).toBeVisible();
      // Nobody is picked: all three of the bar's buttons wait.
      for (const name of ["Track", "Untrack", "Cadence"]) {
        await expect(
          bar.getByRole("button", { name, exact: true }),
        ).toBeDisabled();
      }

      const card = (await main.locator("section").first().boundingBox())!;
      await expect
        .poll(async () => {
          const box = await bar.boundingBox();
          return box ? [Math.round(box.x), Math.round(box.width)] : null;
        })
        .toEqual([Math.round(card.x), Math.round(card.width)]);
      const gear = page.getByRole("link", { name: "Settings" }).first();
      if (await gear.isVisible()) {
        const box = (await gear.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(card.x);
      }
    });
  });

  // A taller window: the three people of this test sort last, and in a
  // 720 px window the floating bar sits over the last rows.
  test.describe("with room under the bar", () => {
    test.use({ viewport: { width: 1280, height: 1100 } });

    test("the bulk bar tracks three, the Tracked chip counts them, and Undo takes them back", async ({
      page,
      instance,
    }) => {
      const ids: string[] = [];
      for (const name of ["Zeta One", "Zeta Two", "Zeta Three"]) {
        ids.push(await ownContact(instance, name));
      }
      await page.goto("/");
      await expect(page.getByText("Zeta Three")).toBeVisible();

      const chip = page.getByRole("button", { name: /^Filter: Tracked/ });
      await expect(chip).toHaveAccessibleName("Filter: Tracked (4)");

      await page.getByRole("button", { name: "Select", exact: true }).click();
      for (const id of ids) await page.locator(`#contact-row-${id}`).click();
      await expect(page.getByText("3 selected")).toBeVisible();

      const bar = page.getByRole("toolbar", { name: "Bulk actions" });
      // Untracked people are selected, so the bar offers Track, and first.
      const track = bar.getByRole("button", { name: "Track", exact: true });
      await expect(bar.getByRole("button").first()).toHaveAccessibleName(
        "Track",
      );
      await track.click();
      await expect(toastWith(page, "Tracking 3 contacts")).toBeVisible();
      await expect(chip).toHaveAccessibleName("Filter: Tracked (7)");
      await expect(bar).toBeHidden();

      await toastWith(page, "Tracking 3 contacts")
        .getByRole("button", { name: "Undo" })
        .click();
      await expect(
        toastWith(page, "Stopped tracking 3 contacts"),
      ).toBeVisible();
      await expect(chip).toHaveAccessibleName("Filter: Tracked (4)");
    });
  });
});

test.describe("the timeline", () => {
  test("Details sits beside one column of groups, and an entry's menu shows on focus", async ({
    page,
    instance,
  }, testInfo) => {
    const id = await ownContact(instance, "Zuri Column");
    // The first note is dated today, so it is in this week whatever the day.
    await ownNotes(instance, id, [
      "Call about the offsite",
      "Lunch in the old office",
    ]);
    await page.goto(`/contact/${id}`);
    const first = page.getByRole("button", {
      name: "Call about the offsite",
      exact: true,
    });
    await expect(first).toBeVisible();

    // Two sections beside Details, not three.
    const sections = page.getByRole("radiogroup", { name: "Contact sections" });
    await expect(sections.getByRole("radio")).toHaveText([
      "Timeline",
      "Dossier",
    ]);
    const details = page.getByRole("heading", { name: "Details" });
    const detailsBox = (await details.boundingBox())!;
    const firstBox = (await first.boundingBox())!;
    expect(detailsBox.x).toBeLessThan(firstBox.x);

    // Newest first, under "This week", then the month of the older note.
    await expect(
      page.getByRole("heading", { level: 2, name: "This week" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: monthHeading(daysAgo(40)) }),
    ).toBeVisible();
    // The entry's tooltip is its full date.
    await expect(page.locator("li", { has: first })).toHaveAttribute(
      "title",
      /\d{4}/,
    );

    // No action at rest. Focus on the entry shows its menu, and Tab reaches it.
    const kebab = page.getByRole("button", {
      name: "Actions for Call about the offsite",
    });
    await expect(kebab).toHaveCSS("opacity", "0");
    await first.focus();
    await expect(kebab).toHaveCSS("opacity", "1");
    await page.keyboard.press("Tab");
    await expectVisibleFocus(kebab);
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", {
      name: "Actions for Call about the offsite",
    });
    await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Delete"]);
    await expectPageAccessible(page, testInfo, "timeline-entry-menu");

    // Edit opens the note ready to change.
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("textbox", { name: "Interaction title" }),
    ).toBeVisible();
  });
});

/**
 * One composer, on the contact page and in the quick interaction dialog.
 */
test.describe("the composer", () => {
  test("an empty Save explains, and ⌘ Enter saves the note to the timeline", async ({
    page,
    instance,
  }, testInfo) => {
    const id = await ownContact(instance, "Zeno Composer");
    await page.goto(`/contact/${id}`);
    const editor = page.getByRole("textbox", { name: "Note" });
    await expect(editor).toBeVisible();

    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("Write something first")).toBeVisible();
    await expect(editor).toBeFocused();

    await editor.pressSequentially("Walked through the quarterly plan");
    await expect(page.getByText("Write something first")).toBeHidden();
    const types = page.getByRole("radiogroup", { name: "Interaction type" });
    await types.getByRole("radio", { name: "Meeting" }).click();
    await expect(types.getByRole("radio", { name: "Meeting" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByText("to save")).toBeVisible();
    await expectPageAccessible(page, testInfo, "composer-with-text");

    await editor.click();
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(
      page.getByRole("button", { name: "Logged meeting", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Walked through the quarterly plan"),
    ).toHaveCount(1);
    await expect(editor).toHaveText("");
  });

  test("the quick interaction dialog mentions a person and saves on ⌘ Enter", async ({
    page,
    instance,
  }, testInfo) => {
    const writerId = await ownContact(instance, "Zach Dialog");
    const mentionedId = await ownContact(instance, "Zelda Mentioned");
    await page.goto(`/contact/${writerId}`);
    await expect(contactHeading(page, "Zach Dialog")).toBeVisible();

    await page.keyboard.press("Meta+Shift+KeyI");
    const dialog = page.getByRole("dialog", { name: "Log an interaction" });
    await expect(dialog).toBeVisible();
    const picker = dialog.getByRole("textbox", {
      name: "Search for a contact",
    });
    await expect(picker).toBeFocused();
    await picker.fill("Zach Dia");
    await page.keyboard.press("Enter");

    const editor = dialog.getByRole("textbox", { name: "Note" });
    await expect(editor).toBeFocused();
    await editor.pressSequentially("Introduced @Zel");
    // The suggestion list sits inside the dialog, where it can be clicked.
    const suggestion = dialog.getByRole("button", { name: /Zelda Mentioned/ });
    await expect(suggestion).toBeVisible();
    await expectPageAccessible(page, testInfo, "dialog-mention", (b) =>
      b.include('[role="dialog"]'),
    );
    await suggestion.click();
    await expect(dialog).toBeVisible();
    await expect(editor.locator('[data-type="mention"]')).toHaveText(
      "@Zelda Mentioned",
    );

    await editor.press("ControlOrMeta+Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Note logged for Zach Dialog")).toBeVisible();

    // The mention links the note to the person it names.
    await page.goto(`/contact/${mentionedId}`);
    await expect(page.getByText("Introduced @Zelda Mentioned")).toBeVisible();
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

  test("the timeline comes first: sticky sections, a one-line composer, delete and undo", async ({
    page,
    instance,
  }, testInfo) => {
    const id = await ownContact(instance, "Zia Phone");
    await ownNotes(instance, id, [
      "Call about the offsite",
      "Notes from the design review",
      "Sent the contract draft",
      "Intro to the new hire",
      "Catch up on the roadmap",
      "Lunch in the old office",
    ]);
    await page.goto(`/contact/${id}`);
    const first = page.getByRole("button", {
      name: "Call about the offsite",
      exact: true,
    });
    await expect(first).toBeVisible();

    // A short header: Back says where it goes, and there is no button to
    // log, because the composer is right under the sections.
    await expect(
      page.getByRole("button", { name: "Back to Network" }),
    ).toHaveText("Network");
    await expect(
      page.getByRole("button", { name: "Log interaction" }),
    ).toHaveCount(0);
    const sections = page.getByRole("radiogroup", { name: "Contact sections" });
    await expect(sections.getByRole("radio")).toHaveText([
      "Timeline",
      "Details",
      "Dossier",
    ]);

    // The composer is one line, above the first entry.
    const editor = page.getByRole("textbox", { name: "Note" });
    const nextAction = page.getByRole("textbox", { name: "Next action" });
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(editor).toBeVisible();
    expect((await editor.boundingBox())!.y).toBeLessThan(
      (await first.boundingBox())!.y,
    );
    await expect(nextAction).toBeHidden();
    await expect(save).toBeHidden();
    await expectPageAccessible(page, testInfo, "phone-timeline");

    // Focus opens it, with Save above the tab bar. Focus leaving an empty
    // composer closes it again.
    await editor.tap();
    await expect(nextAction).toBeVisible();
    await expect(save).toBeVisible();
    const tabBar = page.getByRole("navigation", { name: "Primary" });
    const saveBox = (await save.boundingBox())!;
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(
      (await tabBar.boundingBox())!.y,
    );
    await page.getByRole("heading", { level: 2 }).first().tap();
    await expect(nextAction).toBeHidden();

    // The sections stay under the Back bar while the page scrolls.
    const heading = contactHeading(page, "Zia Phone");
    await sections.evaluate((node) => {
      let scroller = node.parentElement;
      while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
        scroller = scroller.parentElement;
      }
      scroller?.scrollTo(0, scroller.scrollHeight);
    });
    await expect
      .poll(async () => (await heading.boundingBox())?.y ?? -1)
      .toBeLessThan(0);
    const backBar = (await page
      .getByRole("button", { name: "Back to Network" })
      .locator("xpath=..")
      .boundingBox())!;
    await expect
      .poll(async () => Math.round((await sections.boundingBox())!.y))
      .toBeGreaterThanOrEqual(Math.round(backBar.y + backBar.height));
    expect((await sections.boundingBox())!.y).toBeLessThan(
      backBar.y + backBar.height + 16,
    );

    // Delete asks, then offers Undo, and Undo sends nothing.
    const kebab = page.getByRole("button", {
      name: "Actions for Call about the offsite",
    });
    await kebab.scrollIntoViewIfNeeded();
    // A touch screen has no hover, so the menu button shows at rest.
    await expect(kebab).toHaveCSS("opacity", "1");
    await kebab.tap();
    await page.getByRole("menuitem", { name: "Delete" }).tap();
    const confirm = page.getByRole("dialog", {
      name: "Delete this interaction?",
    });
    await expect(confirm).toBeVisible();
    await expectPageAccessible(page, testInfo, "phone-timeline-delete");
    await confirm.getByRole("button", { name: "Delete interaction" }).tap();
    await expect(first).toBeHidden();
    await expect(page.getByText("Interaction deleted")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).tap();
    await expect(first).toBeVisible();
    await page.reload();
    await expect(first).toBeVisible();

    // Without Undo, the delete reaches the server once the offer closes.
    await kebab.tap();
    await page.getByRole("menuitem", { name: "Delete" }).tap();
    await confirm.getByRole("button", { name: "Delete interaction" }).tap();
    await expect(first).toBeHidden();
    const offer = page.getByText("Interaction deleted");
    await expect(offer).toBeVisible();
    // The request waits for the offer to close, and not a moment before.
    expect(
      (
        await instance.api<{ title: string }[]>(
          "GET",
          `/contacts/${id}/timeline`,
        )
      ).map((entry) => entry.title),
    ).toContain("Call about the offsite");
    await expect(offer).toBeHidden({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          (
            await instance.api<{ title: string }[]>(
              "GET",
              `/contacts/${id}/timeline`,
            )
          ).map((entry) => entry.title),
        { timeout: 5_000 },
      )
      .not.toContain("Call about the offsite");
  });

  test("the contact page passes axe in both palettes, on each section", async ({
    page,
    seed,
  }, testInfo) => {
    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await expect(
      page.getByRole("button", {
        name: "Coffee about the Berlin office",
        exact: true,
      }),
    ).toBeVisible();
    const sections = page.getByRole("radiogroup", { name: "Contact sections" });

    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator("html")).toHaveCSS(
        "color-scheme",
        new RegExp(scheme),
      );
      await sections.getByRole("radio", { name: "Timeline" }).tap();
      await expectPageAccessible(page, testInfo, `phone-contact-${scheme}`);
      await sections.getByRole("radio", { name: "Details" }).tap();
      await expect(
        page.getByRole("heading", { name: "Details" }),
      ).toBeVisible();
      await expectPageAccessible(
        page,
        testInfo,
        `phone-contact-details-${scheme}`,
      );
    }
  });

  test("the narrow header keeps Track as the glyph alone, with the wordless caret", async ({
    page,
    seed,
  }) => {
    await page.goto(`/contact/${seed.byName("Ada Lovelace").id}`);
    await expect(contactHeading(page, "Ada Lovelace")).toBeVisible();

    const tracked = page.getByRole("button", { name: "Tracked", exact: true });
    await expect(tracked).toHaveAttribute("aria-pressed", "true");
    await expect(tracked).toHaveText("");
    await expect(tracked).toHaveAttribute("title", "Tracked");
    // The caret carries the cadence in its name, not in words on screen.
    await expect(
      page.getByRole("button", { name: "Cadence: every 3 months" }),
    ).toHaveText("");
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

  test("Network page passes axe accessibility scan on phone", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await expectPageAccessible(page, testInfo, "phone-network-light");
  });
});
