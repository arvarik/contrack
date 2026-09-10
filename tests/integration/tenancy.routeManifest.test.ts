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
  });

  it("isolates every scoped route", () => {
    // Phase 2 converted one domain per PR, and this test used to hold the
    // list each PR had proven. Sub-phase 2i closed the phase, so the list is
    // gone and the rule is the assertion: a scoped route that is not isolated
    // is a route with no matrix test behind it.
    const waiting = ROUTE_MANIFEST.filter(
      (r) => r.class === "scoped" && !r.isolated,
    ).map(key);
    expect(waiting, "scoped routes with no isolation test").toEqual([]);

    // Only owned data and the file layer can be isolated. A public or
    // session-self route has no owner to isolate from.
    for (const entry of ROUTE_MANIFEST.filter((r) => r.isolated)) {
      expect(["scoped", "static"]).toContain(entry.class);
    }

    // The uploads layer is a middleware rather than a scoped route, so the
    // rule above cannot reach it. Name it.
    expect(
      ROUTE_MANIFEST.find((r) => key(r) === "USE /uploads")?.isolated,
    ).toBe(true);
  });

  it("guards every admin route with requireAdmin, and nothing else", () => {
    // Phase 2 classified these routes and left them open. Phase 3 mounts the
    // guard on each route rather than on the router, so the check is a two-way
    // one: an `admin` row with no guard is an open operator endpoint, and a
    // guarded route with another class is a manifest that lies about who can
    // reach it. Both directions fail here.
    const guards = new Map(
      registered.map((r) => [key(r), r.handlers.includes("requireAdmin")]),
    );

    const unguarded = expected
      .filter((r) => r.class === "admin")
      .map(key)
      .filter((k) => guards.get(k) === false)
      .sort();
    expect(unguarded, "admin routes with no requireAdmin").toEqual([]);

    const classOf = new Map(ROUTE_MANIFEST.map((r) => [key(r), r.class]));
    const misclassified = [...guards.entries()]
      .filter(([k, guarded]) => guarded && classOf.get(k) !== "admin")
      .map(([k]) => k)
      .sort();
    expect(misclassified, "guarded routes not classed admin").toEqual([]);

    // An admin route reads or writes the instance, so none of them is
    // isolated by owner.
    for (const entry of ROUTE_MANIFEST.filter((r) => r.class === "admin")) {
      expect(entry.isolated, key(entry)).toBe(false);
    }
  });

  it("counts the routes Phase 3 added", () => {
    // A cheap tripwire: the admin surface grew from fourteen classified rows
    // to twenty-nine guarded ones, and a route added without a decision moves
    // this number.
    const admin = ROUTE_MANIFEST.filter((r) => r.class === "admin");
    expect(admin).toHaveLength(29);
    expect(
      ROUTE_MANIFEST.filter((r) => r.path.startsWith("/api/admin/")),
    ).toHaveLength(15);

    // The three token routes act on the caller's own account, so a token
    // cannot reach them and neither can the implicit local owner.
    const tokens = ROUTE_MANIFEST.filter((r) =>
      r.path.startsWith("/api/auth/tokens"),
    );
    expect(tokens).toHaveLength(3);
    for (const row of tokens) expect(row.class).toBe("session-self");
  });

  it("still classifies the route the mount-order fix made reachable", () => {
    const entry = ROUTE_MANIFEST.find(
      (r) => key(r) === "GET /api/contacts/action-items",
    );
    expect(entry?.class).toBe("scoped");
    expect(registered.map(key)).toContain("GET /api/contacts/action-items");
  });
});
