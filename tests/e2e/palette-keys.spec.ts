/**
 * The palette's keys: the arrows move the highlight, Enter opens it, and
 * Escape steps back one layer at a time. Each test pins one of these:
 * - ↑ on an empty input does not fill it with the last search.
 * - When the server's people replace the instant ones, a row stays
 *   highlighted, Enter opens it, and the input names it for a screen reader
 *   before any arrow key.
 * - Escape clears the text first, and closes a facet's suggestions.
 * - A one-line `>` action shows a row, so Enter logs it.
 * - A press on a heading keeps the focus in the input.
 * - Escape in the note composer moves the focus off the dialog.
 * - Back from the actions menu, the highlight returns to its row.
 * - Home and End move the caret, not the highlight.
 *
 * The quick interaction test holds that shortcut to closing the palette,
 * because Escape only clears the text.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import type { ContrackInstance } from "./fixtures/instance";

/** What the current test wrote, as the API path that deletes it. */
const created: { instance: ContrackInstance; path: string }[] = [];

test.afterEach(async () => {
  while (created.length > 0) {
    const { instance, path } = created.pop()!;
    await instance.api("DELETE", path);
  }
});

/** Open the palette on the people list, with its combobox focused. */
async function openPalette(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("combobox")).toBeFocused();
  return palette;
}

/** The highlighted rows, by their text. One, or none when the bug is back. */
const highlighted = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[cmdk-item][aria-selected="true"]')].map(
      (row) => row.textContent?.trim() ?? "",
    ),
  );

/** Where the highlight is in the list: its index among the rows. */
const highlightIndex = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[cmdk-item]")].findIndex(
      (row) => row.getAttribute("aria-selected") === "true",
    ),
  );

/**
 * The input names the highlighted row for a screen reader. cmdk left it
 * out on open, after typing and after the server's answer.
 */
const namesHighlightedRow = (page: Page) =>
  page.evaluate(() => {
    const input = document.querySelector("[cmdk-input]");
    const row = document.querySelector('[cmdk-item][aria-selected="true"]');
    return !!row?.id && input?.getAttribute("aria-activedescendant") === row.id;
  });

test("↓ then ↑ in the empty palette moves the highlight and keeps the input empty", async ({
  page,
  instance,
}) => {
  // A recent search, which ↑ must not bring back into the input.
  const { entry } = await instance.api<{ entry: { id: string } }>(
    "POST",
    "/search/history",
    { query: "zz recent search", mode: "palette" },
  );
  created.push({ instance, path: `/search/history/${entry.id}` });

  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await expect(palette.getByText("zz recent search")).toBeVisible();
  await expect.poll(() => highlightIndex(page)).toBe(0);
  await expect.poll(() => namesHighlightedRow(page)).toBe(true);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => highlightIndex(page)).toBe(2);

  await page.keyboard.press("ArrowUp");
  await expect.poll(() => highlightIndex(page)).toBe(1);
  await expect(input).toHaveValue("");

  // At the top, ↑ stays there. It does not fill the input either.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => highlightIndex(page)).toBe(0);
  await expect(input).toHaveValue("");
  await expect(palette.getByText("Go to")).toBeVisible();
});

test("a row stays highlighted when the server's people replace the instant ones", async ({
  page,
}) => {
  const palette = await openPalette(page);

  // The server's answer leaves out the row the instant list highlighted,
  // as it does whenever the two rank or match differently. A row's value
  // starts with its contact's id.
  let dropped = "";
  await page.route(
    (url) => url.pathname === "/api/search",
    async (route) => {
      const response = await route.fetch();
      const people = (await response.json()) as { id: string }[];
      const value = await page.evaluate(
        () =>
          document
            .querySelector('[cmdk-item][aria-selected="true"]')
            ?.getAttribute("data-value") ?? "",
      );
      dropped = value;
      await route.fulfill({
        response,
        json: people.filter((p) => !value.startsWith(p.id)),
      });
    },
  );

  await page.keyboard.type("a");
  await expect.poll(() => dropped).not.toBe("");
  await expect(
    page.locator(`[cmdk-item][data-value="${dropped}"]`),
  ).toHaveCount(0);
  await expect.poll(() => highlighted(page)).toHaveLength(1);
  await expect.poll(() => namesHighlightedRow(page)).toBe(true);

  // Enter opens the row that is highlighted now.
  const [top] = await highlighted(page);
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page).toHaveURL(/\/contact\//);
  expect(top).not.toBe("");
});

