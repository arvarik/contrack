// Third-party integration settings: SearXNG and the Google OAuth client.
// - Google OAuth credentials are sealed with secretBox (AES-256-GCM).
// - The client secret is write-only: status carries a redacted preview, never
//   the raw or sealed value.
// - SEARXNG_URL, GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET override
//   and lock the settings.
// - OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET do the same for the OIDC sign-in provider.

import {
  getSetting,
  setSetting,
  deleteSetting,
  SETTING_KEYS,
} from "./settingsService.ts";
import { seal, open } from "../utils/secretBox.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { trimTrailingSlashes } from "../utils/urlPath.ts";
import { isAllowedIssuer } from "../../shared/contracts/admin.ts";

export type IntegrationSource = "setting" | "env" | "none";

export interface SearxngIntegrationStatus {
  url: string | null;
  source: IntegrationSource;
}

export interface GoogleOAuthIntegrationStatus {
  configured: boolean;
  source: IntegrationSource;
  clientId: string | null;
  clientSecretPreview: string | null;
}

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
  source: "setting" | "env";
}

export interface OidcIntegrationStatus {
  configured: boolean;
  source: IntegrationSource;
  issuer: string | null;
  clientId: string | null;
  clientSecretPreview: string | null;
  name: string | null;
  matchByEmail: boolean;
  /** True when OIDC_* is set but OIDC_ISSUER is refused, so sign-in is off. */
  envIssuerInvalid: boolean;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The words on the sign-in button: "Sign in with <name>". */
  name: string;
  /** Sign a verified email in to the account that has it. */
  matchByEmail: boolean;
  source: "setting" | "env";
}

export type OidcConfigInput = Omit<OidcConfig, "source">;

const DEFAULT_OIDC_NAME = "OpenID Connect";

/** The General page's integrations. SearXNG is in the AI settings view. */
export interface IntegrationsStatus {
  googleOAuth: GoogleOAuthIntegrationStatus;
  oidc: OidcIntegrationStatus;
}

export function isSearxngEnvSet(): boolean {
  const raw = process.env.SEARXNG_URL?.trim();
  return raw !== undefined && raw !== "";
}

export function isGoogleOAuthEnvSet(): boolean {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return Boolean(id && secret);
}

function redact(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

/**
 * Where SearXNG is: SEARXNG_URL, which wins and locks the setting, or the
 * address an admin saved in Settings → Administration → AI → Web search. The
 * page cannot save while the variable is set (SET_BY_ENVIRONMENT), so the
 * variable must also win over an address saved before it.
 */
export function getSearxngStatus(): SearxngIntegrationStatus {
  if (isSearxngEnvSet()) {
    return {
      url: trimTrailingSlashes(process.env.SEARXNG_URL!.trim()),
      source: "env",
    };
  }
  const settingUrl = getSetting<{ url: string }>(
    SETTING_KEYS.aiSearxng,
  )?.url?.trim();
  if (settingUrl) {
    return { url: trimTrailingSlashes(settingUrl), source: "setting" };
  }
  return { url: null, source: "none" };
}

/** The SearXNG base URL research searches with, or null when none is set. */
export function getSearxngUrl(): string | null {
  return getSearxngStatus().url;
}

/**
 * Returns metadata status for integrations without exposing secrets.
 */
export function getIntegrationsStatus(): IntegrationsStatus {
  const googleCreds = getGoogleOAuthCredentials();
  const googleOAuthStatus: GoogleOAuthIntegrationStatus = googleCreds
    ? {
        configured: true,
        source: googleCreds.source,
        clientId: googleCreds.clientId,
        clientSecretPreview: redact(googleCreds.clientSecret),
      }
    : {
        configured: false,
        source: "none",
        clientId: null,
        clientSecretPreview: null,
      };

  const oidc = getOidcConfig();
  const oidcStatus: OidcIntegrationStatus = oidc
    ? {
        configured: true,
        source: oidc.source,
        issuer: oidc.issuer,
        clientId: oidc.clientId,
        clientSecretPreview: redact(oidc.clientSecret),
        name: oidc.name,
        matchByEmail: oidc.matchByEmail,
        envIssuerInvalid: false,
      }
    : {
        configured: false,
        // getOidcConfig is null under OIDC_* only for a refused issuer. The
        // environment still owns the setting, so saving stays locked.
        source: isOidcEnvSet() ? "env" : "none",
        issuer: null,
        clientId: null,
        clientSecretPreview: null,
        name: null,
        matchByEmail: false,
        envIssuerInvalid: isOidcEnvSet(),
      };

  return { googleOAuth: googleOAuthStatus, oidc: oidcStatus };
}

/**
 * The unsealed Google OAuth credentials: GOOGLE_OAUTH_CLIENT_ID and
 * GOOGLE_OAUTH_CLIENT_SECRET when set, else the sealed setting.
 */
export function getGoogleOAuthCredentials(): GoogleOAuthCredentials | null {
  const envId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const envSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (envId && envSecret) {
    return {
      clientId: envId,
      clientSecret: envSecret,
      source: "env",
    };
  }

  const sealed = getSetting<string>(SETTING_KEYS.googleOAuth);
  if (typeof sealed === "string" && sealed.startsWith("v1:")) {
    try {
      const raw = open(sealed);
      const parsed = JSON.parse(raw);
      if (parsed?.clientId && parsed?.clientSecret) {
        return {
          clientId: parsed.clientId,
          clientSecret: parsed.clientSecret,
          source: "setting",
        };
      }
    } catch (err) {
      log.warn(
        "Integrations",
        `Failed to unseal Google OAuth credentials: ${getErrorMessage(err)}`,
      );
    }
  }

  return null;
}

/**
 * Sets or clears the Google OAuth credentials. Stored sealed using secretBox.
 */
export function setGoogleOAuthCredentials(
  creds: { clientId: string; clientSecret: string } | null,
): void {
  if (!creds || !creds.clientId?.trim() || !creds.clientSecret?.trim()) {
    deleteSetting(SETTING_KEYS.googleOAuth);
    return;
  }
  const payload = JSON.stringify({
    clientId: creds.clientId.trim(),
    clientSecret: creds.clientSecret.trim(),
  });
  setSetting(SETTING_KEYS.googleOAuth, seal(payload));
}

/**
 * Sets or clears the SearXNG URL.
 */
export function setSearxngUrl(rawUrl: string): void {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    deleteSetting(SETTING_KEYS.aiSearxng);
    return;
  }
  setSetting(SETTING_KEYS.aiSearxng, { url: trimTrailingSlashes(trimmed) });
}

