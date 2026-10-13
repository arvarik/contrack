import { defineConfig } from "vitest/config";

/**
 * A floor, not a target, so a change cannot delete the matrix and manifest
 * tests that hold isolation up and still pass. Two points under the measured
 * number: only imported files are instrumented, so a test that reaches a
 * large untested module lowers the total.
 *
 * Raise these when the real number moves up. Lowering one is a decision that
 * belongs in a pull request description.
 */
const COVERAGE_FLOOR = {
  // Whole project, measured at 77.19 / 64.66 / 76.93 / 78.98.
  statements: 75,
  branches: 62,
  functions: 74,
  lines: 76,
  /**
   * The server on its own, so uncovered frontend code cannot hide lost server
   * tests in the project total.
   *
   * Measured at 76.77 / 63.74 / 81.76 / 78.71, aggregated over the glob from
   * `coverage/coverage-final.json`. Not the text report's `server` row: it
   * covers only the top-level `server/*.ts` files and reads about fourteen
   * points higher.
   */
  "**/server/**": {
    statements: 74,
    branches: 61,
    functions: 79,
    lines: 76,
  },
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      // A CI shard holds only part of the coverage. The CI job that merges
      // the shards checks the floor.
      thresholds: process.env.COVERAGE_SHARD ? undefined : COVERAGE_FLOOR,
    },
    projects: [
      {
        // Unit tests run against a mocked database (tests/setup.ts stubs
        // server/db.ts) so they exercise pure logic only.
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["./tests/setup.ts"],
        },
      },
      {
        // The search quality gate, on the integration project's real
        // database. It asks whether ranking still ranks the same way. A
        // failure is a number to look at, not a bug.
        test: {
          name: "eval",
          environment: "node",
          globals: true,
          include: ["tests/eval/**/*.eval.test.ts"],
          setupFiles: ["./tests/integration-setup.ts"],
          testTimeout: 120_000,
          pool: "forks",
        },
      },
      {
        // Calls real provider APIs, so it is not in `npm test`, which needs
        // no credentials. A provider without a key skips itself.
        //   npm run test:contract
        test: {
          name: "contract",
          environment: "node",
          globals: true,
          include: ["tests/contract/**/*.contract.test.ts"],
          // A temp DATA_DIR, so the adapters' model cache never opens the
          // developer's curator.db.
          setupFiles: ["./tests/contract/setup.ts"],
          testTimeout: 90_000,
          // Third-party rate limits punish parallelism.
          fileParallelism: false,
        },
      },
      {
        // Integration tests run the real request pipeline (supertest against
        // createApp()) on a real SQLite database in a per-file temp DATA_DIR.
        // No db mock — migrations, FTS triggers, and cascades all execute.
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration-setup.ts"],
          testTimeout: 20_000,
          // No retries: they hide the order- and state-dependent bugs this
          // suite exists to catch. `makeTestApp` listens once per file, so
          // there is no port recycling to retry past.
          //
          // One process per file, not one worker thread: these tests set
          // `process.env` (the auth middleware reads it per request), and
          // threads share one environment, so `AUTH_REQUIRED` from one file
          // would reach the others.
          pool: "forks",
        },
      },
    ],
  },
});
