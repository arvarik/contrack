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

  it("gives .btn-primary a rounded rectangle, a 44 px floor and one disabled look", () => {
    const css = fs.readFileSync(path.join(SRC, "index.css"), "utf8");
    const block = (selector: string) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, selector).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf("}", start));
    };
    const shared = block(".btn-primary,\n  .btn-secondary");
    expect(shared).toContain("border-radius: 0.375rem");
    expect(shared).toContain("min-height: 44px");
    expect(css).toContain(".btn-primary:disabled,\n  .btn-secondary:disabled");
    expect(css).not.toMatch(/\.btn-(?:primary|secondary)[^{]*\{[^}]*9999px/);
  });

  it("defines the hit-area utility as a 44 px ::after box", () => {
    const css = fs.readFileSync(path.join(SRC, "index.css"), "utf8");
    const start = css.indexOf(".hit-area::after {");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start));
    expect(rule).toContain("width: max(100%, 44px)");
    expect(rule).toContain("height: max(100%, 44px)");
    expect(rule).toContain("transform: translate(-50%, -50%)");
  });
});
