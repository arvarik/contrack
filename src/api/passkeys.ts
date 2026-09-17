/**
 * Passkeys API client.
 *
 * Provides WebAuthn registration and authentication ceremonies using
 * `@simplewebauthn/browser`, and manages existing passkeys for an account.
 *
 * @module api/passkeys
 */

import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startRegistration,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { apiJson, jsonBody } from "./client";
import { authFetch, type AccountUser } from "./auth";

export interface PasskeySummary {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ListPasskeysResponse {
  passkeys: PasskeySummary[];
  nudgeDismissed: boolean;
}

function isIpHost(hostname: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes(":") ||
    /^\[.*\]$/.test(hostname)
  );
}

/**
 * Returns whether passkeys (WebAuthn) are supported in this browser context.
 * Needs secure context, PublicKeyCredential, and HTTPS or localhost (not an IP address).
 */
export function passkeysSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  if (
    !("PublicKeyCredential" in window) ||
    typeof window.PublicKeyCredential !== "function"
  ) {
    return false;
  }
  const hostname = window.location.hostname;
  if (isIpHost(hostname)) return false;
  if (window.location.protocol !== "https:" && hostname !== "localhost") {
    return false;
  }
  return browserSupportsWebAuthn();
}

/**
 * Returns whether WebAuthn conditional UI (autofill) is supported.
 */
export async function passkeyAutofillSupported(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  return browserSupportsWebAuthnAutofill();
}

/**
 * Fetch all passkeys registered to the signed-in user and nudge status.
 */
export async function listPasskeys(): Promise<ListPasskeysResponse> {
  return apiJson<ListPasskeysResponse>("/auth/passkeys");
}

/**
 * Rename an existing passkey.
 */
export async function renamePasskey(
  id: string,
  name: string,
): Promise<PasskeySummary> {
  const result = await apiJson<{ passkey: PasskeySummary }>(
    `/auth/passkeys/${id}`,
    {
      method: "PATCH",
      ...jsonBody({ name }),
    },
  );
  return result.passkey;
}

/**
 * Delete a passkey.
 */
export async function removePasskey(id: string): Promise<void> {
  await apiJson<{ ok: boolean }>(`/auth/passkeys/${id}`, {
    method: "DELETE",
  });
}

/**
 * Dismiss the first-run passkey nudge so it is not shown again.
 */
export async function dismissPasskeyNudge(): Promise<void> {
  await apiJson<{ ok: boolean }>("/auth/passkey-nudge/dismiss", {
    method: "POST",
  });
}

/**
 * Run the WebAuthn registration ceremony for the current user.
 */
export async function registerPasskey(name?: string): Promise<PasskeySummary> {
  const { ceremonyId, options } = await apiJson<{
    ceremonyId: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  }>("/auth/passkeys/register/options", {
    method: "POST",
  });

  const response = await startRegistration({ optionsJSON: options });

  const result = await apiJson<{ passkey: PasskeySummary }>(
    "/auth/passkeys/register/verify",
    {
      method: "POST",
      ...jsonBody({
        ceremonyId,
        name,
        response,
      }),
    },
  );

  return result.passkey;
}

export interface SignInWithPasskeyOptions {
  remember?: boolean;
  signal?: AbortSignal;
  useBrowserAutofill?: boolean;
}

/**
 * Run the WebAuthn authentication ceremony to sign in.
 */
export async function signInWithPasskey(
  options?: SignInWithPasskeyOptions,
): Promise<AccountUser> {
  if (options?.signal?.aborted) {
    WebAuthnAbortService.cancelCeremony();
    throw new DOMException("The user aborted a request.", "AbortError");
  }

  const { ceremonyId, options: authOptions } = await authFetch<{
    ceremonyId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }>("/passkeys/login/options", {
    method: "POST",
    signal: options?.signal,
  });

  const abortHandler = () => {
    WebAuthnAbortService.cancelCeremony();
  };
  options?.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const response = await startAuthentication({
      optionsJSON: authOptions,
      useBrowserAutofill: options?.useBrowserAutofill,
    });

    const result = await authFetch<{ user: AccountUser }>(
      "/passkeys/login/verify",
      {
        method: "POST",
        body: JSON.stringify({
          ceremonyId,
          remember: options?.remember,
          response,
        }),
        signal: options?.signal,
      },
    );

    return result.user;
  } finally {
    options?.signal?.removeEventListener("abort", abortHandler);
  }
}
