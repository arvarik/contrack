/**
 * The auth API, called two ways.
 *
 * The screens outside the gate (status, setup, sign-in, register, accept an
 * invitation) use `authFetch`, not the shared client: a signed-out browser
 * must not announce its own 401 to the gate that is asking. They show the
 * server's message, because a person reads it while typing.
 *
 * What a signed-in account manages (profile, password, sessions, tokens) goes
 * through `apiJson`, so a `401` there reaches `AuthGate` as it does anywhere.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SessionMethod } from "../../shared/devices";
import type { MapStyleUrls } from "../../shared/geo";
import {
  tokenRoutes,
  type ApiToken,
  type CreatedApiToken,
} from "../../shared/contracts/tokens";
import {
  ApiError,
  API_BASE,
  NetworkError,
  apiFetch,
  apiJson,
  jsonBody,
} from "./client";

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
   * instance runs as.
   */
  credentialState: string;
  mustChangePassword: boolean;
  avatarUrl: string | null;
}

interface AuthStatus {
  /** The instance requires a credential. */
  authRequired: boolean;
  /** This browser currently has one. */
  authenticated: boolean;
  /** Gated, but no account has a password yet — show the setup screen. */
  setupRequired: boolean;
  hasAccounts: boolean;
  user: AccountUser | null;
  /** Contacts this device holds. During setup, what securing carries over. */
  deviceContacts: number;
  /** An admin has opened this instance to anyone who reaches the sign-in page. */
  registrationOpen: boolean;
  /**
   * The instance was never secured, so its data belongs to an account nobody
   * can sign in to. The setup screen says so.
   */
  localOwnerPresent: boolean;
  /** PUBLIC_URL's origin, or null when the operator has not set it. */
  publicUrl?: string | null;
  /** An MCP client can sign in with OAuth here. */
  mcpOAuth?: boolean;
  /**
   * The instance's name, or "". Sent unauthenticated, for the sign-in and
   * join screens, so anybody who can reach the instance sees it.
   */
  instanceName: string;
  /** The basemap style URL per palette. Absent: the map's built-in defaults. */
  map?: MapStyleUrls;
  /** True when outgoing mail is configured (via SMTP_URL or settings). */
  mailConfigured?: boolean;
  /** True when magic link sign-in is enabled and mail is configured. */
  magicLinkSignIn?: boolean;
}

/** One personal API token, as the account's own token list shows it. */
export type ApiTokenSummary = ApiToken;

/** The response to creating a token. `token` exists here and nowhere else. */
export type { CreatedApiToken };

export interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  current: boolean;
  method?: SessionMethod | null;
}

/**
 * Calls an ungated auth endpoint and throws the server's own error text. A
 * transport failure throws {@link NetworkError}, so the sign-in screen can
 * tell "wrong password" from "the server is not there". `fallback` names what
 * failed when the answer is not JSON.
 */
export async function authFetch<T>(
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
    // An `ApiError`, so a caller can act on the status: accepting an
    // invitation tells an unknown link (404) or a spent one (410) from a
    // field to fix. Nothing announces on the window: outside the gate a 401
    // is an expected answer.
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
  remember?: boolean;
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
 * Creates an account on an instance open to registration. Always a member:
 * there is no role field to send.
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
 * Redeems a single-use invitation and creates its account. A `404` is an
 * unknown secret, a `410` a used, revoked or expired one.
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

/**
 * Whether an invitation link can still make an account. Rejects with the
 * `ApiError` that accepting it would: 404 for an unknown link, 410 for a
 * used, revoked or expired one.
 */
export function checkInvitation(token: string): Promise<{ ok: true }> {
  return authFetch(
    "/invitations/check",
    { method: "POST", body: JSON.stringify({ token }) },
    "Could not check the invitation",
  );
}

// Behind the gate, through the shared client

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

// Personal API tokens

/** The account's tokens, newest first, revoked and expired ones included. */
export function fetchApiTokens(): Promise<{ tokens: ApiTokenSummary[] }> {
  return apiJson(tokenRoutes.list, "/auth/tokens");
}

/**
 * Mints a token. The plaintext comes back once, in this response, so the UI
 * must show it before it navigates.
 */
export function createApiToken(input: {
  name: string;
  expiresInDays?: number | null;
  readOnly?: boolean;
}): Promise<CreatedApiToken> {
  return apiJson(tokenRoutes.create, "/auth/tokens", jsonBody(input));
}

/** Stop a token working. The row stays, so its owner can see what happened. */
export function revokeApiToken(id: string): Promise<{ revoked: true }> {
  return apiJson(tokenRoutes.revoke, `/auth/tokens/${encodeURIComponent(id)}`);
}

// Account profile pictures

/**
 * Sets the account's picture. The server makes it a 512 px square JPEG,
 * with EXIF orientation applied and metadata stripped.
 */
export async function uploadAccountAvatar(
  file: File,
): Promise<{ user: AccountUser }> {
  const formData = new FormData();
  formData.append("avatar", file);
  const res = await apiFetch("/auth/me/avatar", {
    method: "POST",
    body: formData,
  });
  return res.json();
}

/** Removes the account's picture, back to initials. Idempotent. */
async function removeAccountAvatar(): Promise<{ user: AccountUser }> {
  const res = await apiFetch("/auth/me/avatar", {
    method: "DELETE",
  });
  return res.json();
}

/** React Query mutation hook for uploading an account avatar. */
export function useUploadAccountAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAccountAvatar(file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}

/** React Query mutation hook for removing an account avatar. */
export function useRemoveAccountAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeAccountAvatar(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });
}
