/**
 * The palette's people search: what the server finds, the palette shows.
 *
 * The server's keyword search matches a company, a nickname, a misspelled
 * name and the digits of a phone number. The palette used to run cmdk's own
 * fuzzy filter over the rows it got back. That filter reads only a row's id
 * and name, so it hid all four. Facets are the other half: `list:` and
 * `contacted:` narrow the people in the palette, and on the server once
 * there is text as well.
 *
 * The contacts and the list this spec writes start with Z, so they sort
 * after the seeded people, and each is deleted after its test, as in
 * contact.spec.ts.
 */
import type { Page } from "@playwright/test";
import type AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/test";
import type { ContrackInstance } from "./fixtures/instance";
import { expectPageAccessible } from "./fixtures/a11y";

/** What the current test wrote, as the API path that deletes it. */
const created: { instance: ContrackInstance; path: string }[] = [];

test.afterEach(async () => {
  while (created.length > 0) {
    const { instance, path } = created.pop()!;
    await instance.api("DELETE", path);
  }
});

async function ownContact(
  instance: ContrackInstance,
  body: Record<string, unknown>,
): Promise<string> {
  const { id } = await instance.api<{ id: string }>("POST", "/contacts", body);
  created.push({ instance, path: `/contacts/${id}` });
  return id;
}

/** Open the palette on the people list, with its combobox focused. */
async function openPalette(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Ada Lovelace")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("combobox")).toBeFocused();
  return palette;
}

const person = (palette: ReturnType<Page["getByRole"]>, name: string) =>
  palette.getByRole("option", { name: new RegExp(name) });

/**
 * The scan for the parts this spec covers: the pills, the input, the facet
 * presets and the footer. The result list and the ESC hint are left out.
 * They fail three rules this spec did not cause, and no spec scanned the
 * open palette before: the ESC hint sits at half opacity (2.6:1), each
 * person row nests an actions button inside its option, and the list with
 * no rows is an empty listbox. The pull request that added this spec lists
 * them.
 */
const paletteParts = (b: AxeBuilder) =>
  b.include('[role="dialog"]').exclude("[cmdk-list]").exclude("kbd");

test("shows a person the server finds by company", async ({ page }) => {
  const palette = await openPalette(page);
  await page.keyboard.type("Babbage");
  await expect(person(palette, "Ada Lovelace")).toBeVisible();
});

test("shows a phone number's contact when only its digits are typed", async ({
  page,
  instance,
}) => {
  await ownContact(instance, {
    name: "Zed Dialer",
    phones: ["+1 (415) 555-0142"],
  });
  const palette = await openPalette(page);
  await page.keyboard.type("4155550142");
  await expect(person(palette, "Zed Dialer")).toBeVisible();
});

test("shows the formal name for a nickname and for a misspelling", async ({
  page,
  instance,
}) => {
  await ownContact(instance, { name: "Zachary Wexford" });
  const palette = await openPalette(page);
  await page.keyboard.type("Zack Wexford");
  await expect(person(palette, "Zachary Wexford")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Zachary Wexferd");
  await expect(person(palette, "Zachary Wexford")).toBeVisible();
});

test("narrows the people to a list with list:", async ({
  page,
  instance,
  seed,
}, testInfo) => {
  const { id } = await instance.api<{ id: string }>("POST", "/lists", {
    name: "Zeta Circle",
    icon: "star",
  });
  created.push({ instance, path: `/lists/${id}` });
  for (const name of ["Ada Lovelace", "Grace Hopper"])
    await instance.api("POST", `/lists/${id}/members`, {
      contactId: seed.byName(name).id,
    });

  const palette = await openPalette(page);
  await page.keyboard.type("list:zeta-circle ");
  await expect(person(palette, "Ada Lovelace")).toBeVisible();
  await expect(person(palette, "Grace Hopper")).toBeVisible();
  await expect(person(palette, "Katherine Johnson")).toHaveCount(0);

  // Text with the pill goes to the server, which applies the list in SQL.
  await page.keyboard.type("grace");
  await expect(person(palette, "Grace Hopper")).toBeVisible();
  await expect(person(palette, "Ada Lovelace")).toHaveCount(0);
  await expectPageAccessible(
    page,
    testInfo,
    "palette-list-facet",
    paletteParts,
  );
});

test("offers the contacted: presets and narrows to recent contacts", async ({
  page,
}, testInfo) => {
  const palette = await openPalette(page);
  await page.keyboard.type("contacted:");
  await expect(page.getByText("Within 30 days")).toBeVisible();
  await expect(page.getByText("Over 90 days ago, or never")).toBeVisible();
  await expectPageAccessible(
    page,
    testInfo,
    "palette-contacted-presets",
    paletteParts,
  );

  // The first preset: last contact within 30 days.
  await page.keyboard.press("Enter");
  await expect(palette.getByText("contacted:")).toBeVisible();
  await expect(person(palette, "Katherine Johnson")).toBeVisible();
  await expect(person(palette, "Ada Lovelace")).toBeVisible();
  await expect(person(palette, "Edsger Dijkstra")).toHaveCount(0);
});

// Palette B, "Catch me up", opened the contact with `?brief=1`, and nothing
// read the flag: the contact opened on its Timeline. The page now opens the
// Dossier with focus on the Briefing card, and the flag leaves the address.
test("B on a result opens the contact on its Briefing card", async ({
  page,
  seed,
}) => {
  const palette = await openPalette(page);
  // By name: → opens the actions of a person the palette found by name.
  await page.keyboard.type("Ada Lovelace");
  await expect(person(palette, "Ada Lovelace")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    palette.getByRole("button", { name: "Back to results" }),
  ).toBeVisible();
  await page.keyboard.press("b");

  await expect(page).toHaveURL(
    new RegExp(`/contact/${seed.byName("Ada Lovelace").id}$`),
  );
  await expect(page.getByRole("radio", { name: "Dossier" })).toBeChecked();
  await expect(page.getByRole("region", { name: "Briefing" })).toBeFocused();
});
