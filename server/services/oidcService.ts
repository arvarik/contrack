// OIDC sign-in against the one provider an admin configured
// (integrationSettings.ts). openid-client does discovery and PKCE, sends the
// client secret with HTTP Basic (client_secret_basic), and checks the ID
// token's issuer, audience, expiry, nonce and its signature against the
// provider's published JWKS. Every request it makes, the JWKS included, goes
// through safeFetch, follows no redirect and has ten seconds. The discovered
// provider is reused for an hour. A flow's state, PKCE verifier,
// nonce, link target, "keep me signed in" choice and return path wait in
// auth_challenges (kind 'oidc') for at most ten minutes, and the callback
// consumes them once.

import * as client from "openid-client";
import { sqlite } from "../db.ts";
import { AppError, ValidationError } from "../utils/AppError.ts";
import { safeFetch } from "../utils/urlSafety.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { log } from "../utils/logger.ts";
import {
  getOidcConfig,
  setOidcConfig,
  type OidcConfig,
  type OidcConfigInput,
} from "./integrationSettings.ts";
import { isAllowedIssuer } from "../../shared/contracts/admin.ts";

const FLOW_TTL_MS = 10 * 60 * 1000;
const SCOPE = "openid email profile";

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

/** What a flow's row holds, as JSON in `challenge`. */
interface FlowData {
  codeVerifier: string;
  nonce: string;
  /** False for a session that ends with the browser. */
  remember: boolean;
  /** Where a sign-in lands: a path on this origin, or null for `/`. */
  returnTo: string | null;
}

/** A flow the callback consumed. */
export interface OidcFlow extends FlowData {
  /** The account a link flow started from, or null for a sign-in. */
  userId: string | null;
  expired: boolean;
}

/**
 * `value` when it is a path on this origin, else null, so a sign-in cannot be
 * sent elsewhere (open redirect). One leading slash, never `//host` or
 * `/\host`, no backslash or control character anywhere, at most 2048
 * characters. A path cannot carry a scheme, so `https://…` fails too.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  return /^\/(?![/\\])[^\\\p{Cc}]*$/u.test(value) ? value : null;
}

/**
 * openid-client's fetch, routed through safeFetch. The issuer is admin-chosen,
 * so private addresses are allowed, as for SearXNG. safeFetch returns error
 * responses as they are, so openid-client reports the provider's error.
 */
const viaSafeFetch: client.CustomFetch = async (url, options) => {
  const { body } = options;
  if (
    body != null &&
    typeof body !== "string" &&
    !(body instanceof URLSearchParams)
  ) {
    throw new AppError("Unsupported OIDC request body", 500);
  }
  const { response } = await safeFetch(url, {
    method: options.method,
    headers: options.headers,
    body: body == null ? undefined : String(body),
    signal: options.signal,
    // openid-client always asks for "manual": a redirect must reach it, not be
    // followed with the code and verifier.
    redirect: options.redirect,
    allowPrivate: true,
    timeoutMs: 10_000,
  });
  return response;
};

/** How long a discovered provider is used before it is asked again. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

let cached: { key: string; at: number; config: client.Configuration } | null =
  null;

/** Drop the discovered provider, after an admin changes it. */
export function forgetOidcDiscovery(): void {
  cached = null;
}

function requireConfig(): OidcConfig {
  const config = getOidcConfig();
  if (!config) {
    throw new AppError("Single sign-on is not set up", 404, {
      code: "OIDC_NOT_CONFIGURED",
    });
  }
  return config;
}

async function discover(
  config: OidcConfigInput,
): Promise<client.Configuration> {
  const key = `${config.issuer}\n${config.clientId}\n${config.clientSecret}`;
  if (cached?.key === key && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return cached.config;
  }
  if (!isAllowedIssuer(config.issuer)) {
    throw new AppError("The OIDC issuer must use https://", 400, {
      code: "OIDC_INSECURE_ISSUER",
    });
  }
  // isAllowedIssuer admits http: only for a loopback host.
  const insecure = new URL(config.issuer).protocol === "http:";
  const discovered = await client.discovery(
    new URL(config.issuer),
    config.clientId,
    undefined,
    client.ClientSecretBasic(config.clientSecret),
    {
      [client.customFetch]: viaSafeFetch,
      // Seconds for this request and every later one (token, JWKS,
      // userinfo), the body included. safeFetch's own limit stops at the
      // headers.
      timeout: 10,
      ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
    },
  );
  client.enableNonRepudiationChecks(discovered);
  cached = { key, at: Date.now(), config: discovered };
  return discovered;
}

