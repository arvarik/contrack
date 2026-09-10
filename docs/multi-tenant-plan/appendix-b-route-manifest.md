# Appendix B. Route Manifest (Initial Classification)

This is the seed for `server/tenancy/routeManifest.ts` in Phase 0. Classes are
defined in [03-architecture.md](03-architecture.md) section 5.3 and
[05-phase-0-foundations.md](05-phase-0-foundations.md) task 0.3.

| Class | Meaning |
| ----- | ------- |
| `public` | reachable with no credential |
| `session-self` | the caller's own account, needs a browser session |
| `scoped` | owned data for the caller's scope |
| `admin` | `requireAdmin`, mounted on the route itself since Phase 3 |
| `instance-read` | any authenticated caller, no owned data touched |

`isolated` starts `false` for every `scoped` route and flips in Phase 2. It is `true` for all eighty of them as of sub-phase 2i, and the manifest test fails on a `scoped` route that is not. A
sixth class, `static`, marks the `/uploads` `express.static` layer, which is
a middleware layer and not a route. Rows marked `devOnly` are registered only
when `NODE_ENV !== "production"`.

Notes from the 2026-09-08 review, all verified against `server/app.ts` and
the route files:

- `GET /api/contacts/action-items` is **unreachable in 1.5.5**: `contactsRouter` mounts at `server/app.ts:202`, `mcpRouter` at `:204`, and `GET /contacts/:id` (`routes/contacts.ts:122`) captures the path with `id = "action-items"`. Phase 0 mounts `mcpRouter` first.
- `GET /api/debug/cache-stats` is registered in `server.ts:97-102`, outside `createApp()`, so a supertest app never has it. Phase 0 moves it inside `createApp()` behind the same `NODE_ENV` guard and marks it `devOnly`.
- `POST /api/dev/seed-duplicates` is registered only when `NODE_ENV !== "production"` (`routes/dedupe/scan.ts:138`). Marked `devOnly`.
- `GET /uploads/*` is the `express.static` layer (`layer.name === "serveStatic"`, no `route`). Its manifest row is `USE /uploads`, class `static`; `guardUploads` (Phase 2a) is what scopes it.
- `PUT /api/auth/session-policy` had a session guard only (`requireSession`, which Phase 1 renamed from `requireUser`) through 1.5.5: every member could change the instance session lifetime. Phase 2 set the `admin` class and Phase 3 mounted `requireAdmin` behind `requireSession`, so a member now gets `403 ADMIN_REQUIRED`.
- `guardUploads` does not exist in 1.5.5. The `scoped (via guardUploads)` class is a Phase 2 target.
- Express 5 does not keep mount path strings, so the manifest test records them with a `use` wrapper (Phase 0 task 0.3).

## Existing routes

