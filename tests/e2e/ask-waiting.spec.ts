/**
 * Ask Contrack while AI works, and when AI could not check the answer.
 *
 * 1. While AI checks the answer, the page keeps back the local list the
 *    server streams first. A stage says what is happening, and with motion
 *    allowed the corvid leaves the search box and hunts beside and above
 *    the search column, never over the results. The answer calls it home
 *    round the column.
 * 2. A list AI did not check says so once, over the list, and each card
 *    carries an orange question mark in its top right corner. The mark is a
 *    toggletip: a hover, a click, a tap or a keyboard focus opens it, and
 *    Escape or a press elsewhere closes it.
 * 3. The palette shows "Asking AI…" for the whole wait, and marks a list AI
 *    did not check the same way.
 *
 * People searches are answered in the page (fixtures/search): the first
 * chunk at once, and the final answer when the test releases it.
 */
import { devices, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import { expectFloors } from "./fixtures/metrics";
import { docsScreenshotDir } from "./fixtures/paths";
import {
  answerPeopleSearch,
  personMatch,
  releasePeopleSearch,
  streamPeopleSearch,
} from "./fixtures/search";

const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

// docs/screenshots/ask-waiting with DOCS_SCREENSHOTS=1, else test-results.
const SCREENSHOT_DIR = docsScreenshotDir("ask-waiting");

const QUESTION = "Find people interested in AI or machine learning";

const status = (page: Page) =>
  page.getByRole("status", { name: "Search status" });
const stage = (page: Page) => page.getByTestId("searching-stage");
const overlay = (page: Page) => page.locator("[data-corvid-flight]");
/** A result card, by the name it starts with. The mark's name has a colon. */
const card = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name}(?!:)`) });
const mark = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name}: not verified by AI` });
const tipOf = (page: Page, name: string) =>
  page.getByRole("tooltip").filter({ hasText: `${name} matches` });

async function ask(page: Page, question = QUESTION) {
  await page.goto("/search");
  const input = page.getByRole("textbox", {
    name: "Ask anything about your network",
  });
  await input.fill(question);
  await input.press("Enter");
}

/** Where the flying bird's body is now, in viewport px. */
const birdAt = (page: Page) =>
  page.evaluate(() => {
    const holder = document.querySelector("[data-corvid-flight]")
      ?.firstElementChild as HTMLElement | null;
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(
      holder?.style.transform ?? "",
    );
    return m ? [Number(m[1]), Number(m[2])] : null;
  });