test("Escape clears the input first, and closes the empty palette", async ({
  page,
}) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");

  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(palette.getByText("Go to")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("Escape clears a facet pill with the text", async ({ page }) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");

  await page.keyboard.type("company:Acme ");
  const pill = palette.getByRole("button", { name: /Remove filter company/ });
  await expect(pill).toBeVisible();
  // The typed facet leaves the box once it is a pill.
  await expect(input).toHaveValue("");

  await page.keyboard.press("Escape");
  await expect(pill).toBeHidden();
  await expect(input).toHaveValue("");
  await expect(palette).toHaveCount(1);
});

test("Escape closes a facet's suggestions, then clears, then closes", async ({
  page,
}) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");

  await page.keyboard.type("contacted:");
  const suggestions = palette.getByText("contacted values");
  await expect(suggestions).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(suggestions).toBeHidden();
  await expect(input).toHaveValue("contacted:");
  // No page rows under a half-typed facet: Enter here went to Network.
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(1);
  await expect(page).toHaveURL(/\/$/);

  // Typing more brings them back.
  await page.keyboard.type("n");
  await expect(suggestions).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(suggestions).toBeHidden();

  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("");

  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
});

test("the quick interaction shortcut closes a palette that holds text", async ({
  page,
}) => {
  const palette = await openPalette(page);
  await page.keyboard.type("Ada");
  await expect(palette.getByText("Ada Lovelace")).toBeVisible();

  await page.keyboard.press("Control+Alt+KeyI");
  await expect(
    page.getByRole("dialog", { name: "Log an interaction" }),
  ).toBeVisible();
  await expect(page.locator("[cmdk-dialog]")).toHaveCount(0);
});

test("a one-line action logs the note it shows", async ({
  page,
  instance,
  seed,
}) => {
  // cmdk's fuzzy filter scored the row's value against the whole input and
  // hid it, so Enter logged nothing.
  const palette = await openPalette(page);
  await page.keyboard.type("> note Edsger: zz sent the deck");
  const row = palette.getByRole("option", {
    name: /Log note for Edsger Dijkstra/,
  });
  await expect(row).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);

  const edsger = seed.byName("Edsger Dijkstra");
  const timeline = await instance.api<{ id: string; content: string }[]>(
    "GET",
    `/contacts/${edsger.id}/timeline`,
  );
  const logged = timeline.find((item) => item.content === "zz sent the deck");
  expect(logged).toBeDefined();
  created.push({ instance, path: `/interactions/${logged!.id}` });
});

test("a press on the palette keeps its keys from the page behind", async ({
  page,
}) => {
  // A press on a heading took the focus from the input, and then `j` on
  // the Network page opened a contact under the open palette.
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await palette.getByText("Go to", { exact: true }).click();
  await expect(input).toBeFocused();

  await page.keyboard.press("j");
  await expect(input).toHaveValue("j");
  await expect(page).toHaveURL(/\/$/);
});

test("Escape in the note composer goes back to the actions, with the input focused", async ({
  page,
}) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(palette.getByText("Log note")).toBeVisible();
  await page.keyboard.press("n");
  const note = palette.locator("textarea");
  await expect(note).toBeFocused();
  // Its own keys: cmdk took Enter, so a note had one line.
  await page.keyboard.type("met");
  await page.keyboard.press("Enter");
  await page.keyboard.type("again");
  await expect(note).toHaveValue("met\nagain");

  await page.keyboard.press("Escape");
  await expect(palette.getByText("Log note")).toBeVisible();
  await expect(input).toBeFocused();
});

test("→ then Escape keeps the highlight on the row the actions opened from", async ({
  page,
  instance,
}) => {
  // The actions menu takes the rows' place. cmdk re-checks only the last
  // row to go, so when that was the highlighted one it forgot the
  // highlight, and back from the menu it sat on the top row. Two people
  // of this test's own, so the highlighted row is the last one: the exact
  // name leaves out the create row, and no page has the words.
  for (const name of ["Zara Quill", "Zara Quillon"]) {
    const { id } = await instance.api<{ id: string }>("POST", "/contacts", {
      name,
    });
    created.push({ instance, path: `/contacts/${id}` });
  }
  const palette = await openPalette(page);
  await page.keyboard.type("Zara Quill");
  await expect(
    palette.getByRole("status", { name: "Palette status" }),
  ).toHaveText("2 people found");
  await expect(
    palette.getByRole("option", { name: /^Zara Quill/ }),
  ).toHaveCount(2);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => highlightIndex(page)).toBe(1);
  const [before] = await highlighted(page);

  await page.keyboard.press("ArrowRight");
  const back = palette.getByRole("button", { name: "Back to results" });
  await expect(back).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(back).toBeHidden();
  await expect.poll(() => highlighted(page)).toEqual([before]);
});

