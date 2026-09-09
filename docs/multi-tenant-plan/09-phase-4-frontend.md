# 09. Phase 4: Frontend

**Goal:** the UI knows who is signed in and what they may do. Admins get a
user-management area. Members get personal tokens. The setup and sign-in
flows cover invitations, registration, forced password change, and the
local owner account. Every API module reports errors through one handler so
the new `403` codes reach the gate from every call site.

**Lands on:** the `v2.0` branch, one PR from `v2.0/phase-4-frontend` (or
two: auth flows and account settings, then the admin area).

**Size:** L (about 8 to 11 engineering days).

**Depends on:** Phase 3 for the endpoints. UI work can start against the
API contracts in [13-api-changes.md](13-api-changes.md) once Phase 3 has
stubbed them.

This document is written so that an implementer can work from it alone.
Section 0 gives the repository facts, the workflow, and the exact state of
the frontend files this phase edits.

---

## 0. Context for the implementer

### 0.1 Repository, commands, and workflow

Same as [05-phase-0-foundations.md](05-phase-0-foundations.md) sections 0.1
and 0.2. The SPA is React 19 with Vite 8, TanStack Query 5, react-router 7,
Tailwind 4, and `lucide-react`. `npm run dev` serves it. `npm run build`
must pass. `npm run audit:contrast` (`scripts/contrast-audit.mjs`) checks
color contrast. Frontend unit tests live in `tests/unit/frontend.*.test.ts`
(three files today: `commandPalette`, `importers`, `utils`; pure functions,
no component rendering). Feature branch into `v2.0`, squash-merge, raw
vitest summary in the PR, no AI attribution, `package.json` stays at
`1.5.5`.

Design rules from `.agent/STYLE.md`: no `border-*` for sectioning (surface
shifts instead), pill buttons at `9999px`, `glass-panel` for modals and
dropdowns, touch targets `p-2 sm:p-1` for buttons and `py-3 sm:py-2.5` for
list items. The shared primitives `src/components/ui/Modal.tsx` (renders as
a bottom sheet on mobile, 44 px close target, safe-area inset) and
`src/components/ui/IconButton.tsx` (44 × 44) carry the mobile rules; use
them. Write those two rules into `.agent/STYLE.md` in this phase, because
the file does not state them today.

### 0.2 State at the start of this phase (after Phase 3)

Backend: every endpoint in [13-api-changes.md](13-api-changes.md) exists.
`/api/auth/status` carries `registrationOpen`, `localOwnerPresent`,
`legacyTokenConfigured`, `deviceContacts` (and `existingContacts` as an
alias), `user.role`, `user.status`, `user.mustChangePassword`. `/api/auth/me`
carries `role`, `status`, `mustChangePassword`, `credentialState`, `via`.
`403` codes: `ADMIN_REQUIRED`, `SESSION_REQUIRED`, `ACCOUNT_DISABLED`,
`PASSWORD_CHANGE_REQUIRED`, `REGISTRATION_CLOSED`. `429` bodies are the
standard envelope `{ error: { message, code: "RATE_LIMITED", details } }`
with `details.yours` for the dedupe and AI Search locks and a `Retry-After`
header.

Frontend facts, `v1.5.5` line numbers:

| File | Fact |
| ---- | ---- |
| `src/main.tsx` | `queryClient.prefetchQuery({ queryKey: ["contacts"] })` at `:53-64` runs at module load, before `AuthGate` mounts (`:66-76`). On a gated instance it returns 401. |
| `src/components/auth/AuthGate.tsx` | `GateState = "checking" \| "setup" \| "signin" \| "open" \| "unreachable"` (`:59`). `useAuth()` exposes `user, authRequired, refresh, signOut` (`:32-41`). **`AuthContext.Provider` wraps `children` only when `state === "open"`** (`:155-166`); `SetupWizard` and `SignIn` render outside it. `handleAuthenticated` runs `queryClient.clear()` then `check()` (`:103-107`). The `AUTH_EXPIRED_EVENT` listener (`:124-138`) acts only when `state === "open"`. |
| `src/api/auth.ts` | `AccountUser` (`:18-26`) has `id, email, username, displayName, role: string, createdAt, lastLoginAt`. `AuthStatus` (`:28-39`) consumes `authRequired, authenticated, setupRequired, hasAccounts, user, existingContacts`. Uses raw `fetch` by design because these endpoints sit outside the gate. |
| `src/api/client.ts` | `apiFetch()` (`:46`) emits `emitAuthExpired()` on any 401 (`:64-65`). |
| `src/lib/appEvents.ts` | `emitAuthExpired()` dispatches a bare `Event` named `contrack:auth-expired` (`:54-56`), no payload. |
| `src/api/*.ts` | **Ten of twelve modules bypass `apiFetch`** and call `fetch` directly: `actionItems` (4 calls), `aiSearch` (1 plus an `EventSource`), `aiStats` (1), `dashboard` (3), `dedupe` (7 plus an `EventSource`), `enrichment` (2), `interactions` (6), `lists` (8), `search` (2), `suggestions` (5). Only `contacts.ts` (18) and `aiSettings.ts` (9) use `apiFetch`. `index.ts` is a barrel that re-exports every module except `auth`, `client`, and `enrichment`. |
| `src/api/dedupe.ts:40-43`, `src/api/aiSearch.ts:29` | Read the old `429` body as `err.error` (a string). Phase 2 changed the body to the standard envelope; these two were patched to read `error.error.message`. |
| `src/api/enrichment.ts:67` | Maps **every** `429` to "Grounding quota exhausted for today". Wrong for the per-user limiter. |
| `src/components/auth/SetupWizard.tsx` | Prop `existingContacts` (`:58-62`). Title "Set up Contrack" (`:127`). Copy at `:129-137` and `:143-147`. Mirrors server validation: `USERNAME_PATTERN` `:20`, `EMAIL_PATTERN` `:21`, `MIN_PASSWORD_LENGTH = 8` `:22`. |
| `src/components/auth/SignIn.tsx` | `reason?: "expired"` prop (`:19-21`). |
| `src/components/layout/Sidebar.tsx` | Desktop only (`hidden md:flex` at `src/App.tsx:180`). No identity UI. Settings gear link at `:255-261`. Mobile uses a bottom tab bar at `App.tsx:103`. |
| `src/views/SettingsView.tsx` | Segments `account, ai-config, ai-search, ai-stats, lists, dedupe, archived, trash` (`:54-83`). Every subview is a **static import** (`:28-36`); `SettingsView` itself is `React.lazy` in `App.tsx:35-37`, so one chunk holds all settings pages. `/settings/ai-config` renders `src/views/ai-settings/AISettingsView.tsx` (`:175-182`). |
| `src/views/settings/SettingsHome.tsx` | `useAuth()` at `:297`. Account group shown only when `authRequired` (`:308-311`, `:399-415`). Groups: Account, Preferences (`:417`), Intelligence with "AI Configuration" → `/settings/ai-config` (`:518-550`), Organize (`:551`), Data (`:584`). No Administration group. |
| `src/views/settings/AccountSettings.tsx` | Returns a "No account needed" card when `!authRequired \|\| !user` (`:483-500`). Sections: Profile, Password, **"Signed in on"** (`SessionsCard`, key `["auth","sessions"]`, `:309-381`), **"Session length"** (`SessionLengthCard`, key `["auth","session-policy"]`, `PUT /api/auth/session-policy`, `:383-478`), Session with the sign-out button (`:524-548`). No section is called "Devices". |
| Backups | **No UI exists.** A case-insensitive grep for `backup` across `src/` hits only a comment in `src/db/schema.ts:61`. |
| `src/contexts/SessionContext.tsx` | Holds `RecentContext` (`lastContactId`, `:41`, `:82`) and `AISearchSessionContext` (`lastAISearchQuery`, `lastAISearchData`, `lastAISearchPhase`, `:90-94`). There is no `RecentContext.tsx` file. |
| `src/contexts/DedupeContext.tsx` | Holds `scan, scanId, clusters` (`:59-61`) and a `liveScanId` ref (`:68`). **On mount it calls `GET /api/dedupe/active` and adopts any in-progress scan** (`:73-80`). Toasts the error message on failure (`:145-146`). |
| `src/contexts/AISearchContext.tsx` | Holds `batch, batchId, isVisible` (`:42-44`). Toasts on failure (`:64-65`). |
| `src/App.tsx` | `React.lazy` for `MapView, SettingsView, SearchView, DashboardView` (`:32-43`). The three contexts above mount inside `App` (`:395-409`), which is inside `AuthGate` (`main.tsx:70-72`). |
| `src/views/ai-stats/AIStatsView.tsx` | Renders `CacheTiersAccordion` only when `summary?.cacheTiers` is truthy (`:219-221`). `src/api/aiStats.ts:44` types it. |
| Role | Nothing in `src/` reads `AccountUser.role`. Every `.role` hit is `contact.role` (job title). |
| React Query keys | No key includes a user id. The cross-user mitigation is `queryClient.clear()` in `AuthGate` (three call sites). |