/** The element's box lies inside the window, give or take a pixel. */
async function expectInWindow(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

/**
 * The mark sits in the card's top right corner. Both boxes are read in one
 * synchronous step: the coverage row under the search box can arrive late
 * and move the whole list down between two separate reads.
 */
async function expectInCorner(page: Page, name: string) {
  const cardEl = await card(page, name).elementHandle();
  const markEl = await mark(page, name).elementHandle();
  const gap = await page.evaluate(
    ([c, m]) => {
      const cb = c!.getBoundingClientRect();
      const mb = m!.getBoundingClientRect();
      return { right: cb.right - mb.right, top: mb.top - cb.top };
    },
    [cardEl, markEl] as const,
  );
  expect(gap.right).toBeGreaterThanOrEqual(0);
  expect(gap.right).toBeLessThan(24);
  expect(gap.top).toBeGreaterThanOrEqual(0);
  expect(gap.top).toBeLessThan(24);
}

test.describe("the wait for AI", () => {
  test("discards an incomplete answer and retries the same question", async ({
    page,
    seed,
  }) => {
    await page.route("**/api/search/semantic", (route) =>
      route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            phase: "instant",
            matches: [personMatch(seed.byName("Linus Torvalds"))],
            fallback: true,
          }) + "\n",
      }),
    );
    await ask(page);
    await expect(page.getByRole("alert")).toContainText("Search failed");
    await expect(card(page, "Linus Torvalds")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Refresh results" }),
    ).toHaveCount(0);
    await answerPeopleSearch(page, [personMatch(seed.byName("Ada Lovelace"))]);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(card(page, "Ada Lovelace")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(status(page)).toHaveText(`1 match for “${QUESTION}”.`);
  });

  test("describes local search without claiming AI use when AI is off", async ({
    page,
    seed,
  }) => {
    await page.route("**/api/auth/preferences", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          preferences: { ...body.preferences, aiAssist: false },
        },
      });
    });
    await streamPeopleSearch(page, {
      instant: [],
      complete: [personMatch(seed.byName("Ada Lovelace"))],
      fallback: true,
    });
    await ask(page);
    await expect(stage(page)).toContainText(
      "Finding people who fit your question",
    );
    await expect(stage(page)).not.toContainText("AI is checking");
    await releasePeopleSearch(page);
    await expect(card(page, "Ada Lovelace")).toBeVisible();
  });

  test("keeps back the list AI has not checked, and shows AI's answer", async ({
    page,
    seed,
  }, testInfo) => {
    await streamPeopleSearch(page, {
      instant: [personMatch(seed.byName("Linus Torvalds"))],
      complete: [personMatch(seed.byName("Ada Lovelace"))],
    });
    await ask(page);

    await expect(stage(page)).toBeVisible();
    await expect(stage(page)).toContainText("Searching your network…");
    await expect(status(page)).toHaveText(
      `Searching your network for “${QUESTION}”…`,
    );
    // The local list is in the page's hands by now, and stays back.
    await page.waitForTimeout(600);
    await expect(page.getByText("Linus Torvalds")).toHaveCount(0);
    await expect(page.getByText("Enriching with AI…")).toHaveCount(0);
    await expectPageAccessible(page, testInfo, "ask-waiting");

    await releasePeopleSearch(page);
    await expect(card(page, "Ada Lovelace")).toBeVisible();
    await expect(stage(page)).toHaveCount(0);
    await expect(page.getByText("Linus Torvalds")).toHaveCount(0);
    await expect(status(page)).toHaveText(`1 match for “${QUESTION}”.`);
    // AI checked it: no question mark, nothing said about verifying.
    await expect(mark(page, "Ada Lovelace")).toHaveCount(0);
  });

  test("the palette asks AI for the whole wait, then shows the answer", async ({
    page,
    seed,
  }) => {
    await streamPeopleSearch(page, {
      instant: [personMatch(seed.byName("Linus Torvalds"))],
      complete: [personMatch(seed.byName("Grace Hopper"))],
    });
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.type("? who likes espresso");

    await expect(palette.getByText("Asking AI…")).toBeVisible();
    await page.waitForTimeout(900);
    await expect(palette.getByText("Asking AI…")).toBeVisible();
    await expect(
      palette.getByRole("option", { name: /Linus Torvalds/ }),
    ).toHaveCount(0);

    await releasePeopleSearch(page);
    await expect(
      palette.getByRole("option", { name: /Grace Hopper/ }),
    ).toBeVisible();
    await expect(palette.getByText("Asking AI…")).toHaveCount(0);
    await expect(
      palette.getByRole("img", { name: "Not verified by AI" }),
    ).toHaveCount(0);
  });
});