| Method | Path | Class | Phase 2 sub-phase |
| ------ | ---- | ----- | ----------------- |
| GET | `/healthz` | public | |
| GET | `/api/auth/status` | public | |
| POST | `/api/auth/setup` | public | |
| POST | `/api/auth/login` | public | |
| POST | `/api/auth/logout` | public | |
| GET | `/api/auth/me` | session-self | |
| PATCH | `/api/auth/me` | session-self | |
| POST | `/api/auth/change-password` | session-self | |
| GET | `/api/auth/sessions` | session-self | |
| DELETE | `/api/auth/sessions` | session-self | |
| GET | `/api/auth/session-policy` | session-self | |
| PUT | `/api/auth/session-policy` | admin | 2g |
| GET | `/api/avatar/:style` | instance-read | |
| GET | `/api/link-preview/unfurl` | instance-read | |
| GET | `/api/logos/:domain` | instance-read | |
| GET | `/api/search/` | scoped | 2c |
| POST | `/api/search/semantic` | scoped | 2c |
| POST | `/api/search/synthesize` | scoped | 2c |
| GET | `/api/lists/` | scoped | 2b |
| POST | `/api/lists/` | scoped | 2b |
| PUT | `/api/lists/reorder` | scoped | 2b |
| PATCH | `/api/lists/:id` | scoped | 2b |
| GET | `/api/lists/:id/contacts` | scoped | 2b |
| DELETE | `/api/lists/:id` | scoped | 2b |
| POST | `/api/lists/:id/members` | scoped | 2b |
| DELETE | `/api/lists/:id/members/:contactId` | scoped | 2b |
| POST | `/api/lists/:id/members/bulk` | scoped | 2b |
| GET | `/api/contacts/map` | scoped | 2a |
| GET | `/api/contacts/archived` | scoped | 2a |
| GET | `/api/contacts` | scoped | 2a |
| GET | `/api/contacts/:id` | scoped | 2a |
| GET | `/api/contacts/:id/score` | scoped | 2a |
| POST | `/api/contacts` | scoped | 2a |
| POST | `/api/contacts/bulk` | scoped | 2a |
| POST | `/api/parse-contact` | instance-read | |
| POST | `/api/contacts/bulk-delete` | scoped | 2a |
| PUT | `/api/contacts/bulk-update` | scoped | 2a |
| PUT | `/api/contacts/:id` | scoped | 2a |
| PATCH | `/api/contacts/:id` | scoped | 2a |
| DELETE | `/api/contacts/:id` | scoped | 2a |
| POST | `/api/contacts/:id/avatar` | scoped | 2a |
| POST | `/api/contacts/:id/enrich` | scoped | 2a |
| GET | `/api/contacts/:id/timeline` | scoped | 2b |
| POST | `/api/contacts/:id/interactions` | scoped | 2b |
| POST | `/api/contacts/:id/briefing` | scoped | 2b |
| POST | `/api/contacts/:id/promote` | scoped | 2b |
| POST | `/api/contacts/:id/attachments` | scoped | 2b |
| PATCH | `/api/interactions/:id` | scoped | 2b |
| DELETE | `/api/interactions/:id` | scoped | 2b |
| GET | `/api/contacts/:id/relationships` | scoped | 2b |
| GET | `/api/query/contacts` | scoped | 2g |
| GET | `/api/contacts/action-items` | scoped (unreachable until the Phase 0 mount-order fix) | 2g |
| GET | `/api/tags` | scoped | 2g |
| GET | `/api/industries` | scoped | 2g |
| GET | `/api/interactions/search` | scoped | 2g |
| GET | `/api/timeline` | scoped | 2g |
| POST | `/api/dedupe/scan` | scoped | 2e |
| GET | `/api/dedupe/stream` | scoped | 2e |
| GET | `/api/dedupe/active` | scoped | 2e |
| GET | `/api/dedupe/status` | scoped | 2e |
| POST | `/api/dev/seed-duplicates` | scoped, `devOnly` | 2e |
| POST | `/api/contacts/merge` | scoped | 2e |
| POST | `/api/contacts/merge-batch` | scoped | 2e |
| POST | `/api/contacts/merge-cluster` | scoped | 2e |
| POST | `/api/contacts/merge-clusters` | scoped | 2e |
| GET | `/api/dedupe/suggestions` | scoped | 2e |
| GET | `/api/dedupe/suggestions/count` | scoped | 2e |
| GET | `/api/dedupe/suggestion-for/:contactId` | scoped | 2e |
| POST | `/api/dedupe/suggestions/:id/dismiss` | scoped | 2e |
| POST | `/api/dedupe/suggestions/:id/merge` | scoped | 2e |
| GET | `/api/dedupe/merge-log` | scoped | 2e |
| POST | `/api/dedupe/merge-log/:id/undo` | scoped | 2e |
| POST | `/api/dedupe/backfill-embeddings` | admin | 2g |
| GET | `/api/dedupe/embedding-status` | scoped | 2e |
| GET | `/api/action-items` | scoped | 2b |
| GET | `/api/action-items/completed` | scoped | 2b |
| GET | `/api/action-items/count` | scoped | 2b |
| PATCH | `/api/action-items/:id` | scoped | 2b |
| PATCH | `/api/action-items/:id/complete` | scoped | 2b |
| DELETE | `/api/action-items/:id` | scoped | 2b |
| GET | `/api/contacts/:id/action-items` | scoped | 2b |
| POST | `/api/contacts/:id/action-items` | scoped | 2b |
| GET | `/api/dashboard` | scoped | 2d |
| GET | `/api/dashboard/insight` | scoped | 2d |
| GET | `/api/command-palette/zero-state` | scoped | 2d |
| POST | `/api/ai-search` | scoped | 2f |
| GET | `/api/ai-search/status` | scoped | 2f |
| GET | `/api/ai-search/stream` | scoped | 2f |
| POST | `/api/ai-search/:batchId/cancel` | scoped | 2f |
| GET | `/api/trash` | scoped | 2a |
| POST | `/api/trash/:id/restore` | scoped | 2a |
| POST | `/api/trash/bulk-restore` | scoped | 2a |
| DELETE | `/api/trash/:id` | scoped | 2a |
| GET | `/api/backups` | admin | 2g |
| POST | `/api/backups` | admin | 2g |
| GET | `/api/export/json` | scoped | 2g |
| GET | `/api/export/csv` | scoped | 2g |
| GET | `/api/settings/ai/` | instance-read | |
| GET | `/api/settings/ai/models/:capability` | instance-read | |
| PUT | `/api/settings/ai/providers/:id/key` | admin | 2g |
| DELETE | `/api/settings/ai/providers/:id/key` | admin | 2g |
| POST | `/api/settings/ai/providers/:id/refresh-models` | admin | 2g |
| PUT | `/api/settings/ai/endpoints` | admin | 2g |
| DELETE | `/api/settings/ai/endpoints/:id` | admin | 2g |
| PUT | `/api/settings/ai/capabilities/:capability` | admin | 2g |
| PUT | `/api/settings/ai/searxng` | admin | 2g |
| GET | `/api/ai/stats/summary` | scoped | 2f |
| GET | `/api/ai/stats/feed` | scoped | 2f |
| GET | `/api/ai/diagnostics` | admin | 2g |
| GET | `/api/ai/grounding-capacity` | admin | 2g |
| GET | `/api/debug/cache-stats` | admin, `devOnly` (moved inside `createApp()` in Phase 0) | 2g |
| USE | `/uploads` | static (scoped by `guardUploads` from 2a) | 2a |

