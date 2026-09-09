// =============================================================================
// Integration Tests — the route manifest matches the app
// =============================================================================
// A route that reaches production unclassified is a route nobody decided the
// tenancy rules for. This test makes that impossible: adding, removing, or
// renaming a route fails here until server/tenancy/routeManifest.ts is
// updated to say what the route is.
//
// The route list comes from the recorder in ./tenancy/listRoutes.ts, not from
// a naive stack walk. Express 5 keeps no mount path strings, so a stack walk
// alone yields "/reorder" rather than "/api/lists/reorder".
// =============================================================================

import { describe, it, expect } from "vitest";
import { createApp } from "../../server/app.ts";
import { listRoutes } from "./tenancy/listRoutes.ts";
import {
  ROUTE_MANIFEST,
  type RouteEntry,
} from "../../server/tenancy/routeManifest.ts";

const registered = listRoutes(() => createApp({ disableRateLimit: true }));
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

const isProduction = process.env.NODE_ENV === "production";
const expected = ROUTE_MANIFEST.filter((r) => !r.devOnly || !isProduction);

describe("route manifest", () => {
  it("classifies every registered route exactly once", () => {
    const counts = new Map<string, number>();
    for (const entry of ROUTE_MANIFEST) {
      counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
    }
    const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
    expect(duplicated).toEqual([]);

    const unclassified = registered
      .map(key)
      .filter((k) => !counts.has(k))
      .sort();
    expect(unclassified).toEqual([]);
  });

  it("has no stale rows for routes that no longer exist", () => {
    const live = new Set(registered.map(key));
    const stale = expected
      .map(key)
      .filter((k) => !live.has(k))
      .sort();
    expect(stale).toEqual([]);
  });

  it("records the /uploads static layer as exactly one static row", () => {
    const staticRows = ROUTE_MANIFEST.filter((r) => r.class === "static");
    expect(staticRows).toHaveLength(1);
    expect(staticRows[0]).toMatchObject({
      method: "USE",
      path: "/uploads",
      class: "static",
    });
    // The recorder must actually see the express.static layer.
    expect(registered.map(key)).toContain("USE /uploads");
  });

  it("includes the dev-only routes, which are registered outside production", () => {
    const devOnly = ROUTE_MANIFEST.filter((r) => r.devOnly)
      .map(key)
      .sort();
    expect(devOnly).toEqual([
      "GET /api/debug/cache-stats",
      "POST /api/dev/seed-duplicates",
    ]);
    // GET /api/debug/cache-stats moved into createApp() so it is visible here.
    if (!isProduction) {
      expect(registered.map(key)).toContain("GET /api/debug/cache-stats");
    }
  });

  it("gives every row a known class and starts every route un-isolated", () => {
    const classes = new Set([
      "public",
      "session-self",
      "scoped",
      "admin",
      "instance-read",
      "static",
    ]);
    for (const entry of ROUTE_MANIFEST as RouteEntry[]) {
      expect(classes.has(entry.class)).toBe(true);
      expect(entry.path.startsWith("/")).toBe(true);
    }
    // Phase 2 flips these one domain at a time. None are converted yet.
    expect(ROUTE_MANIFEST.every((r) => r.isolated === false)).toBe(true);
  });

  it("still classifies the route the mount-order fix made reachable", () => {
    const entry = ROUTE_MANIFEST.find(
      (r) => key(r) === "GET /api/contacts/action-items",
    );
    expect(entry?.class).toBe("scoped");
    expect(registered.map(key)).toContain("GET /api/contacts/action-items");
  });
});
