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

test.afterEach(async () => {
  while (created.length > 0) {
    const { instance, id } = created.pop()!;
    await instance.api("DELETE", `/contacts/${id}`);
  }
});

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

/**
 * The header's one primary action and its menu.
 *
 * The header used to show a palette icon and an archive icon at the same rank
 * as the name, with delete in a menu and an unlabelled sparkle beside the
 * company. It now shows "Log interaction", and every other action is in the
 * "Contact actions" menu, which behaves as a menu: focus inside on open, the
 * arrows and Home and End move, Escape returns to the button.
 */
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

  test("Log interaction puts focus in the composer", async ({
    page,
    instance,
  }) => {
    const id = await ownContact(instance, "Zane Focus");
    await page.goto(`/contact/${id}`);

    // From the Dossier tab too: the press brings the Timeline back first.
    await page.getByRole("button", { name: "Dossier" }).click();
    await page.getByRole("button", { name: "Log interaction" }).click();
    await expect(page.getByRole("textbox", { name: "Note" })).toBeFocused();
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
      page.getByRole("button", { name: "Logged meeting" }),
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
