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
import type { Seed } from "./fixtures/seed";

/**
 * The iPhone 13 viewport, touch and scale. The browser type is left out:
 * the project runs Chromium, and a describe block may not choose a browser.
 */
const { defaultBrowserType: _webkit, ...PHONE } = devices["iPhone 13"];

/**
 * Leaflet draws its own attribution strip with its own type size. The
 * MapLibre plan replaces the map and its attribution, and this entry goes
 * with it.
 */
const ALLOW = [".leaflet-control-attribution"];

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
    name: "pulse",
    path: () => "/pulse",
    ready: async (page) => {
      await expect(
        page.getByRole("heading", { level: 1, name: "Pulse" }),
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