---

## 1. Deliverables

| # | Deliverable | Files |
| - | ----------- | ----- |
| 4.1 | `useAuth` exposes `role`, `isAdmin`, `mustChangePassword`, `registrationOpen`, `legacyTokenConfigured`, `localOwnerPresent`; the provider wraps every gate state | `src/components/auth/AuthGate.tsx`, `src/api/auth.ts` |
| 4.2 | New gate states: `password-change`, `join`, `register`; `signin` reasons `expired` and `disabled` | `AuthGate.tsx`, new screens under `src/components/auth/` |
| 4.3 | Setup wizard wording for the local owner; `deviceContacts` | `src/components/auth/SetupWizard.tsx`, `src/api/auth.ts` |
| 4.4 | Identity in the sidebar (desktop) and at the top of Settings (mobile), with sign-out | `src/components/layout/Sidebar.tsx`, `src/views/settings/SettingsHome.tsx` |
| 4.5 | Per-identity query cache reset and post-auth prefetch | `src/main.tsx`, `AuthGate.tsx` |
| 4.6 | Account settings: API tokens section | `src/views/settings/AccountSettings.tsx`, `src/api/auth.ts` |
| 4.7 | Admin area: Users, Invitations, Instance, Audit, Backups, lazy-loaded | `src/views/settings/admin/*` (new), `src/views/SettingsView.tsx`, `src/views/settings/SettingsHome.tsx`, `src/api/admin.ts` (new) |
| 4.8 | Route guard `RequireAdmin` | `src/components/auth/RequireAdmin.tsx` (new) |
| 4.9 | AI stats: "all users" toggle for admins | `src/views/ai-stats/*`, `src/api/aiStats.ts` |
| 4.10 | Dedupe and AI Search: queued-behind-another-user states; correct `429` messages | `src/views/dedupe/DedupeView.tsx`, `src/views/ai-search/*`, `src/contexts/DedupeContext.tsx`, `src/contexts/AISearchContext.tsx`, `src/api/dedupe.ts`, `src/api/aiSearch.ts`, `src/api/enrichment.ts` |
| 4.11 | One shared response handler for every API module; `CustomEvent` reasons; SSE fallback | `src/api/client.ts`, every `src/api/*.ts`, `src/lib/appEvents.ts` |
| 4.12 | STYLE.md gains the bottom-sheet and 44 px rules; CHANGELOG entry | `.agent/STYLE.md`, `CHANGELOG.md` |

---

## 2. Tasks

### 4.1 `useAuth` and the provider

```ts
interface AuthContextValue {
  user: AccountUser | null;      // set for every state except "checking", "unreachable", and pre-setup
  authRequired: boolean;
  isAdmin: boolean;              // user?.role === "admin"
  mustChangePassword: boolean;
  registrationOpen: boolean;
  legacyTokenConfigured: boolean;
  localOwnerPresent: boolean;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}
```

`AccountUser` gains `status`, `mustChangePassword`, `credentialState`.
`AuthStatus` gains the new fields and renames `existingContacts` to
`deviceContacts` (the server sends both for 2.0; read `deviceContacts`).

