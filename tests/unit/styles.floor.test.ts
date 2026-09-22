/**
 * The type floor and the button shape, checked against the source.
 *
 * Two rules from `.agent/STYLE.md` that a screenshot review finds late and a
 * scan finds on the pull request that breaks them:
 *
 *   1. No text under 11 px. `text-[9px]` and `text-[10px]` were the two sizes
 *      the review found on 138 lines, from the tab bar labels to the palette
 *      shortcut chips.
 *   2. A filled primary button is a rounded rectangle (`.btn-primary`), not a
 *      pill. The review found five primary shapes. `rounded-full` with a
 *      solid `bg-primary` fill is a pill button, and pills belong to chips,
 *      filter pills and `Segmented`.
 *
 * The browser metrics scan (tests/e2e/metrics.spec.ts) measures the rendered
 * sizes on a phone. This file is the cheaper half: it runs in milliseconds on
 * every file under src/, including screens the browser suite never opens.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "../../src");

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) files.push(full);
    }
  };
  walk(SRC);
  return files;
}

const rel = (file: string) => path.relative(SRC, file);

const css = fs.readFileSync(path.join(SRC, "index.css"), "utf8");

/** One rule's body, from its selector to the first closing brace. */
const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

/**
 * The rule that is `selector` alone, not a list that ends with it: the line
 * before it must not end in a comma.
 */
const ownBlock = (selector: string) => {
  let from = 0;
  for (;;) {
    const at = css.indexOf(`${selector} {`, from);
    expect(at, selector).toBeGreaterThan(-1);
    const before = css.slice(0, at).trimEnd();
    if (!before.endsWith(",")) return css.slice(at, css.indexOf("}", at));
    from = at + selector.length;
  }
};

/**
 * Files where a filled pill is the component's job, not a button's.
 * Each entry says why.
 */
const PILL_ALLOW_LIST: Record<string, string> = {
  // The selected option of a pill-in-a-trough toggle.
  "components/ui/Segmented.tsx": "Segmented",
};

/**
 * Every class string in a file: string literals, template literals, and
 * the whole argument list of each `cn(...)` call, so a pill whose fill and
 * shape sit in two literals of one `cn` is still one class string.
 */
