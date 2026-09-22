/**
 * The 44 pixel target floor and the 11 pixel type floor, on a phone.
 *
 * A 390 pixel viewport with touch, the shape of the iPhone 13 the UI review
 * walked. A phone is where both floors bite: a control a mouse can hit at 24
 * pixels is a miss for a thumb, and 10 pixel text at arm's length is a
 * squint. Each screen below is the one the review measured. See
 * `fixtures/metrics.ts` for how a hit box is measured.
 */
import { devices, type Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { expectFloors } from "./fixtures/metrics";
import { stubBasemap } from "./fixtures/map";
import type { Seed } from "./fixtures/seed";

/**
 * The iPhone 13 viewport, touch and scale. The browser type is left out:
 * the project runs Chromium, and a describe block may not choose a browser.
 */
const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

/**
 * MapLibre draws the attribution strip itself, at its own type size and with
 * inline links. WCAG 2.5.8 exempts a link inside a line of text from the
 * target floor, and the strip is required by the basemap's terms, so it is
 * measured by neither rule.
 */
const ALLOW = [".maplibregl-ctrl-attrib"];

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
        page.getByRole("heading", { level: 1, name: /Ada Lovelace/ }),
      ).toBeVisible();
      await expect(
        page.getByText("Coffee about the Berlin office"),
      ).toBeVisible();
    },
  },
  {
    name: "tracked contacts",
    path: () => "/tracked",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Tracked contacts" }),
      ).toBeVisible();
      await expect(page.getByText("Edsger Dijkstra")).toBeVisible();
    },
  },
  {
    name: "pulse",
    path: () => "/pulse",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Pulse" }),
      ).toBeVisible();
    },
  },
  {
    name: "map",
    path: () => "/map",
    ready: async (page) => {
      // The zoom buttons and the pins are the map's own controls, and both
      // have to clear the floor on a phone, over the tab bar.
      await expect(
        page.getByRole("button", { name: "Ada Lovelace, Babbage & Co" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Zoom in", exact: true }),
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
    name: "settings",
    path: () => "/settings",
    ready: async (page) => {
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    },
  },
];

test.describe("phone", () => {
  test.use({ ...PHONE });

  // The map screen loads its basemap from OpenFreeMap. The host is answered
  // locally, so the scan never waits on a public service.
  test.beforeEach(async ({ page }) => {
    await stubBasemap(page);
  });

  for (const screen of SCREENS) {
    test(`${screen.name} has 44 pixel targets and 11 pixel text`, async ({
      page,
      seed,
    }, testInfo) => {
      await page.goto(screen.path(seed));
      await screen.ready(page, seed);
      await expectFloors(page, testInfo, screen.name, { allow: ALLOW });
    });
  }
});