Move `AuthContext.Provider` **above** the screen switch in `AuthGate` so
that `ForcedPasswordChange`, `AcceptInvitation`, and `Register` can call
`useAuth()` for `refresh()` and `user`. Today the provider wraps only the
`open` state.

One rule for hiding account UI: **hide it when `!authRequired`.** On an
auth-off instance the principal is the local owner (`via: "implicit"`), which
exists only when `authRequired` is false, so the two conditions are the same
and `via` is not needed on the client. Apply the rule in `AuthGate` (no
sign-out affordance), `AccountSettings` (`:483`), `SettingsHome` (`:308`),
and the new sidebar identity.

### 4.2 Gate states

`GateState` becomes
`"checking" | "setup" | "signin" | "password-change" | "join" | "register" | "open" | "unreachable"`.

- `join`: when `window.location.pathname === "/join"` and `token` is in the query. `AuthGate` mounts **outside** `BrowserRouter` (`src/main.tsx:70-76` wraps `App`, and `App.tsx:2` owns the router), so it cannot use `useLocation` and reads `window.location` directly; `App`'s route table never sees `/join` because the gate renders the screen instead of `App`. Renders `AcceptInvitation` (email, username, password, display name; mirrors the `SetupWizard` validation constants). On success, `history.replaceState({}, "", "/")` and then `handleAuthenticated`. The token lives in component state only while the form is open and is removed from the URL with `history.replaceState` on mount.
- `register`: reachable from a "Create an account" link on `SignIn` when `registrationOpen`.
- `password-change`: when `user.mustChangePassword`. Renders `ForcedPasswordChange` (current temporary password, new password twice). On success, `refresh()`.
- `signin` gains `reason: "expired" | "disabled" | null`. A `403 ACCOUNT_DISABLED` on sign-in or from any call shows "This account is disabled. Ask your administrator."

### 4.3 Setup wizard

When `status.localOwnerPresent` is true, the title is "Secure this instance"
and the copy says "Contrack has been running without sign-in. Create the
administrator account. The `<deviceContacts>` contacts already here stay
with it." The endpoint is the same `POST /api/auth/setup`. Update the
`existingContacts` references at `src/api/auth.ts:38`, `AuthGate.tsx:65`,
`:77`, `:149`, and `SetupWizard.tsx:58-62`, `:129-147`.

### 4.4 Identity

Desktop: at the bottom of the sidebar, an avatar built from
`/api/avatar/initials?seed=<username>` with a tooltip of the display name.
Click opens a small `glass-panel` menu: display name, role badge, "Account
settings", "Sign out".

Mobile: the sidebar is `hidden md:flex`, so the same identity row renders at
the top of `SettingsHome` (the mobile tab bar at `App.tsx:103` is
unchanged). Hidden when `!authRequired`.

### 4.5 Cache and prefetch

- `main.tsx` stops prefetching `["contacts"]` before the gate resolves. The prefetch moves into `AuthGate` and runs the moment the state becomes `open`. Same result for Cmd+K after the first paint, without a 401 on gated instances.
- `AuthGate` renders `<AppScope key={user?.id ?? "anon"}>` around `children`. A change of identity remounts the tree, which drops every `useState` that might hold another user's data: `RecentContext` and `AISearchSessionContext` in `SessionContext.tsx`, `DedupeContext`, `AISearchContext`. `queryClient.clear()` stays as well.

### 4.6 Account settings: API tokens

New section "API tokens" between "Signed in on" and "Session length": table
of name, prefix, created, last used, expires. "Create token" opens a `Modal`
(name, optional expiry). The token is shown once in a copy field with the
text "Copy it now. It will not be shown again." Revoke with confirmation.
React Query key `["auth", "tokens"]`. API functions `fetchTokens`,
`createToken`, `revokeToken` in `src/api/auth.ts`.

A banner in this section when `legacyTokenConfigured`: "This instance still
uses the environment `API_TOKEN`. Create a personal token and remove the
variable."

