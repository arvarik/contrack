// =============================================================================
// Route manifest — every route this app registers, and what guards it
// =============================================================================
// The manifest is the checklist Phase 2 works through. Every route is
// classified, and tenancy.routeManifest.test.ts fails if a route is added,
// removed, or renamed without updating this file. A new route cannot reach
// production unclassified, which is the point.
//
// `isolated` starts false for every route and flips as Phase 2 converts each
// one and its isolation test goes green. The manifest test used to name the
// routes that had flipped, so a sub-phase could not claim one it did not
// prove. Sub-phase 2i closed the phase and replaced that list with the rule
// it was standing in for: every `scoped` route is isolated, and
// tenancy.routeManifest.test.ts fails if one is not.
//
// The `admin` rows are enforced from Phase 3: each of those routes mounts
// `requireAdmin` on the route itself, and the manifest test reads every admin
// row's handler stack and fails when the guard is missing. Adding an admin
// route without the guard is therefore a red test rather than a review miss.
//
// Seeded from docs/multi-tenant-plan/appendix-b-route-manifest.md.
// =============================================================================

export type RouteClass =
  /** No credential needed: /healthz, /api/auth/status, /api/auth/login. */
  | "public"
  /** Acts on the caller's own account: /api/auth/me, /api/auth/tokens. */
  | "session-self"
  /** Reads or writes owned data for the caller's scope. */
  | "scoped"
  /** requireAdmin. */
  | "admin"
  /** Any authenticated caller, no owned data: /api/avatar/:style. */
  | "instance-read"
  /** The /uploads express.static layer. Guarded by middleware, not a route. */
  | "static";

export interface RouteEntry {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "USE";
  /** Full path as a client sends it, including the mount prefix. */
  path: string;
  class: RouteClass;
  /** Phase 2 flips this when the isolation test for the route is green. */
  isolated: boolean;
  /** Only registered when NODE_ENV !== "production". */
  devOnly?: boolean;
}