test("Home and End move the caret when the box holds text", async ({
  page,
}) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await page.keyboard.type("a");
  // Once the server's people are in, so the highlighted row stays.
  await expect(
    palette.getByRole("status", { name: "Palette status" }),
  ).toHaveText(/people found/);
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => highlightIndex(page)).toBe(1);

  await page.keyboard.press("Home");
  await expect
    .poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart))
    .toBe(0);
  await page.keyboard.press("End");
  await expect
    .poll(() => input.evaluate((el: HTMLInputElement) => el.selectionStart))
    .toBe(1);
  expect(await highlightIndex(page)).toBe(1);
});

test("Enter on a focused button runs it, not the highlighted row", async ({
  page,
}) => {
  // cmdk took Enter from every button in the palette and opened the
  // highlighted contact: here, Grace Hopper.
  const palette = await openPalette(page);
  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();
  await palette.getByRole("button", { name: "? Ask AI" }).focus();
  await page.keyboard.press("Enter");
  await expect(palette.getByRole("combobox")).toHaveValue("? Grace");
  await expect(page).toHaveURL(/\/$/);
});

test("closing gives the focus back, and ⌘K closes the palette empty", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  const pulse = page.getByRole("link", { name: "Pulse" }).first();
  await pulse.focus();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await page.keyboard.type("Grace");
  // ⌘K hid the palette with its text, and brought it back next time.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toHaveCount(0);
  await expect(pulse).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette.getByRole("combobox")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(pulse).toBeFocused();
});

test("the actions and the list picker work by keyboard, and say where they are", async ({
  page,
  instance,
}) => {
  const { id } = await instance.api<{ id: string }>("POST", "/lists", {
    name: "zz palette list",
    icon: "star",
  });
  created.push({ instance, path: `/lists/${id}` });
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  const points = async (label: string, row: RegExp) => {
    await expect(input).toHaveAttribute(
      "aria-controls",
      (await palette.getByRole("listbox", { name: label }).getAttribute("id"))!,
    );
    const current = palette.getByRole("option", { name: row });
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      (await current.getAttribute("id"))!,
    );
  };
  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();

  // A screen reader hears each action, which plain buttons would not give.
  await page.keyboard.press("ArrowRight");
  await points("Actions for Grace Hopper", /^View profile/);
  await expect(
    palette.getByRole("status", { name: "Palette status" }),
  ).toHaveText("Actions for Grace Hopper");
  await page.keyboard.press("ArrowDown");
  await points("Actions for Grace Hopper", /^Log note/);

  // The picker skipped every key from the search box, which has the focus.
  await page.keyboard.press("l");
  const list = palette.getByRole("option", { name: /zz palette list/ });
  await expect(list).toBeVisible();
  for (let i = 0; i < 20; i++) {
    if ((await list.getAttribute("aria-selected")) === "true") break;
    await page.keyboard.press("ArrowDown");
  }
  await points("Lists for Grace Hopper", /zz palette list/);
  await page.keyboard.press("Enter");
  await expect(
    page.getByText('Added Grace Hopper to "zz palette list"'),
  ).toBeVisible();
});

test("the facet values say which value the arrows are on", async ({ page }) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await page.keyboard.type("contacted:");
  const first = palette.getByRole("option", { name: /Within 30 days/ });
  await expect(input).toHaveAttribute(
    "aria-activedescendant",
    (await first.getAttribute("id"))!,
  );
  // Not "No people found" while a value is picked.
  await expect(
    palette.getByRole("status", { name: "Palette status" }),
  ).toHaveText("");
});

test("the focus stays in the box when its button goes away", async ({
  page,
}) => {
  // Back to results and a pill's × went away with their focus, and the
  // focus went to the dialog: the arrows and the letters did nothing.
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await palette.getByRole("button", { name: "Back to results" }).focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();

  await page.keyboard.press("Escape");
  await page.keyboard.type("company:Acme ");
  await palette.getByRole("button", { name: /Remove filter company/ }).focus();
  await page.keyboard.press("Enter");
  await expect(input).toBeFocused();
});

test("⌘K closes the palette from the note composer too", async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type("Grace");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("n");
  await expect(palette.locator("textarea")).toBeFocused();
  await page.keyboard.press("ControlOrMeta+k");
  await expect(palette).toHaveCount(0);
});

test("leaving for a page does not send the focus back to the opener", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  const pulse = page.getByRole("link", { name: "Pulse" }).first();
  await pulse.focus();
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("Grace");
  await expect(
    page.getByRole("option", { name: /^Grace Hopper/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/contact\//);
  await expect(pulse).not.toBeFocused();
});
