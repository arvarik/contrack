import { withTimeout } from "../ai/resilience.ts";
// SSRF guards. Any URL from user input, AI output or a web search result goes
// through here before fetch(): http(s) only, no private, loopback or metadata
// addresses (checked again on every redirect hop), and a hard response cap.

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
 * True when the address is loopback, link-local, or RFC 1918 / ULA private, so
 * the unfurl endpoint cannot be an SSRF proxy into localhost services or cloud
 * metadata (169.254.169.254).
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

  // An IPv6 address that embeds an IPv4 address is as private as the IPv4 it
  // embeds (::ffff:169.254.169.254 is cloud metadata), so the IPv4 is
  // extracted and checked with the full IPv4 policy:
  //   ::ffff:a.b.c.d      IPv4-mapped (RFC 4291), dotted form
  //   ::ffff:aabb:ccdd    IPv4-mapped, hex form
  //   64:ff9b::a.b.c.d    NAT64 well-known prefix (RFC 6052)
  const embedded = extractEmbeddedIPv4(lower);
  if (embedded) return isPrivateAddress(embedded);

  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") || // link-local
    lower.startsWith("fc") || // unique-local fc00::/7
    lower.startsWith("fd")
  );
}

/** The IPv4 inside an IPv4-mapped or NAT64 IPv6 address, or null. */
function extractEmbeddedIPv4(lowerIPv6: string): string | null {
  const mapped = lowerIPv6.match(/^::ffff:(.+)$/);
  const nat64 = lowerIPv6.match(/^64:ff9b::(.+)$/);
  const tail = mapped?.[1] ?? nat64?.[1];
  if (!tail) return null;
  if (net.isIPv4(tail)) return tail;
  // Hex form: two 16-bit groups carrying the four octets.
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * The message assertPublicHttpUrl gives when the name does not resolve.
 * Exported so a caller can tell "the network is down" from "this URL is not
 * allowed": both are ValidationErrors, but only the first is worth retrying
 * (server/utils/remoteImage.ts marks it transient).
 */
export const UNRESOLVABLE_HOST_MESSAGE = "Could not resolve URL host";

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
    throw new ValidationError(UNRESOLVABLE_HOST_MESSAGE);
  }
  return url;
}

/** Read at most MAX_RESPONSE_BYTES of the body as text. */
export async function readBodyCapped(
  res: globalThis.Response,
  signal?: AbortSignal,
): Promise<string> {
  return withTimeout(
    async (budget) => {
      const reader = res.body?.getReader();
      if (!reader) return "";
      const onAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      budget.addEventListener("abort", onAbort, { once: true });
      const decoder = new TextDecoder();
      let text = "";
      let received = 0;
      try {
        for (;;) {
          budget.throwIfAborted();
          const { done, value } = await reader.read();
          budget.throwIfAborted();
          if (done) break;
          const bounded = value.subarray(0, MAX_RESPONSE_BYTES - received);
          received += bounded.byteLength;
          text += decoder.decode(bounded, { stream: true });
          if (received >= MAX_RESPONSE_BYTES) break;
        }
        return text + decoder.decode();
      } finally {
        budget.removeEventListener("abort", onAbort);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
    8_000,
    signal,
  );
}

/**
 * Read a binary body, and refuse it once it passes `maxBytes`. readBodyCapped
 * truncates, which suits HTML, but a truncated image is corrupt, so this throws
 * instead. It stops at the first chunk over the cap, so a hostile server cannot
 * make it buffer more than `maxBytes` plus one chunk. Like readBodyCapped it
 * has its own time budget, so a server that trickles the body cannot hold the
 * request open.
 */
export async function readBytesCapped(
  res: globalThis.Response,
  maxBytes: number,
  signal?: AbortSignal,
  timeoutMs = 8_000,
): Promise<Buffer> {
  return withTimeout(
    async (budget) => {
      const reader = res.body?.getReader();
      if (!reader) return Buffer.alloc(0);
      const onAbort = () => {
        void reader.cancel().catch(() => undefined);
      };
      budget.addEventListener("abort", onAbort, { once: true });
      const chunks: Uint8Array[] = [];
      let received = 0;
      try {
        for (;;) {
          budget.throwIfAborted();
          const { done, value } = await reader.read();
          budget.throwIfAborted();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            throw new AppError(
              `Response body is larger than ${maxBytes} bytes`,
              502,
              { code: "RESPONSE_TOO_LARGE" },
            );
          }
          chunks.push(value);
        }
        return Buffer.concat(chunks, received);
      } finally {
        budget.removeEventListener("abort", onAbort);
        void reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
    timeoutMs,
    signal,
  );
}

/**
 * DNS lookup that refuses private addresses at connect time.
 * `assertPublicHttpUrl` resolves and checks the name, and then fetch() resolves
 * it again to open the socket: two queries, a rebinding hole where an
 * attacker's DNS answers the check with a public address and the connect with
 * 127.0.0.1. Checking inside the resolver the socket uses makes the checked
 * address the dialed one, on the first request and every redirect hop.
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
      // net asks with all:true (Happy Eyeballs) and dials its own pick, so
      // every address is checked. A name that mixes public and private
      // addresses fails closed: that mix is the rebinding shape.
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
 * One shared dispatcher for every outbound unfurl and research fetch: its
 * lookup enforces the private-address policy, and it pools connections.
 */
const pinnedAgent = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Fetch a public http(s) URL with SSRF protection on every redirect hop.
 * Returns the response and the final URL, or throws AppError/ValidationError.
 */
export async function safeFetch(
  targetUrl: string,
  options: {
    timeoutMs?: number;
    maxRedirects?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{ response: globalThis.Response; finalUrl: string }> {
  const { timeoutMs = 6000, maxRedirects = 3 } = options;
  options.signal?.throwIfAborted();
  await assertPublicHttpUrl(targetUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = targetUrl;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      // undici's own fetch, not the global, whose types accept no dispatcher,
      // and the dispatcher holds the rebinding guard. The Response has the same
      // WHATWG shape, so only the nominal type needs the cast.
      const response = (await undiciFetch(currentUrl, {
        signal: options.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal,
        redirect: "manual",
        dispatcher: pinnedAgent,
      })) as unknown as globalThis.Response;
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: currentUrl };
        void response.body?.cancel().catch(() => undefined);
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
