// @vitest-environment jsdom
// =============================================================================
// Applying a theme, and the cache the next page load reads
// =============================================================================
// `applyTheme` has two jobs and the second one is the easy one to get wrong.
//
// It paints: an attribute on <html> and, for a chosen accent, inline
// custom properties that beat the stylesheet.
//
// And it remembers, for `public/theme-boot.js` to replay before the first
// frame of the next load. That cache is the only reason a chosen dark theme
// does not flash white on every navigation, and the subtle rule in it is that
// "system" must NOT be pinned: a browser that cached `dark` last night on a
// dark machine must not paint dark this morning on a light one.
//
// The boot script is plain JavaScript loaded by the browser, so it is executed
// here against the same cache rather than trusted to agree with this module.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTheme,
  DEFAULT_ACCENT,
  deriveAccent,
  LIGHT,
  resolveMode,
  THEME_CACHE_KEY,
  type ThemeCache,
} from "../../src/lib/theme";

const here = path.dirname(fileURLToPath(import.meta.url));
const bootScript = fs.readFileSync(
  path.join(here, "../../public/theme-boot.js"),
  "utf8",
);

const ACCENT_VARS = [
  "--color-primary",
  "--color-primary-dim",
  "--color-primary-container",
  "--color-on-primary",
  "--color-on-primary-container",
];

/** Pretend the operating system asks for dark, or does not. */
function systemPrefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: dark && query.includes("dark"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}

const root = () => document.documentElement;
const readCache = (): ThemeCache =>
  JSON.parse(localStorage.getItem(THEME_CACHE_KEY)!) as ThemeCache;

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute("data-theme");
  for (const name of ACCENT_VARS) root().style.removeProperty(name);
  systemPrefersDark(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveMode", () => {
  it("answers for itself when a palette was chosen", () => {
    systemPrefersDark(true);
    expect(resolveMode("light")).toBe("light");
    expect(resolveMode("dark")).toBe("dark");
  });

  it("asks the machine when nothing was chosen", () => {
    systemPrefersDark(true);
    expect(resolveMode("system")).toBe("dark");
    systemPrefersDark(false);
    expect(resolveMode("system")).toBe("light");
  });
});

describe("applyTheme", () => {
  it("writes the attribute for a chosen palette", () => {
    expect(applyTheme("dark", DEFAULT_ACCENT)).toBe("dark");
    expect(root().getAttribute("data-theme")).toBe("dark");

    expect(applyTheme("light", DEFAULT_ACCENT)).toBe("light");
    expect(root().getAttribute("data-theme")).toBe("light");
  });

  it("writes no attribute for system, so the stylesheet answers", () => {
    // The `prefers-color-scheme` block in index.css is correct with no
    // JavaScript at all. Writing the resolved value would freeze it until the
    // next render, which is how a machine that switches at sunset leaves the
    // app behind.
    systemPrefersDark(true);
    expect(applyTheme("system", DEFAULT_ACCENT)).toBe("dark");
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("leaves the hand-tuned palette alone for the default accent", () => {
    applyTheme("light", DEFAULT_ACCENT);
    for (const name of ACCENT_VARS) {
      expect(root().style.getPropertyValue(name), name).toBe("");
    }
    expect(readCache().vars).toEqual({});
  });

  it("writes five custom properties for a chosen accent", () => {
    applyTheme("light", "#b45309");
    const derived = deriveAccent("#b45309", "light");
    expect(root().style.getPropertyValue("--color-primary")).toBe(
      derived.primary,
    );
    expect(root().style.getPropertyValue("--color-on-primary")).toBe(
      derived["on-primary"],
    );
    for (const name of ACCENT_VARS) {
      expect(root().style.getPropertyValue(name), name).not.toBe("");
    }
  });

  it("takes the properties off again when the accent goes back to default", () => {
    applyTheme("light", "#b45309");
    applyTheme("light", DEFAULT_ACCENT);
    for (const name of ACCENT_VARS) {
      expect(root().style.getPropertyValue(name), name).toBe("");
    }
  });

  it("derives the same accent differently for each palette", () => {
    applyTheme("light", "#6d28d9");
    const light = root().style.getPropertyValue("--color-primary");
    applyTheme("dark", "#6d28d9");
    const dark = root().style.getPropertyValue("--color-primary");
    expect(light).not.toBe(dark);
  });

  it("survives storage that refuses to be written", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => applyTheme("dark", DEFAULT_ACCENT)).not.toThrow();
    expect(root().getAttribute("data-theme")).toBe("dark");
    setItem.mockRestore();
  });
});

describe("the cache the boot script reads", () => {
  const runBoot = () => {
    // Executed rather than re-implemented. The boot script ships as its own
    // file because the production CSP forbids inline scripts, and a test that
    // paraphrased it would pass while the file did nothing.
    new Function(bootScript)();
  };

  const clearPainted = () => {
    root().removeAttribute("data-theme");
    for (const name of ACCENT_VARS) root().style.removeProperty(name);
  };

  it("replays a chosen dark theme before anything else runs", () => {
    applyTheme("dark", DEFAULT_ACCENT);
    clearPainted();

    runBoot();
    expect(root().getAttribute("data-theme")).toBe("dark");
  });

  it("replays a chosen accent", () => {
    applyTheme("dark", "#be123c");
    const expected = root().style.getPropertyValue("--color-primary");
    clearPainted();

    runBoot();
    expect(root().style.getPropertyValue("--color-primary")).toBe(expected);
  });

  it("pins nothing when the theme is system", () => {
    systemPrefersDark(true);
    applyTheme("system", DEFAULT_ACCENT);
    clearPainted();

    // The machine is light this morning. The cache says the last paint was
    // dark, and the boot script must not act on that.
    systemPrefersDark(false);
    runBoot();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("drops a cached accent that belongs to the other palette", () => {
    systemPrefersDark(true);
    applyTheme("system", "#0f766e");
    expect(readCache().mode).toBe("dark");
    clearPainted();

    systemPrefersDark(false);
    runBoot();
    // A dark-palette accent painted over a light page would be the wrong five
    // colours, so none are applied and the app derives them a moment later.
    expect(root().style.getPropertyValue("--color-primary")).toBe("");
  });

  it("does nothing at all with no cache, or a broken one", () => {
    localStorage.clear();
    expect(() => runBoot()).not.toThrow();
    expect(root().hasAttribute("data-theme")).toBe(false);

    localStorage.setItem(THEME_CACHE_KEY, "{not json");
    expect(() => runBoot()).not.toThrow();
    expect(root().hasAttribute("data-theme")).toBe(false);
  });

  it("refuses to set anything that is not a colour token", () => {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        theme: "dark",
        mode: "dark",
        vars: { "--color-primary": "#123456", content: "evil" },
      }),
    );
    runBoot();
    expect(root().style.getPropertyValue("--color-primary")).toBe("#123456");
    expect(root().style.getPropertyValue("content")).toBe("");
  });

  it("caches what was chosen as well as what it resolved to", () => {
    systemPrefersDark(true);
    applyTheme("system", DEFAULT_ACCENT);
    expect(readCache()).toMatchObject({ theme: "system", mode: "dark" });

    applyTheme("light", DEFAULT_ACCENT);
    expect(readCache()).toMatchObject({ theme: "light", mode: "light" });
  });
});

describe("the palettes themselves", () => {
  it("names the default accent as the light palette's primary", () => {
    expect(DEFAULT_ACCENT).toBe(LIGHT.primary);
  });
});
