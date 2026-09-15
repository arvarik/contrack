/**
 * The touch and type floors, measured in the page.
 *
 * `.agent/STYLE.md` sets two rules: every control a finger can reach has a
 * hit box of at least 44 by 44 CSS pixels, and no text a person reads is
 * smaller than 11 pixels. The UI review measured both by hand on a phone and
 * found 54 small targets and 29 small text nodes on one contact page. This
 * fixture turns that walk into an assertion, so a new screen cannot bring
 * either number back.
 *
 * The hit box of a control is the largest of three boxes:
 *
 *   1. its own border box,
 *   2. its `::after` box, which is what the `.hit-area` utility draws to
 *      grow a small control without changing how it looks,
 *   3. the box of the `<label>` that wraps it, which is what a tap on a
 *      visually hidden checkbox or radio actually lands on.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { settleAnimations } from "./a11y";

/** The smallest hit box, in CSS pixels, on either axis. */
export const MIN_TARGET = 44;

/** The smallest font size, in CSS pixels, for text a person reads. */
export const MIN_TEXT = 11;

export interface TargetMiss {
  element: string;
  width: number;
  height: number;
}

export interface TextMiss {
  element: string;
  text: string;
  size: number;
}

export interface Metrics {
  targets: TargetMiss[];
  text: TextMiss[];
}

export interface MetricsOptions {
  /**
   * Selectors whose subtree is not measured. Each entry needs a reason where
   * it is passed. The one the suite uses today is the map's attribution
   * strip, which MapLibre draws at its own size and the basemap's terms
   * require.
   */
  allow?: readonly string[];
}

/**
 * Measure every visible control and every visible text node on the page.
 *
 * Runs in the browser. Controls that are disabled or visually hidden
 * (`sr-only`, a 1 by 1 clip) are skipped, because nobody can tap them.
 * Everything else in the document is measured, above the fold or not.
 */
export async function measureFloors(
  page: Page,
  options: MetricsOptions = {},
): Promise<Metrics> {
  await settleAnimations(page);
  return page.evaluate(
    ({ allow, minTarget, minText }) => {
      const CONTROLS = [
        "a[href]",
        "button",
        "input:not([type=hidden])",
        "select",
        "textarea",
        "summary",
        '[role="button"]',
        '[role="link"]',
        '[role="radio"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="option"]',
      ].join(",");

      const allowed = (el: Element) =>
        allow.some((selector) => el.closest(selector) !== null);

      /** A short description a failure message can name. */
      const describe = (el: Element) => {
        const name =
          el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        const id = el.id ? `#${el.id}` : "";
        return `<${el.tagName.toLowerCase()}${id}> "${name}"`;
      };

      /** Drawn, not transparent, and not clipped to a single pixel. */
      const visible = (el: Element) => {
        const rect = el.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") {
          return false;
        }
        for (let n: Element | null = el; n; n = n.parentElement) {
          if (parseFloat(getComputedStyle(n).opacity) === 0) return false;
        }
        return true;
      };

      /** The `::after` box, when the element draws a positioned one. */
      const afterBox = (el: Element) => {
        // A field draws no `::after`, but Chromium still reports a size for
        // it on some input types. Only the field's own box counts.
        if (el.matches("input, select, textarea")) {
          return { width: 0, height: 0 };
        }
        const after = getComputedStyle(el, "::after");
        if (after.content === "none" || after.position !== "absolute") {
          return { width: 0, height: 0 };
        }
        return {
          width: parseFloat(after.width) || 0,
          height: parseFloat(after.height) || 0,
        };
      };

      const targets: { element: string; width: number; height: number }[] = [];
      for (const el of Array.from(document.querySelectorAll(CONTROLS))) {
        if (allowed(el)) continue;
        if ((el as HTMLButtonElement).disabled) continue;
        if (el.getAttribute("aria-disabled") === "true") continue;
        const own = el.getBoundingClientRect();
        const label =
          el instanceof HTMLInputElement ? el.closest("label") : null;
        // A hidden input is tapped through its label, so the label decides.
        if (!visible(el) && !(label && visible(label))) continue;
        const after = afterBox(el);
        const labelRect = label?.getBoundingClientRect();
        const width = Math.max(own.width, after.width, labelRect?.width ?? 0);
        const height = Math.max(
          own.height,
          after.height,
          labelRect?.height ?? 0,
        );
        // Half a pixel of rounding is not a miss.
        if (width < minTarget - 0.5 || height < minTarget - 0.5) {
          targets.push({
            element: describe(el),
            width: Math.round(width),
            height: Math.round(height),
          });
        }
      }

      const text: { element: string; text: string; size: number }[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      const seen = new Set<Element>();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const content = (node.textContent ?? "").trim();
        const parent = node.parentElement;
        if (!content || !parent || seen.has(parent)) continue;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) continue;
        if (allowed(parent) || !visible(parent)) continue;
        const size = parseFloat(getComputedStyle(parent).fontSize);
        if (size < minText - 0.05) {
          seen.add(parent);
          text.push({
            element: describe(parent),
            text: content.slice(0, 40),
            size,
          });
        }
      }

      return { targets, text };
    },
    {
      allow: [...(options.allow ?? [])],
      minTarget: MIN_TARGET,
      minText: MIN_TEXT,
    },
  );
}

/** One line per miss, so a failure names every element at once. */
export function describeMisses(metrics: Metrics): string {
  const lines = [
    ...metrics.targets.map(
      (t) => `target ${t.width}x${t.height}: ${t.element}`,
    ),
    ...metrics.text.map((t) => `text ${t.size}px: ${t.element} "${t.text}"`),
  ];
  return lines.length ? lines.join("\n") : "no misses";
}

/**
 * Fail when any control's hit box is under 44 pixels or any text is under
 * 11 pixels. The full measurement is attached to the report.
 */
export async function expectFloors(
  page: Page,
  testInfo: TestInfo,
  label: string,
  options: MetricsOptions = {},
): Promise<void> {
  const metrics = await measureFloors(page, options);
  await testInfo.attach(`${label}-metrics`, {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  expect(
    metrics.targets.length + metrics.text.length,
    describeMisses(metrics),
  ).toBe(0);
}
