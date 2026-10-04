// =============================================================================
// Contracts: the registry
// =============================================================================
// One contract for each route that has one, looked up by the key the route
// manifest uses: `"GET /api/contacts/:id"`. The response check in
// `tests/integration/helpers.ts` and `scripts/openapi.ts` read it.
//
// `UNCONTRACTED` lists every route in `server/tenancy/routeManifest.ts` that
// has no contract yet. `tests/integration/contracts.test.ts` holds the two
// lists to the manifest and holds this one's length to
// `UNCONTRACTED_CEILING`, so a new route gets a contract.
// =============================================================================

import { actionItemRoutes } from "./actionItems.ts";
import { contactRoutes } from "./contacts.ts";
import { interactionRoutes } from "./interactions.ts";
import { jobRoutes } from "./jobs.ts";
import { listRoutes } from "./lists.ts";
import { queryRoutes } from "./query.ts";
import type { RouteContract } from "./route.ts";
import { tagRoutes } from "./tags.ts";
import { tokenRoutes } from "./tokens.ts";

export {
  route,
  type BodyOf,
  type HttpMethod,
  type ResponseOf,
  type RouteContract,
} from "./route.ts";

/** Every contract, one for each contracted route. */
export const CONTRACTS: readonly RouteContract[] = [
  ...Object.values(actionItemRoutes),
  ...Object.values(contactRoutes),
  ...Object.values(interactionRoutes),
  ...Object.values(jobRoutes),
  ...Object.values(listRoutes),
  ...Object.values(queryRoutes),
  ...Object.values(tagRoutes),
  ...Object.values(tokenRoutes),
];

/** The key the route manifest and `UNCONTRACTED` use for a route. */
export function routeKey(method: string, path: string): string {
  return `${method} ${path}`;
}

const byKey = new Map(CONTRACTS.map((c) => [routeKey(c.method, c.path), c]));

/** The contract of `"METHOD /path"`, or undefined when it has none. */
export function contractFor(key: string): RouteContract | undefined {
  return byKey.get(key);
}

/**
 * The manifest routes with no contract yet. Contract one, and take it off
 * this list in the same change.
 */
