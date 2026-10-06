/**
 * Possible duplicates, end to end, in the built app.
 *
 * 1. One check from Settings says what it did and fills the one review list.
 * 2. The list is in three parts, the easy decisions first, and a caveat is
 *    on its row.
 * 3. The contact chosen to keep is the one a key merge keeps, and the
 *    message's Undo takes the merge back.
 * 4. Keep separate holds, and Merge history lists an automatic merge with
 *    its own Undo.
 * 5. On a phone, a group opens in a sheet with its two buttons.
 *
 * Every person here is made up, on this spec's own instance.
 */
import { test, expect, type Page } from "@playwright/test";
import { ContrackInstance } from "./fixtures/instance";
import { expectPageAccessible } from "./fixtures/a11y";

let instance: ContrackInstance;

test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  instance = await ContrackInstance.start({
    authRequired: false,
    env: { DISABLE_BACKGROUND_JOBS: "true" },
  });
  const add = (body: object) => instance.api("POST", "/contacts", body);
  // Check carefully: one number, two first names.
  await add({ name: "Ada Quill", phones: ["+1 212 555 0199"] });
  await add({ name: "Ben Quill", phones: ["(212) 555-0199"] });
  // Likely: a nickname at one company.
  await add({ name: "Robert Halvorsen", company: "Fabrikam" });
  await add({ name: "Bob Halvorsen", company: "Fabrikam" });
  // Very likely: the same name and nothing against it.
  await add({ name: "Imani Okoro", location: "Lagos" });
  await add({ name: "Imani Okoro", emails: ["imani@okoro.example"] });
  // Merged by the check itself: one profile link, written two ways.
  await add({
    name: "Priya Raman",
    socialLinks: [
      {
        url: "https://www.linkedin.com/in/priya-raman-42",
        platform: "linkedin",
      },
    ],
  });
  await add({
    name: "Priya R.",
    socialLinks: [
      { url: "https://linkedin.com/in/priya-raman-42/", platform: "linkedin" },
    ],
  });
});

test.afterAll(async () => {
  await instance?.stop();
});

async function open(
  browser: import("@playwright/test").Browser,
  viewport = { width: 1440, height: 900 },
): Promise<Page> {
  const context = await browser.newContext({
    baseURL: instance.baseURL,
    viewport,
  });
  return context.newPage();
}

test("a check fills the review list, and the contact chosen is the one a key keeps, with Undo", async ({
  browser,
}, testInfo) => {
  const page = await open(browser);

  // 1. One check, and what it did.
  await page.goto("/settings/duplicates");
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(/^Checked 8 contacts/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "1 merged automatically" }),
  ).toBeVisible();
  await expect(page.getByText("3 possible duplicates to review")).toBeVisible();
  // One main button: the callout's Review them, over the card.
  await page.getByRole("link", { name: "Review them" }).click();
  await expect(page).toHaveURL(/\/pulse\/duplicates$/);

  // 2. Three parts, and the caveat on its row.
  for (const part of ["Very likely", "Likely", "Check carefully"]) {
    await expect(
      page.getByRole("heading", { name: new RegExp(`^${part} \\(1\\)`) }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("First names differ: Ada and Ben").first(),
  ).toBeVisible();
  await expectPageAccessible(page, testInfo, "duplicates-review");

  // 3. Choose the contact to keep, then L from the radio itself.
  await page
    .getByRole("button", { name: /Robert Halvorsen/ })
    .first()
    .click();
  const keep = page.getByRole("radiogroup", { name: "Contact to keep" });
  await keep.getByRole("radio", { name: /Bob Halvorsen/ }).click();
  // An upper-case L, as Caps Lock types it, decides too.
  await page.keyboard.press("L");
  await expect(
    page.getByText("Merged Robert Halvorsen into Bob Halvorsen"),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Likely/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(
    page.getByRole("heading", { name: /^Likely \(1\)/ }),
  ).toBeVisible();

  // 4. A pair to check carefully never merges from one key: L opens its
  // comparison and puts focus on Merge, which names the caution.
  await page
    .getByRole("button", { name: /Ada Quill/ })
    .first()
    .click();
  await page.keyboard.press("l");
  const pane = page.getByRole("region", {
    name: "The group you are looking at",
  });
  await expect(pane.getByRole("button", { name: /^Merge/ })).toBeFocused();
  await expect(
    pane.getByText("Check the differences, then press L again or Enter"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Check carefully \(1\)/ }),
  ).toBeVisible();

  // 5. Keep separate holds.
  await page
    .getByRole("button", { name: /Keep separate/ })
    .last()
    .click();
  await expect(
    page.getByText("Kept Ada Quill and Ben Quill separate"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Check carefully/ }),
  ).toHaveCount(0);

  // Merge history: the check's own merge, with its Undo.
  await page.getByRole("radio", { name: "Merge history" }).click();
  await expect(page).toHaveURL(/view=merged/);
  await expect(page.getByText("Merged automatically").first()).toBeVisible();
  // Which of the two the check kept is its own choice.
  await page.getByRole("button", { name: /Undo the merge of Priya/ }).click();
  await expect(page.getByText(/^Restored Priya/)).toBeVisible();
  await expect(page.getByText("Undone").first()).toBeVisible();
  await page.context().close();
});

test("on a phone, a group opens in a sheet with its two buttons", async ({
  browser,
}, testInfo) => {
  // Its own check, so it stands without the test above.
  await instance.api("POST", "/dedupe/scan", { mode: "quick" });
  await expect
    .poll(
      async () =>
        (
          await instance.api<{ count: number }>(
            "GET",
            "/dedupe/suggestions/count",
          )
        ).count,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  const page = await open(browser, { width: 390, height: 844 });
  await page.goto("/pulse/duplicates");
  const firstRow = page.getByRole("listitem").first();
  await expect(firstRow).toBeVisible();
  // Each row decides on its own at this width.
  await expect(firstRow.getByRole("button", { name: /^Merge/ })).toBeVisible();
  await firstRow.getByRole("button").first().click();
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByRole("radiogroup", { name: "Contact to keep" }),
  ).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Merge/ })).toBeInViewport();
  await expectPageAccessible(page, testInfo, "duplicates-sheet-phone");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.context().close();
});