test.describe("the bird while AI works", () => {
  test.use({ reducedMotion: "no-preference" });

  test("stops the flight when Notes replaces the search box", async ({
    page,
    seed,
  }) => {
    await streamPeopleSearch(page, {
      instant: [],
      complete: [personMatch(seed.byName("Ada Lovelace"))],
    });
    await ask(page);
    await expect(overlay(page)).toHaveCount(1);
    const modes = page.getByRole("radiogroup", { name: "What to search" });
    await modes.getByRole("radio", { name: "Notes", exact: true }).click();
    await expect(overlay(page)).toHaveCount(0);
    await releasePeopleSearch(page);
    await modes.getByRole("radio", { name: "People", exact: true }).click();
    await expect(card(page, "Ada Lovelace")).toBeVisible();
    await expect(page.locator('form[role="search"] [data-bird]')).toHaveCount(
      0,
    );
  });

  test("leaves the search box, hunts beside and above the results but never over them, and comes home round them", async ({
    page,
    seed,
  }) => {
    await streamPeopleSearch(page, {
      instant: [personMatch(seed.byName("Linus Torvalds"))],
      complete: [personMatch(seed.byName("Ada Lovelace"))],
    });
    await ask(page);

    await expect(overlay(page)).toHaveCount(1);
    // The bird in the search box is out: its drawing is hidden, and the
    // flying one is the only bird on the page.
    const boxBird = page.locator('form[role="search"] [data-bird]');
    await expect(boxBird).toHaveCSS("visibility", "hidden");

    // The column is the search box and the results under it, from the
    // box's top down. The bird hunts in the page's margins and the band
    // over the box. Only its takeoff and landing, near the box's bird,
    // cross the column's edge.
    const form = (await page.locator('form[role="search"]').boundingBox())!;
    const perch = await boxBird.evaluate((bird) => {
      const box = bird.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    });
    const clearOfColumn = (at: number[] | null) =>
      !at ||
      Math.hypot(at[0]! - perch[0]!, at[1]! - perch[1]!) < 110 ||
      at[0]! < form.x ||
      at[0]! > form.x + form.width ||
      at[1]! < form.y;

    await page.waitForTimeout(1_200);
    const hunt: (number[] | null)[] = [];
    for (let i = 0; i < 10; i++) {
      hunt.push(await birdAt(page));
      await page.waitForTimeout(250);
    }
    expect(hunt.filter(Boolean).length).toBeGreaterThanOrEqual(8);
    for (const at of hunt) expect(clearOfColumn(at), `${at}`).toBe(true);
    await expect(overlay(page)).toHaveCount(1);

    await releasePeopleSearch(page);
    await expect(card(page, "Ada Lovelace")).toBeVisible();
    // Home by the short way round the column, never across the answer.
    for (let i = 0; i < 60 && (await overlay(page).count()) > 0; i++) {
      const at = await birdAt(page);
      expect(clearOfColumn(at), `home at ${at}`).toBe(true);
      await page.waitForTimeout(100);
    }
    await expect(overlay(page)).toHaveCount(0, { timeout: 6_000 });
    await expect(boxBird).toHaveCount(0);
  });
});

