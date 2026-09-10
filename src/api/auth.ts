/**
 * Auth API client.
 *
 * Two kinds of endpoint live here and they are called two different ways.
 *
 * The screens outside the gate — status, setup, sign-in, register, accept an
 * invitation — use `fetch` directly through `authFetch`. The whole point of
 * `/api/auth/status` is that it answers before we know whether we may ask
 * anything else, and routing it through the shared client would mean a
 * signed-out browser announcing its own 401 to the gate that is asking the
 * question. They also surface the server's message rather than a status code,
 * because these are the errors a person reads while typing.
 *
 * Everything the signed-in account manages — the profile, the password, the
 * session list, the personal tokens — goes through `apiJson` like the rest of
 * the app. Those calls sit behind the gate, so a `401` on one of them means
 * the same thing it means anywhere else and has to reach `AuthGate`. Using
 * `authFetch` for them would leave someone whose session expired staring at a
 * token list that failed to load, with no way back to sign-in.
 *
 * @module api/auth
 */

import { ApiError, API_BASE, NetworkError, apiJson, jsonBody } from "./client";

export interface AccountUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** 'active' | 'disabled'. */
  status: string;
  /**
   * 'password' for a real account, 'none' for the local owner an auth-off
   * instance runs as. Phase 4 uses this to tell "not signed in" apart from
   * "this instance has no accounts yet".
   */
  credentialState: string;
  mustChangePassword: boolean;
}

export interface AuthStatus {
  /** The instance requires a credential. */
  authRequired: boolean;
  /** This browser currently has one. */
  authenticated: boolean;
  /** Gated, but no account has a password yet — show the setup screen. */
  setupRequired: boolean;
  hasAccounts: boolean;
  user: AccountUser | null;
  /**
   * Contacts this device already holds. Only meaningful during setup, where it
   * is what securing the instance will carry over.
   */
  deviceContacts: number;
  /** The pre-2.0 name for `deviceContacts`. Removed in 3.0. */
  existingContacts: number;
  /** An admin has opened this instance to anyone who reaches the sign-in page. */
  registrationOpen: boolean;
  /**
   * This instance has never been secured, so everything in it belongs to an
   * account nobody can sign in to. The setup screen says so in as many words.
   */
  localOwnerPresent: boolean;
  /** The deprecated instance-wide `API_TOKEN` is still set on the server. */
  legacyTokenConfigured: boolean;
}

