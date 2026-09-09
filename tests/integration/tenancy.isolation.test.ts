// =============================================================================
// Integration Tests — the isolation matrix (skeleton)
// =============================================================================
// One row per scoped route, each starting as `it.todo`. Phase 2 replaces a
// todo with a real two-user test as it converts each domain, so the diff of
// every Phase 2 PR shows the matrix filling in and the reviewer can see what
// is still unproven.
//
// The rows are generated from ROUTE_MANIFEST rather than written out, so a
// new scoped route arrives here as a new todo automatically and cannot be
// forgotten.
//
// Phase 0 adds no assertions. Nothing is scoped yet, and a test that passed
// today would only prove that one user exists.
// =============================================================================

import { describe, it } from "vitest";
import { ROUTE_MANIFEST } from "../../server/tenancy/routeManifest.ts";

const scoped = ROUTE_MANIFEST.filter((r) => r.class === "scoped");

/**
 * Endpoints that return a collection. These need a second assertion beyond
 * "B cannot read A's row by id": the list itself must not leak A's rows into
 * B's response, which is the failure mode a per-id check cannot catch.
 */
const collections = scoped.filter(
  (r) => r.method === "GET" && !r.path.includes("/:"),
);

describe("route isolation: user B cannot reach user A's data", () => {
  for (const route of scoped) {
    it.todo(`${route.method} ${route.path}: user B cannot reach user A's data`);
  }
});

describe("list endpoints exclude other owners", () => {
  for (const route of collections) {
    it.todo(`${route.method} ${route.path}: returns only the caller's rows`);
  }
});
