/**
 * Settings with hundreds of contacts: the long lists, the Tracked filters,
 * and pages that open with no "Loading…".
 *
 * The Duplicates picker and the Enrichment list drew every contact. On 5,824
 * contacts, Manual merge took 44 s to show and Enrichment 44 s to open, and
 * going back to Scan kept the merge list on screen. The lists now draw only
 * the rows in view (`VirtualRows`), past 200 rows, so this spec runs its own
 * instance with 450 contacts: the shared one has a dozen, which never
 * reaches that path, and other specs count its people.
 *
 * 1. Manual merge draws a few dozen rows of 450, reaches the last by
 *    scrolling, picks two, and Scan comes back at once.
 * 2. Enrichment draws a few dozen rows in its box, reaches the last, and
 *    Select all still covers all 450.
 * 3. The Tracked page's two rows of pills narrow the list, the choices stay
 *    in the address, and Back from a contact returns to the same list.
 * 4. A settings page whose code has loaded opens from the settings list
 *    with no "Loading…" (React held it behind that for 300 ms).
 */
import { test, expect, type Page } from "@playwright/test";
import { ContrackInstance } from "./fixtures/instance";
import { expectPageAccessible } from "./fixtures/a11y";

const TOTAL = 450;
/** Not tracked, and met in the last month: the people worth tracking. */
const MET_THIS_MONTH = 12;
/** Tracked, and met 40 days ago. */
const TRACKED = 5;

const name = (i: number) => `Long List ${String(i).padStart(3, "0")}`;

/**
 * Whole days before now, to the minute.
 *
 * The list says "spoke 3 days ago" by rounding the time since. A fixed hour
 * of the day, 10:00 UTC, made "3 days ago" 3.5 days after 22:00 UTC, so the
 * test read "4 days ago" for two hours of every day.
 */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000 - 60_000).toISOString();
}

let instance: ContrackInstance;

// One worker for the file, in order, so the 450 contacts are written once.
// "default" and not "serial": a failure does not skip the tests after it.
test.describe.configure({ mode: "default" });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  instance = await ContrackInstance.start({
    authRequired: false,
    env: { DISABLE_BACKGROUND_JOBS: "true" },
  });
  const ids: string[] = [];
  for (let start = 0; start < TOTAL; start += 25) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(25, TOTAL - start) }, (_, k) =>
        instance.api<{ id: string }>("POST", "/contacts", {
          name: name(start + k),
          company: `Company ${(start + k) % 17}`,
        }),
      ),
    );
    ids.push(...batch.map((c) => c.id));
  }
  for (let i = 0; i < MET_THIS_MONTH + TRACKED; i++) {
    await instance.api("POST", `/contacts/${ids[i]}/interactions`, {
      type: "call",
      title: "Catch-up",
      content: "Spoke about the plan",
      date: daysAgoIso(i < MET_THIS_MONTH ? 3 + i : 40),
    });
  }
  for (let i = MET_THIS_MONTH; i < MET_THIS_MONTH + TRACKED; i++) {
    await instance.api("PATCH", `/contacts/${ids[i]}`, { isTracked: true });
  }
});

test.afterAll(async () => {
  await instance?.stop();
});

test.use({ viewport: { width: 1440, height: 900 } });

/** A fresh page on this spec's instance. */
async function open(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({
    baseURL: instance.baseURL,
    viewport: { width: 1440, height: 900 },
  });
  return context.newPage();
}

/** The rows a virtual list has drawn, and the index of the last one. */
const drawn = (page: Page, within: string) =>
  page.evaluate((selector) => {
    const root = document.querySelector(selector)!;
    const rows = [...root.querySelectorAll("[data-index]")];
    return {
      count: rows.length,
      last: Math.max(...rows.map((r) => Number(r.getAttribute("data-index")))),
    };
  }, within);

test("Manual merge draws only the rows in view of 450, reaches the last, and Scan comes back at once", async ({
  browser,
}) => {
  const page = await open(browser);
  await page.goto("/settings/duplicates");
  await page.getByRole("radio", { name: "Manual merge" }).click();
  const search = page.getByRole("textbox", {
    name: "Search contacts to merge",
  });
  await expect(search).toBeVisible();
  await expect(page.getByText(`${TOTAL} contacts`)).toBeVisible();

  const top = await drawn(page, ".settings-stage");
  expect(top.count).toBeGreaterThan(0);
  expect(top.count).toBeLessThan(60);

  // The page's one scroller, to its end: the last contact is drawn and in
  // view, under the search, which stays stuck to the top.
  await page.evaluate(() => {
    const input = document.querySelector(
      'input[aria-label="Search contacts to merge"]',
    )!;
    const scroller = input.closest(".overflow-y-auto")!;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await expect(page.locator(`[data-index="${TOTAL - 1}"]`)).toBeInViewport();
  expect((await drawn(page, ".settings-stage")).count).toBeLessThan(60);
  await expect(search).toBeInViewport();

  // Picking works on the drawn rows, and Compare counts them.
  await page
    .locator(`[data-index="${TOTAL - 1}"] button`)
    .first()
    .click();
  await page
    .locator(`[data-index="${TOTAL - 2}"] button`)
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: /Compare 2 contacts/ }),
  ).toBeEnabled();

  // Back to Scan: the three scans are here, and the merge list is gone.
  await page.evaluate(() => {
    const input = document.querySelector(
      'input[aria-label="Search contacts to merge"]',
    )!;
    input.closest(".overflow-y-auto")!.scrollTop = 0;
  });
  await page.getByRole("radio", { name: "Scan", exact: true }).click();
  await expect(page.getByRole("radio", { name: /^Quick scan/ })).toBeVisible();
  await expect(search).toHaveCount(0);
  await expect(page.locator("[data-index]")).toHaveCount(0);
  await page.context().close();
});

