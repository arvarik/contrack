/**
 * API client for password resets and magic link sign-in.
 *
 * Like other unauthenticated endpoints outside the gate, these use `authFetch`
 * to communicate directly with `/api/auth/*`.
 *
 * @module api/authLinks
 */

import { authFetch, type AccountUser } from "./auth";

/**
 * Request a password reset email.
 *
 * Always succeeds (202 Accepted) even if the address is unknown, preventing enumeration.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await authFetch<Record<string, never>>("/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Complete a password reset with a verified token and new password.
 */
export async function completePasswordReset(input: {
  token: string;
  password: string;
}): Promise<{ user: AccountUser }> {
  return authFetch<{ user: AccountUser }>("/password-reset/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Request a magic link sign-in email.
 *
 * Throws ApiError with code MAGIC_LINK_OFF if magic links are disabled.
 */
export async function requestMagicLink(email: string): Promise<void> {
  await authFetch<Record<string, never>>("/magic-link/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Complete magic link sign-in with a verified token.
 */
export async function completeMagicLink(input: {
  token: string;
  remember?: boolean;
}): Promise<{ user: AccountUser }> {
  return authFetch<{ user: AccountUser }>("/magic-link/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
