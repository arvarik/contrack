/**
 * The two `test` objects the browser suite is written against.
 *
 *   test       an open, seeded instance shared by the worker. Most journeys.
 *   gatedTest  a fresh gated instance per test, with no account yet. The
 *              setup, sign-in, sign-out and password journeys.
 *
 * Both set `baseURL` from the instance they own, so a spec navigates with
 * `page.goto("/")` and never knows which port it got. Both attach the
 * server's log to a failing test, because "the page never became ready" is
 * usually a server message.
 */
import { test as base, expect } from "@playwright/test";
import { ContrackInstance } from "./instance";
import { seedInstance, type Seed } from "./seed";
import { stubWeather } from "./weather";

interface OpenWorkerFixtures {
  /** The worker's open instance. Started once, seeded once, stopped at the end. */
  instance: ContrackInstance;
  /** What was seeded, by name and by id. */
  seed: Seed;
}

interface OpenTestFixtures {
  /** Attaches the server log when the test fails. Automatic. */
  serverLog: void;
  /** Answers the weather service locally. Automatic. See `weather.ts`. */
  weather: void;
}

export const test = base.extend<OpenTestFixtures, OpenWorkerFixtures>({
  instance: [
    // Playwright reads the fixture's dependencies from this pattern, and an
    // instance depends on nothing, so the pattern is empty on purpose.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const instance = await ContrackInstance.start({ authRequired: false });
      await use(instance);
      await instance.stop();
    },
    { scope: "worker" },
  ],
  seed: [
    async ({ instance }, use) => {
      await use(await seedInstance(instance));
    },
    // Automatic, so a test that never names `seed` still finds the people
    // in the list. A fixture is only built when something depends on it.
    { scope: "worker", auto: true },
  ],
  baseURL: async ({ instance }, use) => {
    await use(instance.baseURL);
  },
  weather: [
    async ({ page }, use) => {
      await stubWeather(page);
      await use();
    },
    // Automatic: every contact with coordinates asks for its weather, so a
    // spec that never mentions it still waits on the answer.
    { auto: true },
  ],
  serverLog: [
    async ({ instance }, use, testInfo) => {
      const mark = instance.mark();
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server.log", {
          body: instance.logSince(mark),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
});

interface GatedTestFixtures {
  /** A gated instance with no account, started for this test alone. */
  gated: ContrackInstance;
}

export const gatedTest = base.extend<GatedTestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  gated: async ({}, use, testInfo) => {
    const instance = await ContrackInstance.start({ authRequired: true });
    await use(instance);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server.log", {
        body: instance.log(),
        contentType: "text/plain",
      });
    }
    await instance.stop();
  },
  baseURL: async ({ gated }, use) => {
    await use(gated.baseURL);
  },
});

export { expect };