export function isOidcEnvSet(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER?.trim() &&
    process.env.OIDC_CLIENT_ID?.trim() &&
    process.env.OIDC_CLIENT_SECRET?.trim(),
  );
}

/** The OIDC_ISSUER value already warned about, so the log says it once. */
let warnedIssuer: string | null = null;

/**
 * The OIDC provider: OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET when
 * all are set (OIDC_NAME and OIDC_MATCH_BY_EMAIL are optional), else the
 * sealed setting. An OIDC_ISSUER that is not https (or http on loopback)
 * leaves sign-in off, with one warning in the log. Email matching is on only
 * when OIDC_MATCH_BY_EMAIL is "true".
 */
export function getOidcConfig(): OidcConfig | null {
  if (isOidcEnvSet()) {
    const issuer = process.env.OIDC_ISSUER!.trim();
    if (!isAllowedIssuer(issuer)) {
      if (warnedIssuer !== issuer) {
        warnedIssuer = issuer;
        log.warn(
          "Integrations",
          `OIDC_ISSUER must use https:// (http only for localhost). Single sign-on stays off: ${issuer}`,
        );
      }
      return null;
    }
    return {
      issuer,
      clientId: process.env.OIDC_CLIENT_ID!.trim(),
      clientSecret: process.env.OIDC_CLIENT_SECRET!.trim(),
      name: process.env.OIDC_NAME?.trim() || DEFAULT_OIDC_NAME,
      matchByEmail: process.env.OIDC_MATCH_BY_EMAIL?.trim() === "true",
      source: "env",
    };
  }
  const sealed = getSetting<string>(SETTING_KEYS.oidc);
  if (typeof sealed === "string" && sealed.startsWith("v1:")) {
    try {
      const parsed = JSON.parse(open(sealed)) as Partial<OidcConfigInput>;
      if (parsed.issuer && parsed.clientId && parsed.clientSecret) {
        return {
          issuer: parsed.issuer,
          clientId: parsed.clientId,
          clientSecret: parsed.clientSecret,
          name: parsed.name || DEFAULT_OIDC_NAME,
          matchByEmail: parsed.matchByEmail === true,
          source: "setting",
        };
      }
    } catch (err) {
      log.warn(
        "Integrations",
        `Failed to unseal the OIDC provider: ${getErrorMessage(err)}`,
      );
    }
  }
  return null;
}

/** Sets or clears the OIDC provider. Stored sealed using secretBox. */
export function setOidcConfig(config: OidcConfigInput | null): void {
  if (!config) {
    deleteSetting(SETTING_KEYS.oidc);
    return;
  }
  setSetting(
    SETTING_KEYS.oidc,
    seal(
      JSON.stringify({
        issuer: config.issuer.trim(),
        clientId: config.clientId.trim(),
        clientSecret: config.clientSecret.trim(),
        name: config.name.trim() || DEFAULT_OIDC_NAME,
        matchByEmail: config.matchByEmail,
      }),
    ),
  );
}
