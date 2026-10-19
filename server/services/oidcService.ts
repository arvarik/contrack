// OIDC sign-in against the one provider an admin configured
// (integrationSettings.ts). openid-client does discovery, PKCE and ID-token
// validation; every request it makes goes through safeFetch. A flow's state,
// PKCE verifier, nonce and link target wait in auth_challenges (kind 'oidc')
// for at most ten minutes, and the callback consumes them once.

import * as client from "openid-client";
import { sqlite } from "../db.ts";
import { AppError } from "../utils/AppError.ts";
import { safeFetch } from "../utils/urlSafety.ts";
import { getOidcConfig, type OidcConfig } from "./integrationSettings.ts";
import { isAllowedIssuer } from "../../shared/contracts/admin.ts";

const FLOW_TTL_MS = 10 * 60 * 1000;
const SCOPE = "openid email profile";

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** The account a link flow started from, or null for a sign-in. */
  linkUserId: string | null;
}

interface FlowSecrets {
  codeVerifier: string;
  nonce: string;
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

let cached: { key: string; config: client.Configuration } | null = null;

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

async function discover(config: OidcConfig): Promise<client.Configuration> {
  const key = `${config.issuer}\n${config.clientId}\n${config.clientSecret}`;
  if (cached?.key === key) return cached.config;
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
    config.clientSecret,
    undefined,
    {
      [client.customFetch]: viaSafeFetch,
      ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
    },
  );
  cached = { key, config: discovered };
  return discovered;
}

/** The provider's sign-in address for a new flow. */
export async function startOidc(input: {
  redirectUri: string;
  linkUserId: string | null;
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
      JSON.stringify({ codeVerifier, nonce } satisfies FlowSecrets),
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
 * Finish a flow from the URL the provider sent the browser to: consume its
 * state, exchange the code, validate the ID token, and return who signed in.
 */
export async function finishOidc(callbackUrl: string): Promise<OidcClaims> {
  const url = new URL(callbackUrl);
  const state = url.searchParams.get("state") ?? "";
  const row = sqlite
    .prepare(
      `DELETE FROM auth_challenges WHERE id = ? AND kind = 'oidc'
       RETURNING userId, challenge, expiresAt`,
    )
    .get(state) as
    { userId: string | null; challenge: string; expiresAt: string } | undefined;
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new AppError("This sign-in took too long. Try again", 410, {
      code: "OIDC_EXPIRED",
    });
  }
  const secrets = JSON.parse(row.challenge) as FlowSecrets;
  const config = await discover(requireConfig());
  const tokens = await client.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: secrets.codeVerifier,
    expectedState: state,
    expectedNonce: secrets.nonce,
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
  // endpoint simply has no address to give.
  if (
    !email &&
    tokens.access_token &&
    config.serverMetadata().userinfo_endpoint
  ) {
    const info = await client.fetchUserInfo(
      config,
      tokens.access_token,
      claims.sub,
    );
    email = typeof info.email === "string" ? info.email : null;
    emailVerified = info.email_verified === true;
  }
  return {
    issuer: config.serverMetadata().issuer,
    subject: claims.sub,
    email: email ? email.trim().toLowerCase() : null,
    emailVerified,
    linkUserId: row.userId,
  };
}
