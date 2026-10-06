/**
 * The browser journeys unit tests cannot walk. `npm run test:e2e` after
 * `npm run build`. Each worker boots its own production-mode Contrack with a
 * throwaway DATA_DIR (`tests/e2e/fixtures/instance.ts`), so there is no
 * `webServer` block.
 *
 * Chromium only: the suite asserts roles, names, focus and live-region text,
 * which every engine exposes alike. docs/accessibility.md has the manual
 * screen reader pass.
 */
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results",

  fullyParallel: true,
  // A stray `test.only` would silently shrink the gate.
  forbidOnly: CI,
  // Two retries on CI absorb runner hiccups; a trace is recorded on the first
  // retry so a real flake arrives with its own evidence. None locally, where
  // a failure should fail.
  retries: CI ? 2 : 0,
  // Each worker runs a server of its own, so the count is bounded by CPU
  // rather than by tests. Two on the 4-core hosted runner.
  workers: CI ? 2 : undefined,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // An assertion made mid-transition flakes, and motion is not under test.
    reducedMotion: "reduce",
    locale: "en-US",
    // Date phrases in the notes search are read in the reader's zone. Pinned
    // so "last 30 days" means the same thing on every machine.
    timezoneId: "America/Los_Angeles",
    // `baseURL` is set per worker by the instance fixture.
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /.*phone-pages\.spec\.ts$/,
    },
    {
      name: "phone",
      use: {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: /.*phone-pages\.spec\.ts$/,
    },
  ],
});
