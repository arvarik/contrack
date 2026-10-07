// Third-party integration settings: SearXNG and the Google OAuth client.
// - Google OAuth credentials are sealed with secretBox (AES-256-GCM).
// - The client secret is write-only: status carries a redacted preview, never
//   the raw or sealed value.
// - SEARXNG_URL, GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET override
//   and lock the settings.

import {
  getSetting,
  setSetting,
  deleteSetting,
  SETTING_KEYS,
} from "./settingsService.ts";
import { seal, open } from "../utils/secretBox.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";

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

/** The General page's integrations. SearXNG is in the AI settings view. */
export interface IntegrationsStatus {
  googleOAuth: GoogleOAuthIntegrationStatus;
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
      url: process.env.SEARXNG_URL!.trim().replace(/\/+$/, ""),
      source: "env",
    };
  }
  const settingUrl = getSetting<{ url: string }>(
    SETTING_KEYS.aiSearxng,
  )?.url?.trim();
  if (settingUrl) {
    return { url: settingUrl.replace(/\/+$/, ""), source: "setting" };
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

  return { googleOAuth: googleOAuthStatus };
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
  setSetting(SETTING_KEYS.aiSearxng, { url: trimmed.replace(/\/+$/, "") });
}
