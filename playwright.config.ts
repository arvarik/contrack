/**
 * Playwright — the browser journeys that unit tests cannot walk.
 *
 * `npm run test:e2e` after `npm run build`. Every worker boots its own
 * production-mode Contrack (`tests/e2e/fixtures/instance.ts`) on a free port
 * with a throwaway DATA_DIR, so a run never touches a developer's database
 * and two workers never share state. There is no `webServer` block for that
 * reason: the server is a fixture, not a global.
 *
 * Chromium only. The suite asserts roles, names, focus and live-region text,
 * which the accessibility tree exposes the same way in every engine; what
 * differs between engines is the screen reader, and no automated run can
 * stand in for one. See docs/accessibility.md for the manual pass.
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
    // The app honours `prefers-reduced-motion`, and so does this suite: an
    // assertion made mid-transition is a flake waiting to happen, and the
    // motion itself is not what is under test.
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
