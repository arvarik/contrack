// =============================================================================
// Integration Settings Service — SearXNG and Google OAuth configuration
// =============================================================================
// Resolves third-party integration settings (SearXNG search, Google OAuth client):
//   - Google OAuth credentials are stored encrypted using secretBox (AES-256-GCM)
//   - The client secret is write-only: status carries a redacted preview, never
//     the raw or sealed value
//   - Environment variables (SEARXNG_URL, GOOGLE_OAUTH_CLIENT_ID and
//     GOOGLE_OAUTH_CLIENT_SECRET) override and lock settings
// =============================================================================

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

export interface IntegrationsStatus {
  searxng: SearxngIntegrationStatus;
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
 * Returns the configured SearXNG URL.
 * Reads database setting before falling back to SEARXNG_URL env.
 */
export function getSearxngUrl(): string | null {
  const setting = getSetting<{ url: string }>(SETTING_KEYS.aiSearxng);
  const settingUrl = setting?.url?.trim();
  if (settingUrl) {
    return settingUrl.replace(/\/+$/, "");
  }

  const envUrl = process.env.SEARXNG_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  return null;
}

/**
 * Returns metadata status for integrations without exposing secrets.
 */
export function getIntegrationsStatus(): IntegrationsStatus {
  const setting = getSetting<{ url: string }>(SETTING_KEYS.aiSearxng);
  const settingUrl = setting?.url?.trim();
  let searxngStatus: SearxngIntegrationStatus;

  if (settingUrl) {
    searxngStatus = {
      url: settingUrl.replace(/\/+$/, ""),
      source: "setting",
    };
  } else if (isSearxngEnvSet()) {
    searxngStatus = {
      url: process.env.SEARXNG_URL!.trim().replace(/\/+$/, ""),
      source: "env",
    };
  } else {
    searxngStatus = { url: null, source: "none" };
  }

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

  return {
    searxng: searxngStatus,
    googleOAuth: googleOAuthStatus,
  };
}

/**
 * Returns the unsealed Google OAuth credentials.
 * Checks environment overrides (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)
 * before falling back to sealed database setting.
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