/**
 * Save the provider an admin entered, or clear it with null. A save without a
 * client secret keeps the saved one, but only for the same issuer and client
 * ID. New credentials must answer discovery first; when they do not, nothing
 * is stored. A save that keeps them (the switch or the name alone) skips
 * discovery, so it works while the provider is down.
 */
export async function saveOidcProvider(
  input:
    (Omit<OidcConfigInput, "clientSecret"> & { clientSecret?: string }) | null,
): Promise<void> {
  forgetOidcDiscovery();
  if (!input) {
    setOidcConfig(null);
    return;
  }
  const saved = getOidcConfig();
  const clientSecret =
    input.clientSecret ||
    (saved?.issuer === input.issuer && saved.clientId === input.clientId
      ? saved.clientSecret
      : "");
  if (!clientSecret) throw new ValidationError("Client secret is required");
  const config = { ...input, clientSecret };
  const unchanged =
    saved?.issuer === config.issuer &&
    saved.clientId === config.clientId &&
    saved.clientSecret === config.clientSecret;
  if (unchanged) {
    setOidcConfig(config);
    return;
  }
  try {
    await discover(config);
  } catch (err) {
    throw new AppError(
      `The provider did not answer discovery: ${getErrorMessage(err)}`,
      400,
      { code: "OIDC_DISCOVERY_FAILED", cause: err },
    );
  }
  setOidcConfig(config);
}

/** The provider's sign-in address for a new flow. */
export async function startOidc(input: {
  redirectUri: string;
  linkUserId: string | null;
  remember?: boolean;
  returnTo?: string | null;
}): Promise<string> {
  const config = await discover(requireConfig());
  const codeVerifier = client.randomPKCECodeVerifier();
  const nonce = client.randomNonce();
  const state = client.randomState();
  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'oidc', ?, ?, ?)`,
    )
    .run(
      state,
      input.linkUserId,
      JSON.stringify({
        codeVerifier,
        nonce,
        remember: input.remember !== false,
        returnTo: safeReturnTo(input.returnTo),
      } satisfies FlowData),
      new Date(Date.now() + FLOW_TTL_MS).toISOString(),
    );
  return client
    .buildAuthorizationUrl(config, {
      redirect_uri: input.redirectUri,
      scope: SCOPE,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    })
    .toString();
}

/**
 * Consume the flow a callback's state names. Null for a state with no flow,
 * such as one already used.
 */
export function takeOidcFlow(state: string): OidcFlow | null {
  const row = sqlite
    .prepare(
      `DELETE FROM auth_challenges WHERE id = ? AND kind = 'oidc'
       RETURNING userId, challenge, expiresAt`,
    )
    .get(state) as
    { userId: string | null; challenge: string; expiresAt: string } | undefined;
  if (!row) return null;
  const data = JSON.parse(row.challenge) as FlowData;
  return {
    ...data,
    // A flow written before `remember` existed keeps the default.
    remember: data.remember !== false,
    userId: row.userId,
    expired: new Date(row.expiresAt).getTime() <= Date.now(),
  };
}

/**
 * Finish a consumed flow from the URL the provider sent the browser to:
 * exchange the code, validate the ID token, and return who signed in.
 */
export async function finishOidc(
  callbackUrl: URL,
  flow: OidcFlow,
): Promise<OidcClaims> {
  const config = await discover(requireConfig());
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: callbackUrl.searchParams.get("state") ?? "",
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) {
    throw new AppError("The provider sent no ID token", 502, {
      code: "OIDC_NO_ID_TOKEN",
    });
  }
  let email = typeof claims.email === "string" ? claims.email : null;
  let emailVerified = claims.email_verified === true;
  // Some providers put the address only in userinfo. One without a userinfo
  // endpoint simply has no address to give. The address is optional: a linked
  // identity signs in without it, so a userinfo failure costs only the email.
  if (
    !email &&
    tokens.access_token &&
    config.serverMetadata().userinfo_endpoint
  ) {
    try {
      const info = await client.fetchUserInfo(
        config,
        tokens.access_token,
        claims.sub,
      );
      email = typeof info.email === "string" ? info.email : null;
      emailVerified = info.email_verified === true;
    } catch (err) {
      // The message only: a refused request's body is the provider's.
      log.warn("Auth", "OIDC userinfo failed, so the sign-in has no email", {
        error: getErrorMessage(err),
      });
    }
  }
  return {
    issuer: config.serverMetadata().issuer,
    subject: claims.sub,
    email: email?.trim().toLowerCase() || null,
    emailVerified,
  };
}
