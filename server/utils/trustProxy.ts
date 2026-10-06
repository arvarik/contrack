// TRUST_PROXY_HOPS: how many reverse proxies sit in front of the server.
// Express believes X-Forwarded-For, -Proto and -Host only from that many hops.
// The default is 0, because with no proxy in front a trusted "hop" is the
// client itself, which could then pick the address the login, reset-link and AI
// rate limits count and the audit log records. With one Caddy, nginx or Traefik
// in front, set 1.

/** The most hops anybody runs. A larger number is a typo, not a topology. */
const MAX_HOPS = 10;

/**
 * Read `TRUST_PROXY_HOPS`. Unset or empty means 0.
 *
 * @throws Error when the value is not a whole number from 0 to 10, so a typo
 *   stops the boot instead of quietly trusting nothing, or everything.
 */
export function trustProxyHops(
  raw: string | undefined = process.env.TRUST_PROXY_HOPS,
): number {
  const value = raw?.trim();
  if (!value) return 0;
  if (!/^\d+$/.test(value) || Number(value) > MAX_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a whole number from 0 to ${MAX_HOPS} (got "${raw}")`,
    );
  }
  return Number(value);
}
