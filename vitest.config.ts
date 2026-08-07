import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
    projects: [
      {
        // Unit tests run against a mocked database (tests/setup.ts stubs
        // server/db.ts) so they exercise pure logic only.
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["./tests/setup.ts"],
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
