// =============================================================================
// URL safety — SSRF guards for user/AI-supplied URLs
// =============================================================================
// Any URL that reaches fetch() from user input, AI output, or a web search
// result goes through here first: http(s) only, no private/loopback/metadata
// addresses (checked again on every redirect hop), and a hard response cap.
// =============================================================================

import net from "net";
import dns from "dns/promises";
import {
  lookup as dnsCallbackLookup,
  type LookupOptions,
  type LookupAddress,
} from "dns";
import { Agent, fetch as undiciFetch } from "undici";
import { AppError, ValidationError } from "./AppError.ts";

/** Cap responses so a hostile page can't exhaust memory. */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB of HTML is plenty for <head>

/**
 * True when the address is loopback, link-local, or RFC1918/ULA private.
 * Blocking these prevents the unfurl endpoint from being used as an SSRF
 * proxy into localhost services or cloud metadata (169.254.169.254).
 */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = address.toLowerCase();
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique-local fc00::/7
    lower.startsWith("fd") ||
    lower.startsWith("::ffff:127.") || // IPv4-mapped loopback
    lower.startsWith("::ffff:10.") ||
    lower.startsWith("::ffff:192.168.")
  );
}

/**
 * Validate an unfurl target: http(s) only, and the hostname must not resolve
 * to a private/loopback address. Throws ValidationError on anything else.
 */
export async function assertPublicHttpUrl(targetUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new ValidationError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http(s) URLs can be unfurled");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new ValidationError("URL resolves to a private address");
    }
    return url;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ValidationError("URL resolves to a private address");
  }
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateAddress(address)) {
      throw new ValidationError("URL resolves to a private address");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new ValidationError("Could not resolve URL host");
  }
  return url;
}

/** Read at most MAX_RESPONSE_BYTES of the body as text. */
export async function readBodyCapped(
  res: globalThis.Response,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return text;
}

/**
 * DNS lookup that refuses private addresses AT CONNECT TIME.
 *
 * `assertPublicHttpUrl` resolves the hostname, checks the address, and then
 * fetch() resolves the name AGAIN to open the socket. Those are two separate
 * queries, which is a rebinding hole: an attacker's DNS server answers the
 * check with a public address and the connect with 127.0.0.1, and the guard
 * passes a request it exists to block. Enforcing inside the resolver the
 * socket actually uses closes the gap — the address that passed the check IS
 * the address dialed, on the first request and on every redirect hop.
 *
 * Exported for tests only.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsCallbackLookup(
    hostname,
    options,
    (
      err: NodeJS.ErrnoException | null,
      result: string | LookupAddress[],
      family?: number,
    ) => {
      if (err) return callback(err, result, family);
      // net asks with all:true (Happy Eyeballs) and dials ITS pick from the
      // set, so every member is validated — one clean address in the answer
      // proves nothing about the one the socket chooses. A name that mixes
      // public and private addresses fails closed: that mix is the rebinding
      // shape, not a legitimate host.
      const addresses = Array.isArray(result)
        ? result.map((entry) => entry.address)
        : [String(result)];
      if (addresses.some((address) => isPrivateAddress(address))) {
        const blocked: NodeJS.ErrnoException = new Error(
          "URL resolves to a private address",
        );
        blocked.code = "ERR_PRIVATE_ADDRESS";
        return callback(blocked, result, family);
      }
      callback(null, result, family);
    },
  );
}

/**
 * One shared dispatcher for every outbound unfurl/research fetch. The custom
 * lookup enforces the private-address policy; sharing the agent also pools
 * connections across calls instead of dialing fresh each time.
 */
const pinnedAgent = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Fetch a public http(s) URL with SSRF protection on every redirect hop.
 * Returns the response and the final URL, or throws AppError/ValidationError.
 */
export async function safeFetch(
  targetUrl: string,
  options: { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<{ response: globalThis.Response; finalUrl: string }> {
  const { timeoutMs = 6000, maxRedirects = 3 } = options;
  await assertPublicHttpUrl(targetUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = targetUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // undici's own fetch, not the global: the global accepts no dispatcher
      // in its published types, and the dispatcher is where the rebinding
      // guard lives. The returned Response implements the same WHATWG shape
      // the callers consume, so only the nominal type needs the cast.
      const response = (await undiciFetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        dispatcher: pinnedAgent,
      })) as unknown as globalThis.Response;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: currentUrl };
        currentUrl = new URL(location, currentUrl).toString();
        await assertPublicHttpUrl(currentUrl);
        continue;
      }
      return { response, finalUrl: currentUrl };
    }
    throw new AppError("Too many redirects", 502);
  } finally {
    clearTimeout(timer);
  }
}
