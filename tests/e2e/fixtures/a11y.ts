/**
 * Assertions the accessibility journeys share.
 *
 * Each one turns a question a manual audit asks — "does this scan clean",
 * "can I see where focus is", "what has focus now" — into one call, so a
 * spec reads as the journey and not as the mechanics.
 */
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults, Result } from "axe-core";

/**
 * The rule set every scan runs. WCAG 2.2 AA is the bar the app's own
 * contrast contract is written to, and the older tags are what axe uses to
 * label rules that predate 2.2. `best-practice` is left out: it flags
 * patterns rather than failures, and a gate should fail on failures.
 */
export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

/** A scan builder with the suite's rule set applied. */
export function axeFor(page: Page): AxeBuilder {
  return new AxeBuilder({ page }).withTags([...WCAG_TAGS]);
}

/** One line per node, so a failure names the element and the rule. */
export function describeViolations(violations: Result[]): string {
  if (violations.length === 0) return "no violations";
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map(
          (n) =>
            `    ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n").join("\n      ")}`,
        )
        .join("\n");
      return `${v.id} (${v.impact ?? "unknown"}): ${v.help}\n  ${v.helpUrl}\n${nodes}`;
    })
    .join("\n\n");
}

/**
 * Fail on any violation, with the full scan attached to the report so a
 * reviewer can open the JSON without re-running anything.
 */
export async function expectNoViolations(
  results: AxeResults,
  testInfo: TestInfo,
  label = "axe",
): Promise<void> {
  await testInfo.attach(`${label}-results`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  expect
    .soft(results.violations, describeViolations(results.violations))
    .toEqual([]);
}

/**
 * Wait for every finite animation on the page to finish.
 *
 * axe measures contrast through ancestor opacity, so an entrance animation
 * caught mid-fade reads as a colour that exists for one frame and fails a
 * rule the settled page passes. Spinners and pulses run forever and are
 * left alone. Bounded, because a page is not held hostage by an animation
 * that never resolves.
 *
 * It looks again after each wait rather than taking one snapshot. A page
 * that is still arriving starts animations in waves: the Duplicates page
 * fades its pane in, then its scan card, then the card's contents, and the
 * whole run lasts about a second. One snapshot catches the first wave,
 * returns, and hands axe a page that is still moving. That was a rare
 * failure on a fast machine and a regular one under load.
 *
 * Two quiet frames end it, because an animation that a commit is about to
 * start does not exist yet on the frame that commit happened.
 */
export async function settleAnimations(page: Page): Promise<void> {
  const settled = page.evaluate(async (budgetMs: number) => {
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const running = () =>
      document.getAnimations().filter((animation) => {
        const iterations = animation.effect?.getTiming().iterations;
        return animation.playState !== "finished" && iterations !== Infinity;
      });

    const deadline = Date.now() + budgetMs;
    let quietFrames = 0;
    while (quietFrames < 2 && Date.now() < deadline) {
      const pending = running();
      if (pending.length === 0) {
        quietFrames += 1;
        await nextFrame();
        continue;
      }
      quietFrames = 0;
      await Promise.all(
        pending.map((animation) => animation.finished.catch(() => undefined)),
      );
    }
  }, 4_000);
  await Promise.race([settled, new Promise((r) => setTimeout(r, 5_000))]);
}

/** Scan the page with the suite's rules and fail on any violation. */
export async function expectPageAccessible(
  page: Page,
  testInfo: TestInfo,
  label = "page",
  configure: (builder: AxeBuilder) => AxeBuilder = (b) => b,
): Promise<void> {
  await settleAnimations(page);
  const results = await configure(axeFor(page)).analyze();
  await expectNoViolations(results, testInfo, label);
}

/**
 * The page-structure rules from axe's `best-practice` set.
 *
 * `WCAG_TAGS` leaves best-practice out because most of it flags patterns
 * rather than failures. These four are the exception this app holds itself
 * to: they are what a screen reader user navigates by. One main landmark to
 * jump to, an h1 that says where you are, no content stranded outside every
 * landmark, and heading levels that do not skip.
 */
export const STRUCTURE_RULES = [
  "landmark-one-main",
  "page-has-heading-one",
  "region",
  "heading-order",
] as const;

/** Scan the page with only the named structure rules and fail on any violation. */
export async function expectPageStructured(
  page: Page,
  testInfo: TestInfo,
  label = "page",
  rules: readonly string[] = STRUCTURE_RULES,
): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page })
    .withRules([...rules])
    .analyze();
  await expectNoViolations(results, testInfo, `${label}-structure`);
}

interface FocusStyle {
  outlineStyle: string;
  outlineWidth: string;
  boxShadow: string;
}

/**
 * The element has a focus indicator a sighted keyboard user can see: an
 * outline with width, or a box-shadow ring. WCAG 2.4.7. The app draws the
 * outline from one `:focus-visible` rule and a handful of controls draw a
 * ring instead; either counts, nothing counts as neither.
 */
export async function expectVisibleFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const style = await locator.evaluate<FocusStyle, HTMLElement>((el) => {
    const s = getComputedStyle(el);
    return {
      outlineStyle: s.outlineStyle,
      outlineWidth: s.outlineWidth,
      boxShadow: s.boxShadow,
    };
  });
  const outline =
    style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  const ring = style.boxShadow !== "none" && style.boxShadow !== "";
  expect(
    outline || ring,
    `no visible focus indicator: ${JSON.stringify(style)}`,
  ).toBe(true);
}

/** Tab through `count` stops and fail if focus ever leaves `container`. */
export async function expectFocusStaysWithin(
  page: Page,
  container: Locator,
  count: number,
  key: "Tab" | "Shift+Tab" = "Tab",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    const inside = await container.evaluate(
      (el) =>
        el.contains(document.activeElement) &&
        document.activeElement !== document.body,
    );
    expect(inside, `focus left the dialog on ${key} press ${i + 1}`).toBe(true);
  }
}