The "Session length" card moves to the admin Instance view (4.7). For a
member, the card is gone; for an admin, `AccountSettings` shows a link
"Session length is set under Administration".

### 4.7 Admin area

`src/api/admin.ts` follows the `aiSettings.ts` pattern (uses the shared
client, section 4.11) and covers every `/api/admin/*` endpoint in
[13-api-changes.md](13-api-changes.md) section 4.

Routes under `/settings/admin/*`, all wrapped in `RequireAdmin`, and each
loaded with `React.lazy` inside `SettingsView` so that members never
download the admin chunk. `SettingsView` uses static imports today; convert
the admin routes (and only those) to lazy imports with a `Suspense`
fallback.

| Route | View | Contents |
| ----- | ---- | -------- |
| `/settings/admin/users` | `UsersView` | Table: display name, username, email, role badge, status badge, contacts, last sign-in. "This device" badge for `isLocalOwner`. Row menu: Edit, Reset password, Disable or Enable, Export data, Delete. "Create user" and "Invite" buttons. Mobile: card list. |
| `/settings/admin/users/new` | `CreateUserModal` | Email, username, display name, role, temporary password (generated, shown once, copy button). |
| `/settings/admin/invitations` | `InvitationsView` | Pending links with copy and revoke. Accepted and expired below. "New invitation" form: optional email, role, expiry. The link is shown once after creation. Copy: "Deleting the admin who created a pending invitation revokes it." |
| `/settings/admin/instance` | `InstanceView` | Registration toggle, session length (moved from Account), AI configuration (the existing `AISettingsView` renders here for admins), SearXNG. |
| `/settings/admin/backups` | `BackupsView` | **New UI**: list from `GET /api/backups`, "Snapshot now" → `POST /api/backups`. Nothing surfaces backups in the UI today. |
| `/settings/admin/audit` | `AuditView` | Newest first, "Load more" with `nextBefore`, filter by action. |

`SettingsHome` shows an "Administration" group only for admins. The
"AI Configuration" row moves into that group for admins and becomes a
read-only "Available AI capabilities" card (from `GET /api/settings/ai/`)
for members. `/settings/ai-config` becomes a `<Navigate>`: admins to
`/settings/admin/instance`, members to `/settings`.

Delete user flow: click Delete → call `DELETE` without a decision → modal
shows the counts from the `409` (contacts, interactions, lists, files) →
"Export first" button → checkbox "I understand this cannot be undone" →
Delete with `decision: "purge"`.

Reset password flow: confirm → response shows the temporary password once
with copy.

### 4.8 `RequireAdmin`

```tsx
export function RequireAdmin({ children }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/settings" replace />;
  return children;
}
```

Server enforcement is the real gate. This only hides UI.

### 4.9 AI stats

Admins get a segmented control "Mine / All users" that adds `?scope=all`.
"All users" adds a per-user table under the summary. Members see only their
own. The cache tiers accordion already renders only when the payload
contains `cacheTiers`; no change there.

### 4.10 Queued states and `429` messages

- Dedupe: when `POST /api/dedupe/scan` returns `429` with `details.yours === false`, the progress overlay shows "Another user's scan is running. Yours will start automatically." and polls `GET /api/dedupe/active` every 3 s until the owner's scan appears, then attaches to its SSE stream. `DedupeContext`'s mount-time adoption of the active scan (`:73-80`) is correct once `GET /api/dedupe/active` is scoped (Phase 2e); keep it.
- AI Search: cooldown message uses `details.retryAfterSeconds` (or the `Retry-After` header). A global-lock `429` (`details.yours === false`) shows "Another user's enrichment is running. Try again in a moment."
- `src/api/enrichment.ts:67`: branch on the envelope. `code === "RATE_LIMITED"` → "Too many requests. Try again in `<Retry-After>` seconds." Only a provider-quota error (its own code from the server) keeps the grounding message.
- `src/api/dedupe.ts` and `src/api/aiSearch.ts` read `error.error.message` and `error.error.details` (the Phase 2 patch already reads the message).

### 4.11 One response handler

