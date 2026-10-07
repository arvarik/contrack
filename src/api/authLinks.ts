/** Password resets and magic link sign-in, outside the gate (`authFetch`). */

import { authFetch, type AccountUser } from "./auth";

/** Asks for a reset email. Always 202, even for an unknown address. */
export async function requestPasswordReset(email: string): Promise<void> {
  await authFetch<Record<string, never>>("/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Completes a password reset with the token and a new password. */
export async function completePasswordReset(input: {
  token: string;
  password: string;
}): Promise<{ user: AccountUser }> {
  return authFetch<{ user: AccountUser }>("/password-reset/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Asks for a sign-in link. Throws `MAGIC_LINK_OFF` when they are off. */
export async function requestMagicLink(email: string): Promise<void> {
  await authFetch<Record<string, never>>("/magic-link/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Completes a magic link sign-in with its token. */
export async function completeMagicLink(input: {
  token: string;
  remember?: boolean;
}): Promise<{ user: AccountUser }> {
  return authFetch<{ user: AccountUser }>("/magic-link/complete", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