test.describe("a list AI did not check", () => {
  test("keeps a hovered explanation open while the pointer enters it", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(page, [personMatch(seed.byName("Ada Lovelace"))], {
      fallback: true,
    });
    await ask(page);
    const trigger = mark(page, "Ada Lovelace");
    const tip = tipOf(page, "Ada Lovelace");
    for (const height of [900, 360]) {
      await page.setViewportSize({ width: 1280, height });
      await trigger.hover();
      await expect(tip).toBeVisible();
      // Floating UI places the panel asynchronously. Measure only after the
      // first placement, and read both boxes together before moving.
      const side = height === 900 ? "bottom" : "top";
      await expect
        .poll(() =>
          trigger.evaluate((button, side) => {
            const panel = document.getElementById(
              button.getAttribute("aria-describedby")!,
            )!;
            const triggerBox = button.getBoundingClientRect();
            const tipBox = panel.getBoundingClientRect();
            const gap =
              side === "bottom"
                ? tipBox.top - triggerBox.bottom
                : triggerBox.top - tipBox.bottom;
            return (
              Math.abs(gap - 8) < 1 &&
              Math.abs(tipBox.right - triggerBox.right) < 1
            );
          }, side),
        )
        .toBe(true);
      const { triggerBox, tipBox } = await trigger.evaluate((button) => {
        const panel = document.getElementById(
          button.getAttribute("aria-describedby")!,
        )!;
        return {
          triggerBox: button.getBoundingClientRect().toJSON(),
          tipBox: panel.getBoundingClientRect().toJSON(),
        };
      });
      // Cross the gap slowly. A person must be able to move onto a tooltip
      // to read it with a magnifier or to select its text.
      const gapY =
        side === "bottom"
          ? (triggerBox.bottom + tipBox.top) / 2
          : (triggerBox.top + tipBox.bottom) / 2;
      await page.mouse.move(triggerBox.x + triggerBox.width / 2, gapY);
      await expect(tip).toBeVisible();
      await page.mouse.move(
        tipBox.x + tipBox.width / 2,
        side === "bottom" ? tipBox.top + 10 : tipBox.bottom - 10,
        { steps: 12 },
      );
      await expect(tip).toBeVisible();
      await page.mouse.move(8, 8);
      await expect(tip).toBeHidden();
    }
  });

  test("says so over the list, and each card's question mark explains itself", async ({
    page,
    seed,
  }, testInfo) => {
    await answerPeopleSearch(
      page,
      [
        personMatch(seed.byName("Ada Lovelace")),
        personMatch(seed.byName("Grace Hopper")),
      ],
      { fallback: true },
    );
    await ask(page);

    await expect(status(page)).toHaveText(
      `2 matches for “${QUESTION}”. Not verified by AI.`,
    );
    await expect(
      page.getByRole("button", {
        name: "Why these results are not verified by AI",
      }),
    ).toBeVisible();
    await expect(mark(page, "Ada Lovelace")).toBeVisible();
    await expect(mark(page, "Grace Hopper")).toBeVisible();
    await expectInCorner(page, "Ada Lovelace");
    // The word badge is gone: the question mark replaced it.
    await expect(page.getByText("Unverified", { exact: true })).toHaveCount(0);

    // A pointer resting on it shows why.
    await mark(page, "Ada Lovelace").hover();
    const tip = tipOf(page, "Ada Lovelace");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("Not verified by AI");
    await expectInWindow(page, tip);

    // A click keeps it open when the pointer leaves. Escape closes it.
    await mark(page, "Ada Lovelace").click();
    await page.mouse.move(8, 8);
    await expect(tip).toBeVisible();
    await expectPageAccessible(page, testInfo, "unverified-tip-open");
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();

    // The keyboard reaches it after its card, and a focus shows it.
    await card(page, "Ada Lovelace").focus();
    await page.keyboard.press("Tab");
    await expect(mark(page, "Ada Lovelace")).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(tip).toBeHidden();

    // A press on the card still opens the person.
    await card(page, "Grace Hopper").click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("heading", { level: 1, name: "Grace Hopper" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("the palette marks each row, and says why once", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(page, [personMatch(seed.byName("Ada Lovelace"))], {
      fallback: true,
    });
    await page.goto("/");
    await expect(page.getByText("Ada Lovelace")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog");
    await expect(palette.getByRole("combobox")).toBeFocused();
    await page.keyboard.type("? who likes espresso");

    const row = palette.getByRole("option", { name: /Ada Lovelace/ });
    await expect(row).toBeVisible();
    await expect(
      row.getByRole("img", { name: "Not verified by AI" }),
    ).toBeVisible();
    await expect(palette.getByText("Not verified by AI").first()).toBeVisible();
    // The suite's instance has no AI model: the palette says so, rather
    // than that AI failed this time.
    await expect(
      palette.getByText(
        "No AI model is set up. They match your words or their meaning",
      ),
    ).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ ...PHONE, viewport: { width: 390, height: 844 } });

  test("keeps the list explanation inside the phone viewport", async ({
    page,
    seed,
  }) => {
    await answerPeopleSearch(page, [personMatch(seed.byName("Ada Lovelace"))], {
      fallback: true,
    });
    await ask(page);
    await page
      .getByRole("button", { name: "Why these results are not verified by AI" })
      .tap();
    const tip = page.getByRole("tooltip").filter({
      hasText: "AI could not check these people this time",
    });
    await expect(tip).toBeVisible();
    await expectInWindow(page, tip);
  });

  test("a tap opens the question mark once, and a tap elsewhere closes it", async ({
    page,
    seed,
  }, testInfo) => {
    await answerPeopleSearch(
      page,
      [
        personMatch(seed.byName("Ada Lovelace")),
        personMatch(seed.byName("Grace Hopper")),
      ],
      { fallback: true },
    );
    await ask(page);

    await expect(mark(page, "Ada Lovelace")).toBeVisible();
    await expectInCorner(page, "Ada Lovelace");
    await mark(page, "Ada Lovelace").tap();
    const tip = tipOf(page, "Ada Lovelace");
    await expect(tip).toBeVisible();
    // Not open and shut in one gesture: it is still there a moment later.
    await page.waitForTimeout(400);
    await expect(tip).toBeVisible();
    await expectInWindow(page, tip);
    await expectPageAccessible(page, testInfo, "phone-unverified-tip-open");
    await expectFloors(page, testInfo, "phone-unverified-results");

    await page.getByRole("heading", { level: 1, name: "Ask Contrack" }).tap();
    await expect(tip).toBeHidden();
  });

  test("the stage fits the phone while AI works", async ({
    page,
    seed,
  }, testInfo) => {
    await streamPeopleSearch(page, {
      instant: [personMatch(seed.byName("Linus Torvalds"))],
      complete: [personMatch(seed.byName("Ada Lovelace"))],
    });
    await ask(page);
    await expect(stage(page)).toBeVisible();
    await expectInWindow(page, stage(page));
    await expect(page.getByText("Linus Torvalds")).toHaveCount(0);
    await expectFloors(page, testInfo, "phone-ask-waiting");
    await releasePeopleSearch(page);
    await expect(card(page, "Ada Lovelace")).toBeVisible();
  });
});

/**
 * The pictures in the pull request: the wait with the bird out, and an
 * unverified list with a question mark open, at 1440 by 900 and 390 by 844,
 * light and dark.
 */
test.describe("screenshots", () => {
  test.use({ reducedMotion: "no-preference" });

  const SIZES = [
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
    {
      name: "phone",
      use: { ...PHONE, viewport: { width: 390, height: 844 } },
    },
  ] as const;

  for (const size of SIZES) {
    for (const scheme of ["light", "dark"] as const) {
      test.describe(`${size.name} ${scheme}`, () => {
        test.use({ ...size.use, colorScheme: scheme });

        test("the wait and the question mark", async ({ page, seed }) => {
          await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
          await streamPeopleSearch(page, {
            instant: [personMatch(seed.byName("Linus Torvalds"))],
            complete: [
              personMatch(seed.byName("Ada Lovelace"), {
                role: "Mathematician",
                company: "Babbage & Co",
              }),
              personMatch(seed.byName("Grace Hopper"), {
                role: "Rear Admiral",
                company: "US Navy",
              }),
            ],
            fallback: true,
          });
          await ask(page);
          await expect(overlay(page)).toHaveCount(1);
          // Out over the stage, not still leaving the box.
          await page.waitForTimeout(1_800);
          await page.screenshot({
            path: path.join(
              SCREENSHOT_DIR,
              `ask-waiting-${size.name}-${scheme}.png`,
            ),
          });

          await releasePeopleSearch(page);
          await expect(mark(page, "Ada Lovelace")).toBeVisible();
          await expect(overlay(page)).toHaveCount(0, { timeout: 6_000 });
          if (size.name === "phone") await mark(page, "Ada Lovelace").tap();
          else await mark(page, "Ada Lovelace").click();
          await expect(tipOf(page, "Ada Lovelace")).toBeVisible();
          await page.waitForTimeout(400);
          await page.screenshot({
            path: path.join(
              SCREENSHOT_DIR,
              `ask-unverified-${size.name}-${scheme}.png`,
            ),
          });
        });

        test("the palette's list AI did not check", async ({ page, seed }) => {
          await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
          await answerPeopleSearch(
            page,
            [
              personMatch(seed.byName("Ada Lovelace"), {
                role: "Mathematician",
                company: "Babbage & Co",
              }),
              personMatch(seed.byName("Grace Hopper"), {
                role: "Rear Admiral",
                company: "US Navy",
              }),
            ],
            { fallback: true },
          );
          await page.goto("/");
          await expect(page.getByText("Ada Lovelace").first()).toBeVisible();
          await page.keyboard.press("ControlOrMeta+k");
          const palette = page.getByRole("dialog");
          await expect(palette.getByRole("combobox")).toBeFocused();
          await page.keyboard.type("? who likes espresso");
          await expect(
            palette.getByRole("img", { name: "Not verified by AI" }).first(),
          ).toBeVisible();
          await page.waitForTimeout(600);
          await page.screenshot({
            path: path.join(
              SCREENSHOT_DIR,
              `palette-unverified-${size.name}-${scheme}.png`,
            ),
          });
        });
      });
    }
  }
});