export const UNCONTRACTED: readonly string[] = [
  "GET /api/admin/audit",
  "GET /api/admin/health",
  "GET /api/admin/integrations",
  "PUT /api/admin/integrations",
  "GET /api/admin/invitations",
  "POST /api/admin/invitations",
  "DELETE /api/admin/invitations/:id",
  "GET /api/admin/mail",
  "PUT /api/admin/mail",
  "DELETE /api/admin/mail",
  "POST /api/admin/mail/test",
  "GET /api/admin/settings",
  "PUT /api/admin/settings",
  "GET /api/admin/users",
  "POST /api/admin/users",
  "DELETE /api/admin/users/:id",
  "GET /api/admin/users/:id",
  "PATCH /api/admin/users/:id",
  "POST /api/admin/users/:id/disable",
  "POST /api/admin/users/:id/enable",
  "GET /api/admin/users/:id/export",
  "POST /api/admin/users/:id/reset-password",
  "POST /api/admin/users/:id/reset-link",
  "POST /api/ai-search",
  "POST /api/ai-search/:batchId/cancel",
  "GET /api/ai-search/status",
  "GET /api/ai-search/stream",
  "GET /api/ai/diagnostics",
  "GET /api/ai/grounding-capacity",
  "GET /api/ai/instance",
  "GET /api/ai/stats/feed",
  "GET /api/ai/stats/summary",
  "POST /api/auth/accept-invitation",
  "POST /api/auth/change-password",
  "POST /api/auth/login",
  "POST /api/auth/passkeys/login/options",
  "POST /api/auth/passkeys/login/verify",
  "POST /api/auth/passkeys/register/options",
  "POST /api/auth/passkeys/register/verify",
  "GET /api/auth/passkeys",
  "PATCH /api/auth/passkeys/:id",
  "DELETE /api/auth/passkeys/:id",
  "POST /api/auth/passkey-nudge/dismiss",
  "POST /api/auth/logout",
  "GET /api/auth/me",
  "PATCH /api/auth/me",
  "POST /api/auth/me/avatar",
  "DELETE /api/auth/me/avatar",
  "GET /api/auth/session-policy",
  "PUT /api/auth/session-policy",
  "DELETE /api/auth/sessions",
  "GET /api/auth/sessions",
  "POST /api/auth/register",
  "GET /api/auth/preferences",
  "PATCH /api/auth/preferences",
  "DELETE /api/auth/preferences/:key",
  "POST /api/auth/setup",
  "GET /api/auth/status",
  "POST /api/auth/password-reset/request",
  "POST /api/auth/password-reset/complete",
  "POST /api/auth/magic-link/request",
  "POST /api/auth/magic-link/complete",
  "GET /api/avatar/:style",
  "GET /api/backups",
  "POST /api/backups",
  "GET /api/command-palette/zero-state",
  "GET /api/connectors",
  "POST /api/connectors",
  "DELETE /api/connectors/:id",
  "GET /api/connectors/:id",
  "PATCH /api/connectors/:id",
  "GET /api/connectors/:id/runs",
  "POST /api/connectors/:id/sync",
  "GET /api/connectors/correspondents",
  "POST /api/connectors/correspondents/ignore",
  "GET /api/connectors/google/callback",
  "GET /api/connectors/google/start",
  "GET /api/connectors/kinds",
  "POST /api/connectors/test",
  "GET /api/dashboard",
  "GET /api/dashboard/activity",
  "GET /api/dashboard/insight",
  "GET /api/debug/cache-stats",
  "GET /api/dedupe/active",
  "POST /api/dedupe/backfill-embeddings",
  "GET /api/dedupe/embedding-status",
  "GET /api/dedupe/merge-log",
  "POST /api/dedupe/merge-log/:id/undo",
  "POST /api/dedupe/scan",
  "GET /api/dedupe/status",
  "GET /api/dedupe/stream",
  "GET /api/dedupe/suggestion-for/:contactId",
  "GET /api/dedupe/suggestions",
  "POST /api/dedupe/suggestions/:id/dismiss",
  "POST /api/dedupe/suggestions/:id/merge",
  "GET /api/dedupe/suggestions/count",
  "GET /api/export/csv",
  "GET /api/export/json",
  "GET /api/export/vcard",
  "GET /api/geo/search",
  "GET /api/imports",
  "GET /api/imports/:id",
  "GET /api/imports/:id/rows",
  "POST /api/imports/:id/retry",
  "GET /api/link-preview/unfurl",
  "GET /api/logos/:domain",
  "GET /api/map/views",
  "POST /api/map/views",
  "PATCH /api/map/views/:id",
  "DELETE /api/map/views/:id",
  "DELETE /api/mcp",
  "GET /api/mcp",
  "POST /api/mcp",
  "POST /api/parse-contact",
  "GET /api/search",
  "GET /api/search/coverage",
  "DELETE /api/search/history",
  "GET /api/search/history",
  "POST /api/search/history",
  "DELETE /api/search/history/:id",
  "PATCH /api/search/history/:id",
  "GET /api/search/interactions",
  "POST /api/search/refresh-index",
  "POST /api/search/semantic",
  "GET /api/search/starters",
  "POST /api/search/synthesize",
  "GET /api/settings/ai",
  "PUT /api/settings/ai/capabilities/:capability",
  "PUT /api/settings/ai/endpoints",
  "PUT /api/settings/ai/instance",
  "DELETE /api/settings/ai/endpoints/:id",
  "GET /api/settings/ai/models/:capability",
  "DELETE /api/settings/ai/providers/:id/key",
  "PUT /api/settings/ai/providers/:id/key",
  "POST /api/settings/ai/providers/:id/refresh-models",
  "PUT /api/settings/ai/web-search",
  "PUT /api/settings/ai/searxng",
  "GET /api/trash",
  "DELETE /api/trash/:id",
  "POST /api/trash/:id/restore",
  "POST /api/trash/bulk-restore",
  "GET /healthz",
  "USE /uploads",
];

/**
 * How many entries `UNCONTRACTED` holds. The test fails when the two differ,
 * so lower it when you contract a route. A new route gets a contract: listing
 * it here instead means raising this number, which is a decision for the
 * review.
 */
export const UNCONTRACTED_CEILING = 143;