## Routes added in Phase 3

The first Phase 3 pull request added the thirteen `/api/admin` rows and
`POST /api/auth/accept-invitation`. The token routes, `POST /api/auth/register`
and the two `/api/admin/settings` rows follow in the second one, and are the
six rows marked "not yet" below.

| Method | Path | Class | Status |
| ------ | ---- | ----- | ------ |
| POST | `/api/auth/register` | public | not yet |
| POST | `/api/auth/accept-invitation` | public | shipped |
| GET | `/api/auth/tokens` | session-self | not yet |
| POST | `/api/auth/tokens` | session-self | not yet |
| DELETE | `/api/auth/tokens/:id` | session-self | not yet |
| GET | `/api/admin/users` | admin | shipped |
| POST | `/api/admin/users` | admin | shipped |
| GET | `/api/admin/users/:id` | admin | shipped |
| PATCH | `/api/admin/users/:id` | admin | shipped |
| POST | `/api/admin/users/:id/reset-password` | admin | shipped |
| POST | `/api/admin/users/:id/disable` | admin | shipped |
| POST | `/api/admin/users/:id/enable` | admin | shipped |
| GET | `/api/admin/users/:id/export` | admin | shipped |
| DELETE | `/api/admin/users/:id` | admin | shipped |
| GET | `/api/admin/invitations` | admin | shipped |
| POST | `/api/admin/invitations` | admin | shipped |
| DELETE | `/api/admin/invitations/:id` | admin | shipped |
| GET | `/api/admin/settings` | admin | not yet |
| PUT | `/api/admin/settings` | admin | not yet |
| GET | `/api/admin/audit` | admin | shipped |
