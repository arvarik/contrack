import type { Request } from "express";
import net from "node:net";
import { AppError } from "./AppError.ts";

const HOST_SHAPE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.\-_]+)(?::\d{1,5})?$/;

/**
 * Validate `PUBLIC_URL` at boot: an http or https URL with no path. Returns the
 * origin, or null when it is not set.
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
 * The public origin for this request: `PUBLIC_URL`'s origin when it is set,
 * else `req.host` and `req.protocol`, which read X-Forwarded-Host and
 * X-Forwarded-Proto only from a hop TRUST_PROXY_HOPS trusts, so a client cannot
 * name the host of a link the server builds. Fine for an answer to the same
 * caller (a passkey ceremony, an invitation link shown to its admin). A mailed
 * link uses `mailLinkOrigin`.
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
 * True when an `Origin` header names this server: the host the request was sent
 * to, or `PUBLIC_URL`. The host is compared without the scheme, so behind a
 * proxy that does not report HTTPS the page's `https://` origin still matches.
 */
export function isOwnOrigin(req: Request, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  // PUBLIC_URL itself, not `publicOrigin`, whose fallback for a Host of an
  // odd shape is `localhost`, which a page there could then claim.
  return (
    host === (req.host ?? "").toLowerCase() ||
    origin === validatePublicUrl(process.env.PUBLIC_URL)
  );
}

/**
 * The origin of a link the server mails, or null when `PUBLIC_URL` is not set.
 * A mailed link reaches somebody other than the caller, so it is never built
 * from the request: a password-reset request with a forged Host header would
 * otherwise mail the account holder a real reset token inside a link to the
 * attacker's server. With no `PUBLIC_URL`, no link is sent.
 */
export function mailLinkOrigin(): string | null {
  return validatePublicUrl(process.env.PUBLIC_URL);
}

/**
 * The WebAuthn relying-party ID (rpID) of the public origin. An IP address is
 * not a valid rpID under the WebAuthn spec, and throws `AppError(400,
 * "PASSKEY_UNSUPPORTED_ORIGIN")`.
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
