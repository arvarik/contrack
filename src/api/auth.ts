/**
 * Auth API client.
 *
 * These endpoints sit outside the `requireAuth` gate, so they use `fetch`
 * directly rather than the shared `apiFetch` — the whole point of
 * `/api/auth/status` is that it answers before we know whether we are allowed
 * to ask anything else, and the shared client's 401 handling would be circular
 * here.
 *
 * Every call returns the server's message on failure rather than a status
 * code, because these are the errors a person reads while typing.
 *
 * @module api/auth
 */

import { API_BASE, NetworkError } from "./client";

export interface AccountUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AuthStatus {
  /** The instance requires a credential. */
  authRequired: boolean;
  /** This browser currently has one. */
  authenticated: boolean;
  /** Gated, but no account exists yet — show the setup screen. */
  setupRequired: boolean;
  hasAccounts: boolean;
  user: AccountUser | null;
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
 * Call an auth endpoint, surfacing the server's own error text.
 *
 * A transport failure throws {@link NetworkError} so the sign-in screen can
 * distinguish "wrong password" from "the server is not there", which are very
 * different things to tell someone staring at a login form.
 */
async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
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
    const envelope = (body as { error?: { message?: string } } | null)?.error;
    throw new Error(envelope?.message || `Sign-in failed (HTTP ${res.status})`);
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
  return authFetch("/setup", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export function updateProfile(input: {
  email?: string;
  username?: string;
  displayName?: string;
}): Promise<{ user: AccountUser }> {
  return authFetch("/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean }> {
  return authFetch("/change-password", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  return authFetch("/sessions");
}

/** Sign out every other device, keeping this one. */
export function revokeOtherSessions(): Promise<{ revoked: number }> {
  return authFetch("/sessions", { method: "DELETE" });
}
