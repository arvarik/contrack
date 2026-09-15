/**
 * Automated WCAG scans of every screen, in both palettes.
 *
 * axe finds the class of problem a rule can state: a control with no name,
 * text without contrast, an id used twice, a landmark missing. It cannot say
 * whether a journey works, which is what the other specs are for, and it
 * cannot hear a screen reader, which is what docs/accessibility.md's manual
 * pass is for. What it can do it does on every pull request.
 */
import { test, expect } from "./fixtures/test";
import { expectPageAccessible } from "./fixtures/a11y";
import type { Page } from "@playwright/test";
import type { Seed } from "./fixtures/seed";

interface Screen {
  name: string;
  path: (seed: Seed) => string;
  /** Resolves once the screen has its data, so the scan sees the real page. */
  ready: (page: Page, seed: Seed) => Promise<void>;
}

const SCREENS: Screen[] = [
  {
    name: "network list",
    path: () => "/",
    ready: async (page) => {
      await expect(page.getByText("Ada Lovelace")).toBeVisible();
    },
  },
  {
    name: "contact detail",
    path: (seed) => `/contact/${seed.byName("Ada Lovelace").id}`,
    ready: async (page) => {
      await expect(
        page.getByRole("button", { name: "Change avatar" }),
      ).toBeVisible();
    },
  },
  {
    name: "pulse",
    path: () => "/pulse",
    ready: async (page) => {
      await expect(page.getByRole("heading", { name: "Pulse" })).toBeVisible();
    },
  },
  {
    name: "map",
    path: () => "/map",
    ready: async (page) => {
      await expect(page.locator(".leaflet-container")).toBeVisible();
    },
  },
  {
    name: "ask contrack",
    path: () => "/search",
    ready: async (page) => {
      await expect(
        page.getByRole("textbox", { name: "Ask anything about your network" }),
      ).toBeVisible();
    },
  },
  {
    name: "notes search with results",
    path: () => "/search?mode=notes&q=hiring",
    ready: async (page) => {
      await expect(page.getByText("3 notes", { exact: true })).toBeVisible();
    },
  },
  {
    name: "settings",
    path: () => "/settings",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  },
  {
    name: "account settings",
    path: () => "/settings/account",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { name: "No account needed" }),
      ).toBeVisible();
    },
  },
];

for (const screen of SCREENS) {
  test(`${screen.name} has no WCAG violations`, async ({
    page,
    seed,
  }, testInfo) => {
    await page.goto(screen.path(seed));
    await screen.ready(page, seed);
    await expectPageAccessible(page, testInfo, screen.name);
  });
}

/**
 * The dark palette is held to the same contract as the light one. A token
 * that clears AA in one and not the other is the regression the theme work
 * made possible, so the screens with the most text are scanned twice.
 */
test.describe("dark theme", () => {
  test.use({ colorScheme: "dark" });

  for (const screen of SCREENS.filter((s) =>
    ["network list", "contact detail", "ask contrack", "settings"].includes(
      s.name,
    ),
  )) {
    test(`${screen.name} has no WCAG violations in dark`, async ({
      page,
      seed,
    }, testInfo) => {
      await page.goto(screen.path(seed));
      await screen.ready(page, seed);
      await expect(page.locator("html")).toHaveCSS("color-scheme", /dark/);
      await expectPageAccessible(page, testInfo, `${screen.name}-dark`);
    });
  }
});