Add to `src/api/client.ts`:

```ts
export async function handleResponse<T>(res: Response): Promise<T>
// 401 → emitAuthExpired("expired"); 403 ACCOUNT_DISABLED → emitAuthExpired("disabled");
// 403 PASSWORD_CHANGE_REQUIRED → emitPasswordChangeRequired(); 403 ADMIN_REQUIRED → toast;
// 429 → ApiError with code, details, retryAfter; other non-2xx → ApiError with the envelope; 2xx → parsed JSON
```

Then migrate every module that calls `fetch` directly (`actionItems`,
`aiSearch`, `aiStats`, `dashboard`, `dedupe`, `enrichment`, `interactions`,
`lists`, `search`, `suggestions`) to `apiFetch` or to `fetch(...).then(handleResponse)`.
A unit test (`tests/unit/frontend.apiClient.test.ts`) reads every file under
`src/api/` except `auth.ts` and `client.ts` and fails if it finds a `fetch(`
call whose result is not passed through `apiFetch` or `handleResponse`.

`src/lib/appEvents.ts`: `emitAuthExpired(reason: "expired" | "disabled")`
dispatches a `CustomEvent` with `detail: { reason }`. New
`emitPasswordChangeRequired()` and its event name. `AuthGate` reads
`event.detail.reason` and flips to `signin` with that reason, or to
`password-change`.

`EventSource` streams (`dedupe.ts`, `aiSearch.ts`) cannot carry a `403`
body. On the `error` event, the context calls `fetchAuthStatus()`; if the
account is no longer authenticated or is disabled, the gate handles it;
otherwise the context falls back to polling the `status` endpoint every 3 s
until the job completes.

---

## 3. Acceptance criteria

- [ ] Manual walkthrough recorded in `docs/multi-tenant-plan/bench/ui-walkthrough.md` with screenshots: fresh install with auth off (no account UI shown), turn auth on (setup wizard says "Secure this instance"), invite a member, accept in a private window, member cannot see the Administration group, admin resets the member's password, member is forced to change it, admin disables the member (the member's tab drops to sign-in with the disabled reason), admin exports and deletes the member.
- [ ] Two browsers signed in as two users: contacts, lists, dashboard, search, dedupe, AI stats show only their own data.
- [ ] Mobile viewport: every admin table renders as cards, modals as bottom sheets, touch targets 44 px, identity row visible at the top of Settings.
- [ ] Contrast audit (`npm run audit:contrast`) passes for the new views.
- [ ] `npm run build` passes. The admin views are in their own chunk (check the Vite build output).
- [ ] `frontend.apiClient.test.ts` proves no API module bypasses the shared handler.
- [ ] Existing frontend unit tests pass. New pure-function tests for the invitation link parser and the temporary-password display formatter (`tests/unit/frontend.invite.test.ts`).
- [ ] `.agent/STYLE.md` states the bottom-sheet and 44 px rules.
- [ ] CHANGELOG Unreleased has a `Phase 4` block.

---

## 4. Risks

| Risk | Mitigation |
| ---- | ---------- |
| Remounting on identity change loses in-progress UI state on sign-out | That is the goal. Sign-out is rare and the alternative is stale state from another user. |
| The `fetch` migration touches every API module | Mechanical. The unit test that scans `src/api/` keeps it from regressing. |
| Admin views bloat the main bundle | Lazy import per admin route inside `SettingsView`, verified in the build output. |
| The AI configuration move confuses existing single-user operators | For an admin (which every single-user operator is), the page is one click deeper under Administration, and the old route redirects. |

---

## 5. Contract this phase delivers to Phase 5

- Every flow in the walkthrough works end to end on desktop and mobile.
- Every API module reports through the shared handler.
- The identity, admin, and token UI hide correctly on an auth-off instance.

---

## 6. Do not do in this phase

- Do not add per-user server-side preferences UI. `user_settings` stays empty in 2.0 (see [15-additional-v2-features.md](15-additional-v2-features.md)).
- Do not add instance branding beyond what the features document decides.
- Do not bump `package.json` version.
