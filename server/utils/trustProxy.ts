// =============================================================================
// TRUST_PROXY_HOPS — how many reverse proxies sit in front of the server
// =============================================================================
// Express believes the X-Forwarded-For, -Proto and -Host headers only from as
// many hops as it is told to trust. The server used to trust one hop always.
// With no proxy in front, that one "hop" is the client itself, so a client
// could send its own X-Forwarded-For and pick the address that the login,
// reset-link and AI rate limits count, and that the audit log records.
//
// The default is now 0: believe no forwarded header. An operator with a
// reverse proxy sets the number of proxies, which is 1 for the common case of
// one Caddy, nginx or Traefik in front.
// =============================================================================

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