export const ROUTE_MANIFEST: readonly RouteEntry[] = [
  {
    method: "GET",
    path: "/api/action-items",
    class: "scoped",
    isolated: true,
  },
  {
    method: "DELETE",
    path: "/api/action-items/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PATCH",
    path: "/api/action-items/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PATCH",
    path: "/api/action-items/:id/complete",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/action-items/completed",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/action-items/count",
    class: "scoped",
    isolated: true,
  },
  // ── Instance administration (Phase 3) ──────────────────────────────────
  // Every row below carries `requireAdmin` on the route itself. The manifest
  // test reads each route's stack and fails when one does not.
  {
    method: "GET",
    path: "/api/admin/audit",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/health",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/invitations",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/admin/invitations",
    class: "admin",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/admin/invitations/:id",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/settings",
    class: "admin",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/admin/settings",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/users",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/admin/users",
    class: "admin",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/admin/users/:id",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/users/:id",
    class: "admin",
    isolated: false,
  },
  {
    method: "PATCH",
    path: "/api/admin/users/:id",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/admin/users/:id/disable",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/admin/users/:id/enable",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/admin/users/:id/export",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/admin/users/:id/reset-password",
    class: "admin",
    isolated: false,
  },
  { method: "POST", path: "/api/ai-search", class: "scoped", isolated: true },
  {
    method: "POST",
    path: "/api/ai-search/:batchId/cancel",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/ai-search/status",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/ai-search/stream",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/ai/diagnostics",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/ai/grounding-capacity",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/ai/stats/feed",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/ai/stats/summary",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/auth/accept-invitation",
    class: "public",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/auth/change-password",
    class: "session-self",
    isolated: false,
  },
  { method: "POST", path: "/api/auth/login", class: "public", isolated: false },
  {
    method: "POST",
    path: "/api/auth/logout",
    class: "public",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/auth/me",
    class: "session-self",
    isolated: false,
  },
  {
    method: "PATCH",
    path: "/api/auth/me",
    class: "session-self",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/auth/session-policy",
    class: "session-self",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/auth/session-policy",
    class: "admin",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/auth/sessions",
    class: "session-self",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/auth/sessions",
    class: "session-self",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/auth/register",
    class: "public",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/auth/tokens",
    class: "session-self",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/auth/tokens",
    class: "session-self",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/auth/tokens/:id",
    class: "session-self",
    isolated: false,
  },
  { method: "POST", path: "/api/auth/setup", class: "public", isolated: false },
  { method: "GET", path: "/api/auth/status", class: "public", isolated: false },
  {
    method: "GET",
    path: "/api/avatar/:style",
    class: "instance-read",
    isolated: false,
  },
  { method: "GET", path: "/api/backups", class: "admin", isolated: false },
  { method: "POST", path: "/api/backups", class: "admin", isolated: false },
  {
    method: "GET",
    path: "/api/command-palette/zero-state",
    class: "scoped",
    isolated: true,
  },
  { method: "GET", path: "/api/contacts", class: "scoped", isolated: true },
  { method: "POST", path: "/api/contacts", class: "scoped", isolated: true },
  {
    method: "DELETE",
    path: "/api/contacts/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PATCH",
    path: "/api/contacts/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PUT",
    path: "/api/contacts/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/:id/action-items",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/action-items",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/attachments",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/avatar",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/briefing",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/enrich",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/interactions",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/:id/promote",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/:id/relationships",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/:id/score",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/:id/timeline",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/action-items",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/archived",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/bulk",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/bulk-delete",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PUT",
    path: "/api/contacts/bulk-update",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/contacts/map",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/merge",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/merge-batch",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/merge-cluster",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/contacts/merge-clusters",
    class: "scoped",
    isolated: true,
  },
  { method: "GET", path: "/api/dashboard", class: "scoped", isolated: true },
  {
    method: "GET",
    path: "/api/dashboard/insight",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/debug/cache-stats",
    class: "admin",
    isolated: false,
    devOnly: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/active",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dedupe/backfill-embeddings",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/dedupe/embedding-status",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/merge-log",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dedupe/merge-log/:id/undo",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dedupe/scan",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/status",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/stream",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/suggestion-for/:contactId",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/suggestions",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dedupe/suggestions/:id/dismiss",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dedupe/suggestions/:id/merge",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/dedupe/suggestions/count",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/dev/seed-duplicates",
    class: "scoped",
    isolated: true,
    devOnly: true,
  },
  { method: "GET", path: "/api/export/csv", class: "scoped", isolated: true },
  { method: "GET", path: "/api/export/json", class: "scoped", isolated: true },
  { method: "GET", path: "/api/industries", class: "scoped", isolated: true },
  {
    method: "DELETE",
    path: "/api/interactions/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PATCH",
    path: "/api/interactions/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/interactions/search",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/link-preview/unfurl",
    class: "instance-read",
    isolated: false,
  },
  { method: "GET", path: "/api/lists", class: "scoped", isolated: true },
  { method: "POST", path: "/api/lists", class: "scoped", isolated: true },
  {
    method: "DELETE",
    path: "/api/lists/:id",
    class: "scoped",
    isolated: true,
  },
  { method: "PATCH", path: "/api/lists/:id", class: "scoped", isolated: true },
  {
    method: "GET",
    path: "/api/lists/:id/contacts",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/lists/:id/members",
    class: "scoped",
    isolated: true,
  },
  {
    method: "DELETE",
    path: "/api/lists/:id/members/:contactId",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/lists/:id/members/bulk",
    class: "scoped",
    isolated: true,
  },
  {
    method: "PUT",
    path: "/api/lists/reorder",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/logos/:domain",
    class: "instance-read",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/parse-contact",
    class: "instance-read",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/query/contacts",
    class: "scoped",
    isolated: true,
  },
  { method: "GET", path: "/api/search", class: "scoped", isolated: true },
  {
    method: "POST",
    path: "/api/search/semantic",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/search/synthesize",
    class: "scoped",
    isolated: true,
  },
  {
    method: "GET",
    path: "/api/settings/ai",
    class: "instance-read",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/settings/ai/capabilities/:capability",
    class: "admin",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/settings/ai/endpoints",
    class: "admin",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/settings/ai/endpoints/:id",
    class: "admin",
    isolated: false,
  },
  {
    method: "GET",
    path: "/api/settings/ai/models/:capability",
    class: "instance-read",
    isolated: false,
  },
  {
    method: "DELETE",
    path: "/api/settings/ai/providers/:id/key",
    class: "admin",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/settings/ai/providers/:id/key",
    class: "admin",
    isolated: false,
  },
  {
    method: "POST",
    path: "/api/settings/ai/providers/:id/refresh-models",
    class: "admin",
    isolated: false,
  },
  {
    method: "PUT",
    path: "/api/settings/ai/searxng",
    class: "admin",
    isolated: false,
  },
  { method: "GET", path: "/api/tags", class: "scoped", isolated: true },
  { method: "GET", path: "/api/timeline", class: "scoped", isolated: true },
  { method: "GET", path: "/api/trash", class: "scoped", isolated: true },
  {
    method: "DELETE",
    path: "/api/trash/:id",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/trash/:id/restore",
    class: "scoped",
    isolated: true,
  },
  {
    method: "POST",
    path: "/api/trash/bulk-restore",
    class: "scoped",
    isolated: true,
  },
  { method: "GET", path: "/healthz", class: "public", isolated: false },
  { method: "USE", path: "/uploads", class: "static", isolated: true },
];
