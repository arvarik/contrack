/**
 * Automated WCAG scans of every screen, in both palettes.
 *
 * axe finds the class of problem a rule can state: a control with no name,
 * text without contrast, an id used twice, a landmark missing. It cannot say
 * whether a journey works, which is what the other specs are for, and it
 * cannot hear a screen reader, which is what docs/accessibility.md's manual
 * pass is for. What it can do it does on every pull request.
 */
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import {
  expectPageAccessible,
  expectPageStructured,
  STRUCTURE_RULES,
} from "./fixtures/a11y";
import type { Seed } from "./fixtures/seed";
import { stubBasemap } from "./fixtures/map";

// The map screen loads its basemap from OpenFreeMap. Every test here answers
// that host locally, so no scan waits on, or changes with, a public service.
test.beforeEach(async ({ page }) => {
  await stubBasemap(page);
});

interface Screen {
  name: string;
  path: (seed: Seed) => string;
  /** Resolves once the screen has its data, so the scan sees the real page. */
  ready: (page: Page, seed: Seed) => Promise<void>;
  /**
   * The same promise on a phone, where it differs. The narrow contact page
   * opens on its Timeline tab, with no Log interaction button and the mini
   * map on the Details tab.
   */
  phoneReady?: (page: Page, seed: Seed) => Promise<void>;
  /** The best-practice structure rules this screen is held to. Omitted means all four. */
  structure?: readonly string[];
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
        page.getByRole("button", { name: "Log interaction" }),
      ).toBeVisible();
      // Ada has coordinates, so the page draws her mini map. Her pin exists
      // only once that map has loaded, so it is the proof the scan sees the
      // map chrome and not an empty box.
      await expect(
        page
          .getByRole("region", { name: "Location map" })
          .getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
      ).toBeVisible();
    },
    phoneReady: async (page) => {
      await expect(
        page.getByRole("radiogroup", { name: "Contact sections" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Coffee about the Berlin office",
          exact: true,
        }),
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
      const map = page.getByRole("region", { name: "Contact map" });
      await expect(map).toBeVisible();
      // Pins exist only once the map has loaded and clustered the contacts,
      // so one named pin is the proof the map is drawn. London has nobody
      // near it at world zoom, so Ada is a pin and not part of a cluster.
      await expect(
        map.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
      ).toBeVisible();
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
 * Landmarks and headings.
 *
 * The WCAG scans above pass on a page that is one undifferentiated block, so
 * structure is scanned separately, on the screens the review measured: no h1
 * on Network, the contact or the map, and thirty-three nodes outside any
 * landmark on Network.
 */
const STRUCTURED = [
  "network list",
  "contact detail",
  "pulse",
  "map",
  "ask contrack",
  "settings",
];

for (const screen of SCREENS.filter((s) => STRUCTURED.includes(s.name))) {
  test(`${screen.name} has one main, an h1 and ordered headings`, async ({
    page,
    seed,
  }, testInfo) => {
    await page.goto(screen.path(seed));
    await screen.ready(page, seed);
    await expectPageStructured(
      page,
      testInfo,
      screen.name,
      screen.structure ?? STRUCTURE_RULES,
    );
  });
}

/**
 * On a phone the list and the contact take turns on screen, so each has to
 * be the page's main when it is the one showing. The desktop scans cannot
 * see that: there the list is a complementary landmark beside the contact.
 */
test.describe("phone", () => {
  const { defaultBrowserType: _chromium, ...PHONE } = devices["Pixel 7"];
  test.use({ ...PHONE });

  for (const screen of SCREENS.filter((s) =>
    ["network list", "contact detail"].includes(s.name),
  )) {
    test(`${screen.name} has one main, an h1 and ordered headings on a phone`, async ({
      page,
      seed,
    }, testInfo) => {
      await page.goto(screen.path(seed));
      await (screen.phoneReady ?? screen.ready)(page, seed);
      await expectPageStructured(page, testInfo, `${screen.name}-phone`);
    });
  }
});

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