function classStrings(raw: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  // Comments blanked first, newlines kept so line numbers still match. An
  // apostrophe in a comment would otherwise open a "string" that runs to the
  // next one.
  const source = raw.replace(
    /\/\*[\s\S]*?\*\/|(^|[^:"'`\\])\/\/.*$/gm,
    (comment, lead: string | undefined) =>
      (lead ?? "") + comment.slice((lead ?? "").length).replace(/[^\n]/g, " "),
  );
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;

  for (const match of source.matchAll(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g)) {
    out.push({ text: match[0], line: lineAt(match.index ?? 0) });
  }

  for (const match of source.matchAll(/\bcn\(/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let i = start;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
      i++;
    }
    out.push({ text: source.slice(start, i - 1), line: lineAt(start) });
  }

  return out;
}

describe("the type floor", () => {
  it("has no text-[9px] or text-[10px] anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Any size under 11 px written as an arbitrary value, 9 and 10 most
        // of all, whatever variant prefix it carries.
        if (/text-\[(?:[0-9]|10)(?:\.\d+)?px\]/.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("holds the shared label and badge tokens at 11 px or more", async () => {
    const styles = await import("../../src/lib/styles");
    for (const name of [
      "LABEL",
      "LABEL_PRIMARY",
      "SECTION_HEADING",
      "KBD_SM",
      "MICRO_BADGE",
      "STATUS_BADGE_SUCCESS",
    ] as const) {
      expect(styles[name], name).toContain("text-[11px]");
    }
    expect(styles.FIELD_LABEL).toContain("text-xs");
    expect(styles.ICON_BTN).toContain("hit-area");
  });
});

describe("the button shape", () => {
  it("never draws a filled primary pill outside the allow-list", () => {
    // `bg-primary` on its own, with any variant prefix, but not a wash such
    // as `bg-primary/10` or another token such as `bg-primary-container`.
    const fill = /bg-primary(?![-/\w])/;
    const pill = /(?<![-\w])rounded-full(?![-\w])/;
    // A dot, a progress bar or a switch track is round and filled but has no
    // horizontal padding, and a count badge has `px-1`. A pill button has
    // at least `px-2`.
    const padded = /(?<![-\w])px-(?:[2-9]|1\d|\[)/;

    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file.endsWith(".css")) continue;
      if (rel(file) in PILL_ALLOW_LIST) continue;
      const source = fs.readFileSync(file, "utf8");
      const seen = new Set<number>();
      for (const { text, line } of classStrings(source)) {
        if (fill.test(text) && pill.test(text) && padded.test(text)) {
          if (seen.has(line)) continue;
          seen.add(line);
          offenders.push(`${rel(file)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("gives the buttons a rounded rectangle, a 44 px floor and one disabled look", () => {
    const shared = block(".btn-primary,\n  .btn-secondary,\n  .btn-danger");
    expect(shared).toContain("border-radius: 0.375rem");
    expect(shared).toContain("min-height: 44px");
    expect(css).toContain(
      ".btn-primary:disabled,\n  .btn-secondary:disabled,\n  .btn-danger:disabled",
    );
    expect(css).not.toMatch(
      /\.btn-(?:primary|secondary|danger)[^{]*\{[^}]*9999px/,
    );
  });

  it("gives every button an edge under its face, and takes it away when disabled", () => {
    // The depth: a solid shadow `--btn-lift` below the face, in the edge
    // colour, which the border shares. Hover raises the face 1 px and press
    // sinks it until 1 px of edge is left, so the edge's bottom never moves.
    const shared = block(".btn-primary,\n  .btn-secondary,\n  .btn-danger");
    expect(shared).toContain(
      "border: 1px solid var(--btn-border, var(--btn-edge))",
    );
    expect(shared).toContain(
      "box-shadow: 0 var(--btn-lift) 0 0 var(--btn-edge)",
    );
    for (const name of ["primary", "secondary", "danger"]) {
      const own = ownBlock(`.btn-${name}`);
      expect(own, name).toContain("--btn-face:");
      expect(own, name).toContain("--btn-edge:");
    }
    expect(css).toContain("transform: translateY(-1px)");
    expect(css).toContain("transform: translateY(calc(var(--btn-lift) - 1px))");
    const disabled = block(
      ".btn-primary:disabled,\n  .btn-secondary:disabled,\n  .btn-danger:disabled",
    );
    expect(disabled).toContain("box-shadow: none");
    expect(disabled).toContain("border-color: transparent");
    // A tap leaves no raised button behind on a phone.
    expect(css).toMatch(/@media \(hover: hover\) \{\s*\.btn-primary:hover/);
  });

  it("gives the small button the 44 px tap box", () => {
    const rule = block(".btn-sm::after");
    expect(rule).toContain("width: max(100%, 44px)");
    expect(rule).toContain("height: max(100%, 44px)");
  });

  it("defines the hit-area utility as a 44 px ::after box", () => {
    const start = css.indexOf(".hit-area::after {");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("width: max(100%, 44px)");
    expect(rule).toContain("height: max(100%, 44px)");
    expect(rule).toContain("transform: translate(-50%, -50%)");
  });
});

/**
 * The one look, held by a scan.
 *
 * Section 1 of the 2.0 design review found six hover recipes on three pages,
 * ten focus rings, two label trackings, a colour token that did not exist
 * and a transition on a property that does not exist. Each rule below keeps
 * one of those from coming back on a pull request that nobody screenshots.
 */
describe("the one look", () => {
  /** Class strings with their file and line, comments blanked. */
  const everyClassString = () => {
    const out: { file: string; line: number; text: string }[] = [];
    for (const file of sourceFiles()) {
      if (file.endsWith(".css")) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const { text, line } of classStrings(source)) {
        // An apostrophe in JSX text opens a "string" that runs to the next
        // one, across markup. A class string never holds a tag.
        if (/<\/?[A-Za-z]/.test(text)) continue;
        out.push({ file: rel(file), line, text });
      }
    }
    return out;
  };

  it("tracks every uppercase label at 0.08em, never Tailwind's widest", () => {
    const offenders = everyClassString()
      .filter(({ text }) => /(?<![-\w])tracking-widest(?![-\w])/.test(text))
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("draws no focus ring of its own: the base layer's outline is the one ring", () => {
    const ring = /(?<![-\w])focus(?:-visible|-within)?:ring(?:-|\b)/;
    const offenders = everyClassString()
      .filter(({ text }) => ring.test(text))
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("names no colour token that does not exist", () => {
    // `danger` was never a token, so `text-danger` painted nothing and a
    // destructive button looked like every other one. `outline` is not one
    // either (`outline-variant` is), so `border-outline/20` drew its border
    // in the text colour.
    const offenders = everyClassString()
      .filter(({ text }) =>
        /(?<![-\w])(?:[a-z-]+:)*(?:text|bg|ring|border|divide|fill|stroke|from|via|to|decoration)-(?:danger|outline)(?![-\w])/.test(
          text,
        ),
      )
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("transitions only properties that exist", () => {
    // `transition-[shadow,…]` names no CSS property, so the shadow jumped.
    const offenders = everyClassString()
      .filter(({ text }) =>
        /transition-\[[^\]]*(?<![-\w])shadow(?![-\w])/.test(text),
      )
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("lets a button class own its fill, its edge and its disabled look", () => {
    // A shadow, a ring or a hover fill on a call site outranks the class
    // (utilities come later) and takes the edge or the face away.
    const button = /(?<![-\w])btn-(?:primary|secondary|danger)(?![-\w])/;
    // Padding, a text size and a height are the class's too: `.btn-sm` and
    // `.btn-icon` are the other sizes.
    const override =
      /(?<![-\w])(?:hover:|active:|disabled:)?(?:shadow|ring)(?:-|\b)|(?<![-\w])(?:hover|disabled|active):(?:bg|opacity)-|(?<![-\w])(?:bg-(?:primary|error|red|rose)|opacity-\d)|(?<![-\w])(?:[a-z]+:)?(?:p[xytblrse]?|min-h)-|(?<![-\w])(?:[a-z]+:)?text-(?:xs|sm|base|lg|xl|2xl|\[)/;
    const offenders = everyClassString()
      .filter(({ text }) => button.test(text) && override.test(text))
      .map(
        ({ file, line, text }) =>
          `${file}:${line}: ${text.trim().slice(0, 120)}`,
      );
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("lets an interactive card own its hover", () => {
    const card = /(?<![-\w])card-interactive(?![-\w])/;
    const hover =
      /(?<![-\w])(?:hover|active):(?:shadow|ring|scale|-?translate|bg)-|(?<![-\w])shadow-(?:sm|md|lg|xl|2xl)(?![-\w])|(?<![-\w])ring-(?!0(?![-\w])|inset(?![-\w])|offset)/;
    const offenders = everyClassString()
      .filter(({ text }) => card.test(text) && hover.test(text))
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("keeps a selected row's bar free of rings and shadows", () => {
    const selected = /(?<![-\w])row-selected(?![-\w])|SELECTED_ROW/;
    const clash = /(?<![-\w])(?:ring|shadow)-(?!none)/;
    // A background utility replaces the tint too. Checked inside one literal
    // only: a ternary that picks the tint or a resting wash is fine, and a
    // scan cannot tell it from a conflict.
    const literal = /(?<![-\w])row-selected(?![-\w])/;
    const background = /(?<![-\w])(?:[a-z-]+:)?bg-/;
    const offenders = everyClassString()
      .filter(
        ({ text }) =>
          (selected.test(text) && clash.test(text)) ||
          (literal.test(text) &&
            !/SELECTED_ROW/.test(text) &&
            text.length < 200 &&
            background.test(text)),
      )
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("times transitions with the motion tokens, not a hand-picked duration", () => {
    // The base duration applies to every `transition-*` with no class, and
    // `duration-(--dur-fast)` or `duration-(--dur-slow)` name the other two.
    const offenders = everyClassString()
      .filter(({ text }) =>
        /(?<![-\w])duration-(?:\d+|\[[^\]]+\])(?![-\w])/.test(text),
      )
      .map(({ file, line }) => `${file}:${line}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("holds the same three durations in index.css and lib/motion.ts", async () => {
    const { DURATION, EASE } = await import("../../src/lib/motion");
    const ms = (name: string) => {
      const match = css.match(new RegExp(`--dur-${name}:\\s*(\\d+)ms`));
      expect(match, name).not.toBeNull();
      return Number(match![1]) / 1000;
    };
    expect(ms("fast")).toBe(DURATION.fast);
    expect(ms("base")).toBe(DURATION.base);
    expect(ms("slow")).toBe(DURATION.slow);
    expect(css).toContain(`--ease: cubic-bezier(${EASE.join(", ")})`);
    expect(css).toContain(
      `--default-transition-timing-function: cubic-bezier(${EASE.join(", ")})`,
    );
    expect(css).toContain(
      `--default-transition-duration: ${DURATION.base * 1000}ms`,
    );
  });
});
