/**
 * What the palette offers a person who does not know its syntax yet.
 *
 * - Typing a page's name finds the page. "pulse" used to offer only to
 *   create a contact named "pulse", and every Settings page sat in the
 *   empty palette, 24 rows of them.
 * - `>` leads from the kind to the contact to the text. It showed one block
 *   of syntax help for every partial input.
 * - The mode chips switch modes, so a touch screen can reach `?` and `>`.
 * - The create row comes last, and only when nobody has the name.
 * - A screen reader hears how many people the list holds.
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

async function openPalette(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("combobox")).toBeFocused();
  return palette;
}

const highlighted = (palette: ReturnType<Page["getByRole"]>) =>
  palette.locator('[cmdk-item][aria-selected="true"]');

test("a page's name finds the page, ahead of a new contact by that name", async ({
  page,
}) => {
  const palette = await openPalette(page);
  await page.keyboard.type("pulse");
  await expect(highlighted(palette)).toHaveText(/^Pulse/);
  await expect(
    palette.getByRole("option", { name: 'Create contact "pulse"' }),
  ).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page).toHaveURL(/\/pulse$/);
});

test("a Settings page comes up by a word it is known by, not before", async ({
  page,
}) => {
  const palette = await openPalette(page);
  await expect(palette.getByText("Go to")).toBeVisible();
  await expect(
    palette.getByRole("option", { name: /^Settings: / }),
  ).toHaveCount(0);

  await page.keyboard.type("backup");
  await expect(
    palette.getByRole("option", { name: /^Settings: / }).first(),
  ).toBeVisible();
});

test("> leads from the kind to the contact to the text, and logs it", async ({
  page,
  instance,
  seed,
}) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");

  await page.keyboard.type(">");
  await expect(
    palette.getByRole("option", { name: /Log a call/ }),
  ).toBeVisible();
  await expect(highlighted(palette)).toHaveText(/Log a note/);
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("> note ");

  await page.keyboard.type("eds");
  await expect(highlighted(palette)).toHaveText("Edsger Dijkstra");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("> note Edsger Dijkstra: ");

  await page.keyboard.type("zz walked through the deck");
  await expect(highlighted(palette)).toHaveText(/Log note for Edsger Dijkstra/);
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);

  const edsger = seed.byName("Edsger Dijkstra");
  const timeline = await instance.api<{ id: string; content: string }[]>(
    "GET",
    `/contacts/${edsger.id}/timeline`,
  );
  const logged = timeline.find(
    (item) => item.content === "zz walked through the deck",
  );
  expect(logged).toBeDefined();
  created.push({ instance, path: `/interactions/${logged!.id}` });
});

test("> says when no contact has the name", async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type("> call zzz nobody: hello");
  await expect(
    palette.getByText('No contact matches "zzz nobody"'),
  ).toBeVisible();
  await expect(palette.getByRole("option")).toHaveCount(0);
});

test("the mode chips switch modes and keep the words", async ({ page }) => {
  const palette = await openPalette(page);
  const input = palette.getByRole("combobox");
  const chips = palette.getByRole("group", { name: "Mode" });

  await page.keyboard.type("who is in Berlin");
  await chips.getByRole("button", { name: "? Ask AI" }).click();
  await expect(input).toHaveValue("? who is in Berlin");
  await expect(input).toBeFocused();
  await expect(chips.getByRole("button", { name: "? Ask AI" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await chips.getByRole("button", { name: "Search" }).click();
  await expect(input).toHaveValue("who is in Berlin");

  await chips.getByRole("button", { name: "> Log" }).click();
  await expect(input).toHaveValue("> ");
  await expect(
    palette.getByRole("option", { name: /Log a note/ }),
  ).toBeVisible();
});

test("the create row comes last, and not for a name somebody has", async ({
  page,
}) => {
  const palette = await openPalette(page);
  await page.keyboard.type("Grace Hoppe");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();
  const create = palette.getByRole("option", { name: /^Create contact/ });
  await expect(create).toBeVisible();
  await expect(palette.getByRole("option").last()).toHaveText(
    /^Create contact/,
  );

  await page.keyboard.type("r");
  await expect(palette.getByText("Grace Hopper")).toBeVisible();
  await expect(create).toHaveCount(0);
});

test("a screen reader hears how many people the list holds", async ({
  page,
}) => {
  const palette = await openPalette(page);
  const status = palette.getByRole("status", { name: "Palette status" });
  await expect(status).toHaveText("");

  await page.keyboard.type("Grace");
  await expect(status).toHaveText("1 person found");

  await page.keyboard.type(" zzqx");
  await expect(status).toHaveText("No people found");
});

test("pills alone list people, with the top row and its heading in view", async ({
  page,
}) => {
  // While a facet was half typed, the five destinations were the only rows
  // and one was highlighted. Once the pill locked they stayed under the
  // people, and cmdk scrolled to the destination it had chosen, past the
  // top row it no longer highlighted.
  const palette = await openPalette(page);
  await page.keyboard.type("location:London ");
  await expect(
    palette.getByRole("button", { name: /Remove filter location/ }),
  ).toBeVisible();
  await expect(palette.getByText("Ada Lovelace")).toBeVisible();
  await expect(palette.getByText("Go to")).toHaveCount(0);
  await expect(highlighted(palette)).toHaveText(/Ada Lovelace/);
  await expect(
    palette.locator("[cmdk-group-heading]").first(),
  ).toBeInViewport();
  expect(
    await palette.locator("[cmdk-list]").evaluate((list) => list.scrollTop),
  ).toBe(0);
});
