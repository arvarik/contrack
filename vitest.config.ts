import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      /**
       * A floor, not a target.
       *
       * `docs/ci-and-release.md` said coverage was collected and nothing was
       * enforced, which made it a number somebody could read and nothing
       * more. The matrix and manifest tests are what hold the isolation
       * guarantee up, and before this a pull request could delete them and go
       * green.
       *
       * Set two points under what was measured when this landed, which is
       * both what extra F2 specifies and roughly the room a normal change
       * needs. Only imported files are instrumented, so a test that reaches
       * into a large untested module lowers the total by adding coverage —
       * two points is what absorbs that.
       *
       * Raise these when the real number moves up. Lowering one is a decision
       * that belongs in a pull request description.
       */
      thresholds: {
        // Whole project, measured at 75.18 / 61.82 / 74.93 / 76.98.
        statements: 73,
        branches: 59,
        functions: 72,
        lines: 74,
        /**
         * The server, on its own.
         *
         * The two sets of numbers are close, because the server is most of
         * what gets instrumented — only imported files are, and the unit
         * project reaches a small part of the frontend. So this is not a
         * higher bar so much as an independent one: a change that adds a lot
         * of uncovered frontend drags the project total down, and without
         * this line that would be indistinguishable from somebody deleting
         * the tests that hold the isolation guarantee up.
         *
         * Measured at 75.91 / 62.71 / 80.64 / 77.87. Read from
         * `coverage/coverage-final.json` and aggregated over the glob, NOT
         * from the `server` row of the text report: that row covers the
         * top-level `server/*.ts` files alone and reads about fourteen points
         * higher, which is how these were set two points too high the first
         * time they were written.
         */
        "**/server/**": {
          statements: 73,
          branches: 60,
          functions: 78,
          lines: 75,
        },
      },
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
        // The search quality gate. Same real database as the integration
        // project, and the same setup file builds it, but the eval is its own
        // project because it answers a different question: integration asks
        // whether a route behaves, and this asks whether ranking still ranks
        // the same way. A failure here is a number to look at, not a bug.
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
        // Contract tests call REAL provider APIs and are deliberately NOT in
        // the default run: cloning the repo and running `npm test` must work
        // with no credentials at all. Each provider block skips itself when its
        // key is absent, so one key exercises one provider.
        //   npm run test:contract
        test: {
          name: "contract",
          environment: "node",
          globals: true,
          include: ["tests/contract/**/*.contract.test.ts"],
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
          /**
           * No retries. There were two, absorbing socket-layer noise from
           * supertest binding and closing a fresh HTTP server for every single
           * request — roughly 500 listen/close cycles a run, which recycles
           * ephemeral ports faster than closed sockets leave TIME_WAIT.
           *
           * `makeTestApp` now listens once per file and every request goes to
           * that server, which removes the recycling rather than retrying past
           * it. Measured at roughly one failed run in six before, and none in
           * thirty after.
           *
           * Retries are not reinstated without a cause: they hide exactly the
           * kind of order- and state-dependent bug this suite exists to catch,
           * and the flakes they were absorbing here presented as impossible
           * statuses — a 404 from a registered route, a 403 from a router with
           * no 403 in it — which cost far more to diagnose than they would
           * have to fail honestly.
           */
          // One PROCESS per file, not one worker thread.
          //
          // These tests configure the server through `process.env` — the auth
          // middleware reads it per request precisely so a test can toggle
          // enforcement. Worker threads share one process, so `AUTH_REQUIRED`
          // set by the auth file lands on every file running beside it, and
          // their requests start failing on a credential they never asked for.
          //
          // That was a real flake, not a theory: roughly one integration run in
          // five failed somewhere unrelated to auth, and it reproduced on
          // demand by running the auth file alongside any other. Per-file
          // processes give each file its own environment — which is what the
          // per-file temp DATA_DIR in integration-setup.ts already assumes.
          pool: "forks",
        },
      },
    ],
  },
});