/** One personal API token, as the account's own token list shows it. */
export interface ApiTokenSummary {
  id: string;
  name: string;
  /** The first twelve characters, enough to tell two tokens apart. */
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** The response to creating a token. `token` exists here and nowhere else. */
export interface CreatedApiToken {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  expiresAt: string | null;
}

export interface SessionPolicy {
  sessionTtlDays: number;
  min: number;
  max: number;
  default: number;
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
}

/**
 * Call an ungated auth endpoint, surfacing the server's own error text.
 *
 * A transport failure throws {@link NetworkError} so the sign-in screen can
 * distinguish "wrong password" from "the server is not there", which are very
 * different things to tell someone staring at a login form.
 *
 * `fallback` names what failed, for the case where the server answers with
 * something that is not JSON. It used to be the fixed string "Sign-in failed",
 * which was right while this file only signed people in and would have told
 * somebody redeeming a dead invitation that their password was wrong.
 */
async function authFetch<T>(
  path: string,
  init?: RequestInit,
  fallback = "Sign-in failed",
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth${path}`, {
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      ...init,
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — fall through to the status-code message.
  }

  if (!res.ok) {
    // An `ApiError`, not a plain `Error`, so a caller can act on the status
    // and the code. The accept-invitation screen has to tell a link the
    // server does not recognise (404) or one it used to (410) apart from a
    // typed field it can fix, and it cannot do that from a message string.
    // Nothing here announces on the window: these are the screens outside the
    // gate, and a 401 on one of them is the expected answer, not news.
    const envelope = (
      body as {
        error?: { message?: string; code?: string; requestId?: string };
      } | null
    )?.error;
    throw new ApiError(
      envelope?.message || `${fallback} (HTTP ${res.status})`,
      res.status,
      envelope?.code,
      envelope?.requestId,
    );
  }
  return body as T;
}

/** Ask who we are and what this instance expects. */
export function fetchAuthStatus(): Promise<AuthStatus> {
  return authFetch<AuthStatus>("/status");
}

/** Create the first account. Only possible while no account exists. */
export function setupAccount(input: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: AccountUser }> {
  return authFetch(
    "/setup",
    { method: "POST", body: JSON.stringify(input) },
    "Could not create the account",
  );
}

/** Sign in with a username or email plus password. */
export function signIn(input: {
  identifier: string;
  password: string;
}): Promise<{ user: AccountUser | null }> {
  return authFetch("/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function signOut(): Promise<{ success: boolean }> {
  return authFetch("/logout", { method: "POST" });
}

/**
 * Create an account on an instance that has opened registration.
 *
 * Always creates a member. There is no role field to send: an instance that
 * let a stranger pick their own role would not be gated at all.
 */
export function registerAccount(input: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: AccountUser }> {
  return authFetch(
    "/register",
    { method: "POST", body: JSON.stringify(input) },
    "Could not create the account",
  );
}

/**
 * Redeem an invitation and create the account it was issued for.
 *
 * The secret is single-use. A `404` means the server does not recognise it,
 * and a `410` means it did once — used, revoked, or expired. Both arrive here
 * as the server's own sentence.
 */
export function acceptInvitation(input: {
  token: string;
  email: string;
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: AccountUser }> {
  return authFetch(
    "/accept-invitation",
    { method: "POST", body: JSON.stringify(input) },
    "Could not accept the invitation",
  );
}

// ---------------------------------------------------------------------------
// Behind the gate — routed through the shared client
// ---------------------------------------------------------------------------

export function updateProfile(input: {
  email?: string;
  username?: string;
  displayName?: string;
}): Promise<{ user: AccountUser }> {
  return apiJson("/auth/me", { method: "PATCH", ...jsonBody(input) });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  return apiJson("/auth/change-password", {
    method: "POST",
    ...jsonBody(input),
  });
}

export function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  return apiJson("/auth/sessions");
}

/** Sign out every other device, keeping this one. */
export function revokeOtherSessions(): Promise<{ revoked: number }> {
  return apiJson("/auth/sessions", { method: "DELETE" });
}

/** How long new sessions last, plus the supported range. */
export function fetchSessionPolicy(): Promise<SessionPolicy> {
  return apiJson("/auth/session-policy");
}

/**
 * Change the session lifetime. Applies to sessions created from now on.
 *
 * Deprecated in 2.0 and removed in 3.0: the instance settings endpoint writes
 * the same value. The admin Instance view calls that one; this stays because
 * scripts use it.
 */
export function updateSessionPolicy(
  sessionTtlDays: number,
): Promise<{ sessionTtlDays: number }> {
  return apiJson("/auth/session-policy", {
    method: "PUT",
    ...jsonBody({ sessionTtlDays }),
  });
}

// ---------------------------------------------------------------------------
// Personal API tokens
// ---------------------------------------------------------------------------

/** The account's tokens, newest first, revoked and expired ones included. */
export function fetchApiTokens(): Promise<{ tokens: ApiTokenSummary[] }> {
  return apiJson("/auth/tokens");
}

/**
 * Mint a token.
 *
 * The plaintext comes back once, in this response. Nothing can read it again,
 * which is why the UI that calls this has to show it before it navigates.
 */
export function createApiToken(input: {
  name: string;
  expiresInDays?: number | null;
}): Promise<CreatedApiToken> {
  return apiJson("/auth/tokens", { method: "POST", ...jsonBody(input) });
}

/** Stop a token working. The row stays, so its owner can see what happened. */
export function revokeApiToken(id: string): Promise<{ revoked: true }> {
  return apiJson(`/auth/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