test("Enrichment draws only the rows in its box, reaches the last, and Select all covers every contact", async ({
  browser,
}) => {
  const page = await open(browser);
  await page.goto("/settings/enrichment");
  await expect(page.getByText(new RegExp(`^${TOTAL} contacts$`))).toBeVisible();
  const box = ".max-h-\\[360px\\]";
  const top = await drawn(page, box);
  expect(top.count).toBeGreaterThan(0);
  expect(top.count).toBeLessThan(60);

  await page.locator(box).evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    page.locator(`${box} [data-index="${TOTAL - 1}"]`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Select all" }).click();
  await expect(
    page.getByRole("button", {
      name: `Start enrichment (${TOTAL} selected)`,
    }),
  ).toBeVisible();

  // Leaving is as quick as arriving: the next page is up.
  await page.locator("nav a[href='/settings/tags']").click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tags" }),
  ).toBeVisible();
  await page.context().close();
});

test("the Tracked filters narrow the list, stay in the address, and Back returns to them", async ({
  browser,
}, testInfo) => {
  const page = await open(browser);
  await page.goto("/settings/tracked");
  const tracking = page.getByRole("group", { name: "Tracking" });
  const spoke = page.getByRole("group", { name: "Last spoke" });
  await expect(tracking.getByRole("button", { name: /^All/ })).toHaveText(
    `All${TOTAL}`,
  );
  await expect(tracking.getByRole("button", { name: /^Tracked/ })).toHaveText(
    `Tracked${TRACKED}`,
  );

  await tracking.getByRole("button", { name: /^Not tracked/ }).click();
  await spoke.getByRole("button", { name: /^Past month/ }).click();
  await expect(page).toHaveURL(/tracking=not_tracked&spoke=month/);
  const notTracked = page.getByRole("heading", {
    level: 2,
    name: /^Not tracked/,
  });
  await expect(notTracked).toHaveText(new RegExp(`${MET_THIS_MONTH}$`));
  await expect(
    page.getByRole("heading", { level: 2, name: /^No interactions/ }),
  ).toHaveCount(0);

  // Last spoke first: the one met three days ago leads.
  await page.getByRole("radio", { name: "Last spoke" }).click();
  await expect(page).toHaveURL(/order=spoke/);
  const firstRow = page.locator("[data-contact-id]").first();
  await expect(firstRow).toContainText(name(0));
  await expect(firstRow).toContainText("spoke 3 days ago");
  await expectPageAccessible(page, testInfo, "tracked-filters");

  // A contact opened from the list comes back to it, filters and all: by
  // the browser's Back, and by the contact page's own Back, which shows
  // below `lg`, where the list is not beside the contact.
  const address =
    /\/settings\/tracked\?tracking=not_tracked&spoke=month&order=spoke$/;
  await firstRow.getByRole("link", { name: name(0) }).click();
  await expect(page).toHaveURL(/\/contact\//);
  await page.goBack();
  await expect(page).toHaveURL(address);

  await page.setViewportSize({ width: 900, height: 900 });
  await page
    .locator("[data-contact-id]")
    .first()
    .getByRole("link", { name: name(0) })
    .click();
  await page.getByRole("button", { name: "Back to Tracked contacts" }).click();
  await expect(page).toHaveURL(address);
  await expect(
    spoke.getByRole("button", { name: /^Past month/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.context().close();
});

test("a settings page with its code loaded opens from the list with no Loading", async ({
  browser,
}) => {
  const page = await open(browser);
  await page.goto("/settings");
  const tags = page.locator("nav a[href='/settings/tags']");
  await expect(tags).toBeVisible();
  // Pointing at the link loads the page's code (`warm.ts`).
  await tags.hover();
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => /\/TagsPage-[^/]*\.js$/.test(entry.name)),
  );
  // Note any "Loading…" the move draws, however short.
  await page.evaluate(() => {
    const w = window as unknown as { sawLoading: boolean };
    w.sawLoading = false;
    new MutationObserver(() => {
      if (document.body.innerText.includes("Loading…")) w.sawLoading = true;
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  await tags.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tags" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { sawLoading: boolean }).sawLoading,
    ),
  ).toBe(false);
  await page.context().close();
});
