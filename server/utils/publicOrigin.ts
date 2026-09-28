import type { Request } from "express";
import net from "node:net";
import { AppError } from "./AppError.ts";

const HOST_SHAPE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.\-_]+)(?::\d{1,5})?$/;

/**
 * Validate `PUBLIC_URL` at boot.
 * Must be a valid URL with http or https protocol and no path component.
 * Returns the validated origin or null if not configured.
 */
export function validatePublicUrl(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `PUBLIC_URL must be a valid http or https origin with no path (got "${raw}")`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `PUBLIC_URL must have an http or https protocol (got "${parsed.protocol}")`,
    );
  }

  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error(
      `PUBLIC_URL must not include a path (got "${parsed.pathname}")`,
    );
  }

  if (parsed.search || parsed.hash) {
    throw new Error(
      "PUBLIC_URL must not include query parameters or a hash fragment",
    );
  }

  return parsed.origin;
}

/**
 * Return the public origin for the current request.
 *
 * If `PUBLIC_URL` is set, its origin is returned. Otherwise the origin is
 * derived from `req.host` and `req.protocol`, which read X-Forwarded-Host and
 * X-Forwarded-Proto only from a hop that TRUST_PROXY_HOPS trusts. This used to
 * read X-Forwarded-Host itself, from anybody, so a client could name the host
 * of a link the server built.
 *
 * Fine for an answer that goes back to the same caller (a passkey ceremony, an
 * invitation link shown to the admin who asked for it). A link that goes out
 * by mail uses `mailLinkOrigin` instead.
 */
export function publicOrigin(req: Request): string {
  if (process.env.PUBLIC_URL) {
    const validated = validatePublicUrl(process.env.PUBLIC_URL);
    if (validated) return validated;
  }

  const host = req.host;
  return `${req.protocol}://${host && HOST_SHAPE.test(host) ? host : "localhost"}`;
}

/**
 * The origin of a link the server sends by mail, or null when `PUBLIC_URL` is
 * not set.
 *
 * A mailed link reaches somebody other than the caller, so it must never be
 * built from the request. A password-reset request with a forged Host header
 * would otherwise mail the real account holder a genuine reset token inside a
 * link to the attacker's server, and one click would hand the token over.
 * With no `PUBLIC_URL`, the server sends no link at all.
 */
export function mailLinkOrigin(): string | null {
  return validatePublicUrl(process.env.PUBLIC_URL);
}

/**
 * Extract the WebAuthn relying-party ID (rpID) from the public origin.
 *
 * An IP address (IPv4 or IPv6) is not a valid rpID under the WebAuthn spec
 * and throws `AppError(400, "PASSKEY_UNSUPPORTED_ORIGIN")`.
 */
export function getRpIdFromOrigin(origin: string): string {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    throw new AppError(
      "Passkeys require a valid domain name or localhost.",
      400,
      { code: "PASSKEY_UNSUPPORTED_ORIGIN" },
    );
  }

  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bareHost)) {
    throw new AppError(
      "Passkeys require a domain name or localhost (IP addresses are not supported).",
      400,
      { code: "PASSKEY_UNSUPPORTED_ORIGIN" },
    );
  }

  return hostname;
}

/**
 * Get both rpID and origin for passkey ceremonies from the request.
 */
export function getPasskeyRp(req: Request): { rpID: string; origin: string } {
  const origin = publicOrigin(req);
  const rpID = getRpIdFromOrigin(origin);
  return { rpID, origin };
}
