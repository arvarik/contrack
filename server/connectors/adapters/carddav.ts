/**
 * The CardDAV connector, for any RFC 6352 CardDAV server (Nextcloud, Radicale,
 * Baïkal, Apple iCloud, Fastmail, Google Contacts, Synology). Discovers the
 * user's address book via `.well-known/carddav`, `current-user-principal` and
 * `addressbook-home-set`, pulls changes via `sync-collection` / ETag diffing
 * and `addressbook-multiget`, and optionally pushes local contact creates and
 * edits back via conditional `PUT`.
 *
 * @module server/connectors/adapters/carddav
 */

import crypto from "node:crypto";
// The slim entry parses with htmlparser2 alone, which xmlMode below uses.
// The full entry loads parse5, which the Docker image removes.
import * as cheerio from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";
import { z } from "zod";
import {
  extractVCardContacts,
  patchVCard,
  serializeVCard,
  type VCardInput,
} from "../../../shared/vcard.ts";
import { safeFetch } from "../../utils/urlSafety.ts";
import { ConnectorAuthError, ConnectorConfigError } from "../errors.ts";
import type {
  ConnectorAdapter,
  PushContext,
  PushResult,
  SyncContext,
  SyncEvent,
} from "../types.ts";

export const carddavConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .url("Must be a valid URL")
    .describe("CardDAV server or address book URL"),
  username: z.string().trim().min(1, "Username is required"),
  syncDirection: z.enum(["two_way", "pull_only"]).default("two_way").optional(),
  addressBookUrl: z.string().trim().url().optional(),
  pushExistingContacts: z.boolean().optional(),
});

export const carddavSecretSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type CarddavConfig = z.infer<typeof carddavConfigSchema>;
export type CarddavSecret = z.infer<typeof carddavSecretSchema>;

export interface CarddavCursor {
  addressBookUrl?: string;
  configuredUrl?: string;
  syncToken?: string | null;
  etags?: Record<string, string>;
  pushedHashes?: Record<string, string>;
  pushedUpdatedAt?: Record<string, string>;
  deletedHrefs?: string[];
  lastSyncAt?: string;
}

export const MAX_DAV_BYTES = 5 * 1024 * 1024; // 5 MB response body cap per request
const DAV_TIMEOUT_MS = 15_000;
const DAV_DEADLINE_MS = 60_000;
export const MULTIGET_BATCH_SIZE = 10;
const MAX_SYNC_PAGES = 50;

class DavResponseTooLargeError extends ConnectorConfigError {
  constructor(maxBytes: number) {
    super(`CardDAV response exceeded 5 MB cap (received > ${maxBytes} bytes)`);
    this.name = "DavResponseTooLargeError";
  }
}

/**
 * Parse an ISO 8601 timestamp (`2026-10-16T12:00:00.000Z`) or a SQLite
 * `datetime('now')` timestamp (`2026-10-16 12:00:00`) into epoch milliseconds.
 */
export function parseTimestampMs(ts: string | null | undefined): number {
  if (!ts) return NaN;
  const trimmed = ts.trim();
  if (!trimmed) return NaN;
  const iso = trimmed.includes("T")
    ? trimmed
    : `${trimmed.replace(" ", "T")}${trimmed.endsWith("Z") ? "" : "Z"}`;
  return Date.parse(iso);
}

/**
 * Deterministic 16-char SHA-256 hex digest of the vCard properties Contrack
 * manages, excluding `uid` and `updatedAt` so non-card column updates (such as
 * `lastContactedAt` or `aiBriefing`) never trigger a spurious CardDAV push.
 */
export function vcardContentHash(input: VCardInput): string {
  const normalized: VCardInput = {
    name: input.name,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    company: input.company ?? null,
    role: input.role ?? null,
    birthday: input.birthday ?? null,
    about: input.about ?? null,
    website: input.website ?? null,
    emails: [...(input.emails ?? [])]
      .map((e) => ({
        email: e.email.trim().toLowerCase(),
        label: (e.label ?? "personal").toLowerCase(),
        isPrimary: Boolean(e.isPrimary),
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
    phones: [...(input.phones ?? [])]
      .map((p) => ({
        phone: p.phone.trim(),
        label: (p.label ?? "mobile").toLowerCase(),
        isPrimary: Boolean(p.isPrimary),
      }))
      .sort((a, b) => a.phone.localeCompare(b.phone)),
    addresses: [...(input.addresses ?? [])]
      .map((a) => ({
        address: a.address.trim(),
        label: (a.label ?? "home").toLowerCase(),
        isPrimary: Boolean(a.isPrimary),
      }))
      .sort((a, b) => a.address.localeCompare(b.address)),
    socialLinks: [...(input.socialLinks ?? [])]
      .map((s) => ({
        platform: (s.platform || "other").toLowerCase(),
        url: s.url.trim(),
      }))
      .sort((a, b) =>
        `${a.platform}:${a.url}`.localeCompare(`${b.platform}:${b.url}`),
      ),
    tags: [...(input.tags ?? [])]
      .map((t) => t.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  };
  const canonical = serializeVCard(normalized);
  return crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

function basicAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`, "utf8").toString(
    "base64",
  );
  return `Basic ${credentials}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanEtag(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim();
}

export function isWeakEtag(etag: string | null | undefined): boolean {
  if (!etag) return false;
  return /^w\//i.test(etag.trim());
}

export function formatEtagHeader(etag: string): string {
  const trimmed = etag.trim();
  if (!trimmed || isWeakEtag(trimmed)) return "";
  if (trimmed.startsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

async function readCappedBody(
  res: globalThis.Response,
  signal?: AbortSignal,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let text = "";
  let received = 0;

  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        if (received + value.byteLength > MAX_DAV_BYTES) {
          throw new DavResponseTooLargeError(MAX_DAV_BYTES);
        }
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
    return text;
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

interface DavResponse {
  status: number;
  statusText: string;
  headers: Headers;
  body: string;
  finalUrl: string;
}

async function davRequest(
  urlStr: string,
  options: {
    method: string;
    auth: string;
    depth?: "0" | "1";
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<DavResponse> {
  const deadline = AbortSignal.timeout(DAV_DEADLINE_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  const allowPrivate = process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true";

  let parsedTarget: URL;
  try {
    parsedTarget = new URL(urlStr);
  } catch {
    throw new ConnectorConfigError("Invalid CardDAV URL");
  }
  if (parsedTarget.protocol !== "https:" && !allowPrivate) {
    throw new ConnectorConfigError(
      "CardDAV requires an https:// URL so your password is not sent in cleartext",
    );
  }

  const headers: Record<string, string> = {
    Authorization: options.auth,
    "User-Agent": "Contrack-CardDAV/2.0",
    ...options.headers,
  };
  if (options.depth !== undefined) {
    headers.Depth = options.depth;
  }
  if (options.contentType) {
    headers["Content-Type"] = options.contentType;
  }

  let res: globalThis.Response;
  let finalUrl = urlStr;
  try {
    const result = await safeFetch(urlStr, {
      method: options.method,
      headers,
      body: options.body,
      signal,
      timeoutMs: DAV_TIMEOUT_MS,
      allowPrivate,
    });
    res = result.response;
    finalUrl = result.finalUrl;
  } catch (err: unknown) {
    options.signal?.throwIfAborted();
    throw new ConnectorConfigError(
      `Failed to connect to CardDAV server: ${(err as Error).message}`,
    );
  }

  if (
    parsedTarget.protocol === "https:" &&
    new URL(finalUrl).protocol !== "https:"
  ) {
    void res.body?.cancel().catch(() => undefined);
    throw new ConnectorConfigError(
      "CardDAV server redirected from https:// to plain http://",
    );
  }

  const body = await readCappedBody(res, signal);
  return {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    body,
    finalUrl,
  };
}

/**
 * Allow a cross-origin discovery hop only when the target is the exact same
 * host or a direct subdomain of the user-configured host (e.g.
 * `https://example.com` -> `https://dav.example.com`) and never a scheme
 * downgrade or a sibling host (`me.github.io` -> `evil.github.io`,
 * `a.co.uk` -> `b.co.uk`).
 */
export function canFollowDiscoveryRedirect(
  configuredUrlStr: string,
  redirectedUrlStr: string,
): boolean {
  try {
    const base = new URL(configuredUrlStr);
    const next = new URL(redirectedUrlStr);
    if (base.protocol === "https:" && next.protocol !== "https:") return false;
    const baseHost = base.hostname.toLowerCase();
    const nextHost = next.hostname.toLowerCase();
    return nextHost === baseHost || nextHost.endsWith(`.${baseHost}`);
  } catch {
    return false;
  }
}

function localName(tagName: string | undefined): string {
  if (!tagName) return "";
  const colon = tagName.indexOf(":");
  return (colon >= 0 ? tagName.slice(colon + 1) : tagName).toLowerCase();
}

function findElements(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
  targetLocalName: string,
): Element[] {
  const target = targetLocalName.toLowerCase();
  const matches: Element[] = [];
  root.find("*").each((_, el) => {
    if ("tagName" in el && localName(el.tagName) === target) {
      matches.push(el);
    }
  });
  return matches;
}

function directChildText(
  $: cheerio.CheerioAPI,
  parent: cheerio.Cheerio<AnyNode>,
  targetLocalName: string,
): string | null {
  const target = targetLocalName.toLowerCase();
  let found: string | null = null;
  parent.children().each((_, el) => {
    if (found === null && "tagName" in el && localName(el.tagName) === target) {
      found = $(el).text().trim();
    }
  });
  return found;
}

export interface ParsedMultiStatusItem {
  href: string;
  status: string | null;
  isAddressBook: boolean;
  isCollection: boolean;
  readOnly: boolean;
  displayName: string | null;
  principalHref: string | null;
  homeSetHref: string | null;
  etag: string | null;
  addressData: string | null;
  syncToken: string | null;
}

export interface ParsedMultiStatus {
  isMultiStatus: boolean;
  syncToken: string | null;
  items: ParsedMultiStatusItem[];
}

/**
 * Parse a WebDAV 207 Multi-Status XML payload using Cheerio in XML mode,
 * stripping namespace prefixes so any server's prefix choices work.
 */
export function parseMultiStatusXml(xml: string): ParsedMultiStatus {
  const $ = cheerio.load(xml, { xmlMode: true });
  const isMultiStatus = findElements($, $.root(), "multistatus").length > 0;
  const rootSyncTokenEl = findElements($, $.root(), "sync-token")[0];
  const rootSyncToken = rootSyncTokenEl
    ? $(rootSyncTokenEl).text().trim() || null
    : null;

  const responseEls = findElements($, $.root(), "response");
  const items: ParsedMultiStatusItem[] = [];

  for (const respEl of responseEls) {
    const $resp = $(respEl);
    const href = directChildText($, $resp, "href");
    if (!href) continue;

    let status = directChildText($, $resp, "status");
    const propstats = findElements($, $resp, "propstat");

    // Collect properties from 2xx propstat blocks (or directly under response if no propstat and 2xx).
    const okProps: cheerio.Cheerio<AnyNode>[] = [];
    if (propstats.length > 0) {
      for (const ps of propstats) {
        const $ps = $(ps);
        const psStatus = directChildText($, $ps, "status");
        if (!psStatus || /\s2\d\d(\s|$)/.test(psStatus)) {
          for (const propEl of findElements($, $ps, "prop")) {
            okProps.push($(propEl));
          }
        } else if (!status && psStatus) {
          status = psStatus;
        }
      }
    } else if (!status || /\s2\d\d(\s|$)/.test(status)) {
      okProps.push($resp);
    }

    let isAddressBook = false;
    let isCollection = false;
    let readOnly = false;
    let displayName: string | null = null;
    let principalHref: string | null = null;
    let homeSetHref: string | null = null;
    let etag: string | null = null;
    let addressData: string | null = null;
    let itemSyncToken: string | null = null;

    for (const $prop of okProps) {
      const resourceTypes = findElements($, $prop, "resourcetype");
      for (const rt of resourceTypes) {
        const $rt = $(rt);
        if (findElements($, $rt, "addressbook").length > 0) {
          isAddressBook = true;
        }
        if (findElements($, $rt, "collection").length > 0) {
          isCollection = true;
        }
      }

      const privSets = findElements($, $prop, "current-user-privilege-set");
      for (const ps of privSets) {
        const $ps = $(ps);
        const canWrite =
          findElements($, $ps, "write").length > 0 ||
          findElements($, $ps, "write-content").length > 0 ||
          findElements($, $ps, "bind").length > 0 ||
          findElements($, $ps, "all").length > 0;
        if (!canWrite && findElements($, $ps, "privilege").length > 0) {
          readOnly = true;
        }
      }

      if (displayName === null) {
        const dn = findElements($, $prop, "displayname")[0];
        if (dn) displayName = $(dn).text().trim() || null;
      }

      if (principalHref === null) {
        const cup = findElements($, $prop, "current-user-principal")[0];
        if (cup) {
          const h = findElements($, $(cup), "href")[0];
          if (h) principalHref = $(h).text().trim() || null;
        }
      }

      if (homeSetHref === null) {
        const ahs = findElements($, $prop, "addressbook-home-set")[0];
        if (ahs) {
          const h = findElements($, $(ahs), "href")[0];
          if (h) homeSetHref = $(h).text().trim() || null;
        }
      }

      if (etag === null) {
        const et = findElements($, $prop, "getetag")[0];
        if (et) etag = cleanEtag($(et).text()) || null;
      }

      if (addressData === null) {
        const ad = findElements($, $prop, "address-data")[0];
        if (ad) addressData = $(ad).text() || null;
      }

      if (itemSyncToken === null) {
        const st = findElements($, $prop, "sync-token")[0];
        if (st) itemSyncToken = $(st).text().trim() || null;
      }
    }

    items.push({
      href,
      status,
      isAddressBook,
      isCollection,
      readOnly,
      displayName,
      principalHref,
      homeSetHref,
      etag,
      addressData,
      syncToken: itemSyncToken,
    });
  }

  return {
    isMultiStatus,
    syncToken:
      rootSyncToken ?? items.find((i) => i.syncToken)?.syncToken ?? null,
    items,
  };
}

function resolveUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

export function normalizeHrefPath(href: string, baseUrl: string): string {
  try {
    const rawPath = new URL(href, baseUrl).pathname;
    return rawPath
      .split("/")
      .map((segment) => {
        if (!segment) return "";
        try {
          return encodeURIComponent(decodeURIComponent(segment));
        } catch {
          return segment;
        }
      })
      .join("/");
  } catch {
    return href;
  }
}

function samePath(pathA: string, pathB: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, "") || "/";
  return clean(pathA) === clean(pathB);
}

const DISCOVERY_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-principal/>
    <c:addressbook-home-set/>
  </d:prop>
</d:propfind>`;

const HOMESET_LIST_PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <d:sync-token/>
  </d:prop>
</d:propfind>`;

export interface AddressBookOption {
  url: string;
  displayName: string;
  readOnly?: boolean;
}

export interface DiscoveredAddressBook {
  addressBookUrl: string;
  displayName: string;
  addressBooks: AddressBookOption[];
}

function rankAddressBook(book: AddressBookOption): number {
  let score = 0;
  if (book.readOnly) score += 100;
  if (
    /recently[-_ ]contacted|z-server-generated|system|shared/i.test(
      `${book.url} ${book.displayName}`,
    )
  ) {
    score += 50;
  }
  if (/\/(contacts|default)\/?$/i.test(book.url)) {
    score -= 10;
  }
  return score;
}

/**
 * Resolve a CardDAV server URL, principal URL, home-set URL, or direct address
 * book URL into the target address book collection URL and available books.
 */
export async function discoverAddressBook(
  config: CarddavConfig,
  secret: CarddavSecret | null,
  signal?: AbortSignal,
): Promise<DiscoveredAddressBook> {
  if (!secret?.password) {
    throw new ConnectorAuthError("CardDAV password is required");
  }
  const auth = basicAuthHeader(config.username, secret.password);
  const startUrl = config.addressBookUrl || config.url;

  async function probeEndpoint(
    targetUrl: string,
    throwOnAuth = true,
  ): Promise<{
    res: DavResponse;
    parsed: ParsedMultiStatus | null;
  }> {
    let res = await davRequest(targetUrl, {
      method: "PROPFIND",
      auth,
      depth: "0",
      contentType: "application/xml; charset=utf-8",
      body: DISCOVERY_PROPFIND_BODY,
      signal,
    });
    // If safeFetch stripped Authorization across a redirect to a trusted
    // subdomain (e.g. example.com -> dav.example.com), re-issue to finalUrl.
    if (
      res.status === 401 &&
      res.finalUrl !== targetUrl &&
      canFollowDiscoveryRedirect(startUrl, res.finalUrl)
    ) {
      res = await davRequest(res.finalUrl, {
        method: "PROPFIND",
        auth,
        depth: "0",
        contentType: "application/xml; charset=utf-8",
        body: DISCOVERY_PROPFIND_BODY,
        signal,
      });
    }
    if (res.status === 401 && throwOnAuth) {
      throw new ConnectorAuthError(
        "CardDAV server rejected the credentials (HTTP 401)",
      );
    }
    if (res.status >= 200 && res.status < 300 && res.body.includes("<")) {
      const parsed = parseMultiStatusXml(res.body);
      if (parsed.isMultiStatus) {
        return { res, parsed };
      }
    }
    return { res, parsed: null };
  }

  const wellKnownUrl = new URL("/.well-known/carddav", startUrl).toString();
  const canTryWellKnown = !config.addressBookUrl && wellKnownUrl !== startUrl;

  let { res: initialRes, parsed } = await probeEndpoint(
    startUrl,
    !canTryWellKnown,
  );
  let baseUrl = initialRes.finalUrl;

  const hasDiscoveryData = (p: ParsedMultiStatus | null) =>
    Boolean(
      p &&
      p.items.some((i) => i.isAddressBook || i.homeSetHref || i.principalHref),
    );

  // If the configured URL is a bare origin or returned 401/403/404/HTML before
  // /.well-known/carddav was tried, probe /.well-known/carddav next.
  if (!hasDiscoveryData(parsed) && canTryWellKnown) {
    const wk = await probeEndpoint(wellKnownUrl, false);
    if (hasDiscoveryData(wk.parsed)) {
      initialRes = wk.res;
      parsed = wk.parsed;
      baseUrl = wk.res.finalUrl;
    } else if (wk.res.status === 401 || initialRes.status === 401) {
      throw new ConnectorAuthError(
        "CardDAV server rejected the credentials (HTTP 401)",
      );
    }
  } else if (initialRes.status === 401) {
    throw new ConnectorAuthError(
      "CardDAV server rejected the credentials (HTTP 401)",
    );
  }

  if (!parsed || parsed.items.length === 0) {
    throw new ConnectorConfigError(
      `CardDAV discovery failed at ${new URL(startUrl).host} (HTTP ${initialRes.status})`,
    );
  }

  // 1. Direct address book URL
  const directAb = parsed.items.find((i) => i.isAddressBook);
  if (directAb) {
    const resolved = resolveUrl(baseUrl, directAb.href);
    const displayName = directAb.displayName || "Contacts";
    return {
      addressBookUrl: resolved,
      displayName,
      addressBooks: [
        { url: resolved, displayName, readOnly: directAb.readOnly },
      ],
    };
  }

  // 2. Determine addressbook-home-set URL (directly or via current-user-principal)
  let homeSetUrl: string | null = null;
  const withHomeSet = parsed.items.find((i) => i.homeSetHref);
  if (withHomeSet?.homeSetHref) {
    homeSetUrl = resolveUrl(baseUrl, withHomeSet.homeSetHref);
  } else {
    const withPrincipal = parsed.items.find((i) => i.principalHref);
    if (withPrincipal?.principalHref) {
      const principalUrl = resolveUrl(baseUrl, withPrincipal.principalHref);
      const principalProbe = await probeEndpoint(principalUrl);
      const pHome = principalProbe.parsed?.items.find((i) => i.homeSetHref);
      if (pHome?.homeSetHref) {
        homeSetUrl = resolveUrl(principalProbe.res.finalUrl, pHome.homeSetHref);
      }
    }
  }

  const listTargetUrl = homeSetUrl ?? baseUrl;
  const listRes = await davRequest(listTargetUrl, {
    method: "PROPFIND",
    auth,
    depth: "1",
    contentType: "application/xml; charset=utf-8",
    body: HOMESET_LIST_PROPFIND_BODY,
    signal,
  });

  if (listRes.status === 401) {
    throw new ConnectorAuthError(
      "CardDAV server rejected the credentials (HTTP 401)",
    );
  }

  if (listRes.status < 200 || listRes.status >= 300) {
    throw new ConnectorConfigError(
      `CardDAV address book listing failed (HTTP ${listRes.status})`,
    );
  }

  const listParsed = parseMultiStatusXml(listRes.body);
  const rawBooks = listParsed.items
    .filter((i) => i.isAddressBook)
    .map((i) => ({
      url: resolveUrl(listRes.finalUrl, i.href),
      displayName: i.displayName || "Contacts",
      readOnly: i.readOnly,
    }));

  if (rawBooks.length === 0) {
    throw new ConnectorConfigError(
      "No CardDAV address book collection found on the server",
    );
  }

  const sortedBooks = [...rawBooks].sort(
    (a, b) => rankAddressBook(a) - rankAddressBook(b),
  );
  const chosen =
    (config.addressBookUrl
      ? sortedBooks.find((b) =>
          samePath(
            normalizeHrefPath(b.url, b.url),
            normalizeHrefPath(config.addressBookUrl!, config.addressBookUrl!),
          ),
        )
      : undefined) ?? sortedBooks[0]!;

  return {
    addressBookUrl: chosen.url,
    displayName: chosen.displayName,
    addressBooks: sortedBooks,
  };
}

export const carddavAdapter: ConnectorAdapter<CarddavConfig, CarddavSecret> = {
  kind: "carddav",
  label: "CardDAV",
  description:
    "Sync contacts two-way or one-way with Nextcloud, iCloud, Fastmail, Radicale or Baïkal",
  capabilities: {
    schedule: true,
  },
  configSchema: carddavConfigSchema,
  secretSchema: carddavSecretSchema,

  async test(
    config: CarddavConfig,
    secret: CarddavSecret | null,
  ): Promise<{
    ok: true;
    detail: string;
    addressBooks?: AddressBookOption[];
  }> {
    const discovered = await discoverAddressBook(config, secret);
    return {
      ok: true,
      detail: `Connected to ${discovered.displayName}`,
      addressBooks: discovered.addressBooks,
    };
  },

  async *sync(
    ctx: SyncContext<CarddavConfig, CarddavSecret>,
  ): AsyncGenerator<SyncEvent, CarddavCursor> {
    const { config, secret, signal, log } = ctx;
    if (!secret?.password) {
      throw new ConnectorAuthError("CardDAV password is required");
    }

    const auth = basicAuthHeader(config.username, secret.password);
    const prevCursor = (ctx.cursor as CarddavCursor | null) ?? {};
    const prevEtags: Record<string, string> = { ...(prevCursor.etags ?? {}) };
    const nextEtags: Record<string, string> = { ...prevEtags };

    const canReuseCursorBook =
      Boolean(prevCursor.addressBookUrl) &&
      (!prevCursor.configuredUrl || prevCursor.configuredUrl === config.url);
    const addressBookUrl =
      config.addressBookUrl ??
      (canReuseCursorBook ? prevCursor.addressBookUrl! : undefined) ??
      (await discoverAddressBook(config, secret, signal)).addressBookUrl;
    const abPath = normalizeHrefPath(addressBookUrl, addressBookUrl);

    let nextSyncToken: string | null = prevCursor.syncToken ?? null;
    const toFetchHrefs = new Set<string>();
    const deletedHrefs = new Set<string>();
    let usedSyncCollection = false;

    // 1. Try incremental RFC 6578 sync-collection REPORT if we have a syncToken,
    // following 507 Insufficient Storage truncation pages within the same run.
    if (prevCursor.syncToken) {
      let currentToken: string = prevCursor.syncToken;
      for (let page = 0; page < MAX_SYNC_PAGES; page++) {
        signal.throwIfAborted();
        const syncReportBody = `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${escapeXml(currentToken)}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop>
    <d:getetag/>
  </d:prop>
</d:sync-collection>`;

        const reportRes = await davRequest(addressBookUrl, {
          method: "REPORT",
          auth,
          depth: "0",
          contentType: "application/xml; charset=utf-8",
          body: syncReportBody,
          signal,
        });

        if (reportRes.status === 401) {
          throw new ConnectorAuthError(
            "CardDAV server rejected the credentials (HTTP 401)",
          );
        }

        const parsed =
          reportRes.status >= 200 &&
          reportRes.status < 300 &&
          reportRes.body.includes("<")
            ? parseMultiStatusXml(reportRes.body)
            : null;

        if (
          !parsed ||
          !parsed.isMultiStatus ||
          (parsed.syncToken === null && parsed.items.length === 0)
        ) {
          if (page === 0) {
            log(
              `Incremental sync report not supported or token expired (HTTP ${reportRes.status}), falling back to full ETag scan`,
            );
          }
          break;
        }

        usedSyncCollection = true;
        if (parsed.syncToken) {
          nextSyncToken = parsed.syncToken;
        }

        let has507Truncation = false;
        for (const item of parsed.items) {
          const normHref = normalizeHrefPath(item.href, addressBookUrl);
          if (item.status !== null && /\s507(\s|$)/.test(item.status)) {
            has507Truncation = true;
            if (samePath(normHref, abPath)) continue;
          }
          if (samePath(normHref, abPath)) continue;
          if (item.isCollection || item.isAddressBook) continue;

          const isDeleted =
            item.status !== null && /\s(404|410)(\s|$)/.test(item.status);
          if (isDeleted) {
            deletedHrefs.add(normHref);
            toFetchHrefs.delete(normHref);
            delete nextEtags[normHref];
            continue;
          }

          const etag = cleanEtag(item.etag);
          if (!prevEtags[normHref] || !etag || prevEtags[normHref] !== etag) {
            toFetchHrefs.add(normHref);
          }
          if (etag) {
            nextEtags[normHref] = etag;
          }
        }

        if (
          has507Truncation &&
          parsed.syncToken &&
          parsed.syncToken !== currentToken
        ) {
          currentToken = parsed.syncToken;
          continue;
        }
        break;
      }
    }

    // 2. Full PROPFIND Depth: 1 ETag scan when no syncToken or sync-collection fell back
    if (!usedSyncCollection) {
      const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:resourcetype/>
    <d:getetag/>
    <d:sync-token/>
  </d:prop>
</d:propfind>`;

      const propRes = await davRequest(addressBookUrl, {
        method: "PROPFIND",
        auth,
        depth: "1",
        contentType: "application/xml; charset=utf-8",
        body: propfindBody,
        signal,
      });

      if (propRes.status === 401) {
        throw new ConnectorAuthError(
          "CardDAV server rejected the credentials (HTTP 401)",
        );
      }
      if (propRes.status < 200 || propRes.status >= 300) {
        throw new ConnectorConfigError(
          `CardDAV PROPFIND failed (HTTP ${propRes.status})`,
        );
      }

      const parsed = parseMultiStatusXml(propRes.body);
      if (parsed.syncToken) {
        nextSyncToken = parsed.syncToken;
      }

      const seenHrefs = new Set<string>();
      for (const item of parsed.items) {
        const normHref = normalizeHrefPath(item.href, addressBookUrl);
        if (samePath(normHref, abPath)) continue;
        if (item.isCollection || item.isAddressBook) continue;

        seenHrefs.add(normHref);
        const etag = cleanEtag(item.etag);
        if (!prevEtags[normHref] || !etag || prevEtags[normHref] !== etag) {
          toFetchHrefs.add(normHref);
        }
        if (etag) {
          nextEtags[normHref] = etag;
        }
      }

      for (const oldHref of Object.keys(prevEtags)) {
        if (!seenHrefs.has(oldHref)) {
          deletedHrefs.add(oldHref);
          delete nextEtags[oldHref];
        }
      }
    }

    // 3. Batch-fetch modified vCards via addressbook-multiget REPORT, halving
    // the batch automatically if a response exceeds the 5 MB cap.
    const fetchMultigetBatch = async (
      batch: string[],
    ): Promise<
      Array<{
        href: string;
        etag: string | null;
        vcard: string;
      }>
    > => {
      signal.throwIfAborted();
      const hrefElements = batch
        .map((h) => `  <d:href>${escapeXml(h)}</d:href>`)
        .join("\n");
      const multigetBody = `<?xml version="1.0" encoding="utf-8"?>
<c:addressbook-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <c:address-data/>
  </d:prop>
${hrefElements}
</c:addressbook-multiget>`;

      let mgRes: DavResponse;
      try {
        mgRes = await davRequest(addressBookUrl, {
          method: "REPORT",
          auth,
          depth: "1",
          contentType: "application/xml; charset=utf-8",
          body: multigetBody,
          signal,
        });
      } catch (err: unknown) {
        if (
          err instanceof DavResponseTooLargeError ||
          (err instanceof Error &&
            /exceeded .* cap|larger than/i.test(err.message))
        ) {
          if (batch.length > 1) {
            const mid = Math.ceil(batch.length / 2);
            const left = await fetchMultigetBatch(batch.slice(0, mid));
            const right = await fetchMultigetBatch(batch.slice(mid));
            return [...left, ...right];
          }
          log(`Skipping oversized vCard at ${batch[0]} (> 5 MB)`);
          return [];
        }
        throw err;
      }

      if (mgRes.status === 401) {
        throw new ConnectorAuthError(
          "CardDAV server rejected the credentials (HTTP 401)",
        );
      }

      if (mgRes.status === 413 || mgRes.status === 507) {
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          const left = await fetchMultigetBatch(batch.slice(0, mid));
          const right = await fetchMultigetBatch(batch.slice(mid));
          return [...left, ...right];
        }
        log(`Skipping oversized vCard at ${batch[0]} (HTTP ${mgRes.status})`);
        return [];
      }

      const vcardPayloads: Array<{
        href: string;
        etag: string | null;
        vcard: string;
      }> = [];

      const parsedMg =
        mgRes.status >= 200 && mgRes.status < 300 && mgRes.body.includes("<")
          ? parseMultiStatusXml(mgRes.body)
          : null;

      if (parsedMg?.isMultiStatus) {
        for (const item of parsedMg.items) {
          const normHref = normalizeHrefPath(item.href, addressBookUrl);
          if (item.status !== null && /\s(404|410)(\s|$)/.test(item.status)) {
            deletedHrefs.add(normHref);
            delete nextEtags[normHref];
            continue;
          }
          if (!item.addressData) continue;
          vcardPayloads.push({
            href: normHref,
            etag: item.etag,
            vcard: item.addressData,
          });
        }
      } else {
        // Fallback for servers that do not implement addressbook-multiget
        for (const href of batch) {
          signal.throwIfAborted();
          try {
            const getRes = await davRequest(resolveUrl(addressBookUrl, href), {
              method: "GET",
              auth,
              signal,
            });
            if (getRes.status === 401) {
              throw new ConnectorAuthError(
                "CardDAV server rejected the credentials (HTTP 401)",
              );
            }
            if (getRes.status === 404 || getRes.status === 410) {
              deletedHrefs.add(href);
              delete nextEtags[href];
              continue;
            }
            if (getRes.status >= 200 && getRes.status < 300 && getRes.body) {
              vcardPayloads.push({
                href,
                etag: cleanEtag(getRes.headers.get("etag")) || null,
                vcard: getRes.body,
              });
            }
          } catch (err: unknown) {
            if (err instanceof ConnectorAuthError) throw err;
            log(`Skipping vCard at ${href}: ${(err as Error).message}`);
          }
        }
      }

      return vcardPayloads;
    };

    const hrefList = Array.from(toFetchHrefs);
    for (let i = 0; i < hrefList.length; i += MULTIGET_BATCH_SIZE) {
      const batch = hrefList.slice(i, i + MULTIGET_BATCH_SIZE);
      const vcardPayloads = await fetchMultigetBatch(batch);

      for (const entry of vcardPayloads) {
        if (entry.etag) {
          nextEtags[entry.href] = entry.etag;
        }

        const { contacts } = extractVCardContacts(entry.vcard);
        for (const parsedContact of contacts) {
          const { avatarUrl, ...contactFields } = parsedContact;
          yield {
            kind: "contact",
            externalId: entry.href,
            contact: contactFields,
            photoUrl: avatarUrl ?? undefined,
          };
        }
      }
    }

    return {
      addressBookUrl,
      configuredUrl: config.url,
      syncToken: nextSyncToken,
      etags: nextEtags,
      pushedHashes: { ...(prevCursor.pushedHashes ?? {}) },
      deletedHrefs: Array.from(deletedHrefs),
      lastSyncAt: new Date().toISOString(),
    };
  },

  async push(
    ctx: PushContext<CarddavConfig, CarddavSecret>,
  ): Promise<PushResult> {
    const { config, secret, signal, log } = ctx;
    const prevCursor = (ctx.cursor as CarddavCursor | null) ?? {};
    const etags: Record<string, string> = { ...(prevCursor.etags ?? {}) };
    const prevHashes: Record<string, string> = {
      ...(prevCursor.pushedHashes ?? {}),
    };
    const legacyUpdatedAt: Record<string, string> = {
      ...(prevCursor.pushedUpdatedAt ?? {}),
    };
    const pushedHashes: Record<string, string> = {};
    const removedExternalIds = prevCursor.deletedHrefs ?? [];
    const removedSet = new Set(removedExternalIds);

    for (const removedHref of removedExternalIds) {
      delete etags[removedHref];
    }

    // Keep pushedHashes pruned to only active contacts in ctx.contacts
    for (const contact of ctx.contacts) {
      if (prevHashes[contact.id]) {
        pushedHashes[contact.id] = prevHashes[contact.id];
      }
      if (ctx.ingestedContactIds.has(contact.id)) {
        pushedHashes[contact.id] = vcardContentHash(contact.vcardInput);
      }
    }

    if ((config.syncDirection ?? "two_way") === "pull_only") {
      return {
        pushed: 0,
        cursor: {
          addressBookUrl: prevCursor.addressBookUrl,
          configuredUrl: prevCursor.configuredUrl ?? config.url,
          syncToken: prevCursor.syncToken ?? null,
          etags,
          pushedHashes,
          deletedHrefs: [],
          lastSyncAt: prevCursor.lastSyncAt,
        },
        newLinks: [],
        removedExternalIds,
      };
    }

    if (!secret?.password) {
      throw new ConnectorAuthError("CardDAV password is required");
    }

    const auth = basicAuthHeader(config.username, secret.password);
    const canReuseCursorBook =
      Boolean(prevCursor.addressBookUrl) &&
      (!prevCursor.configuredUrl || prevCursor.configuredUrl === config.url);
    const addressBookUrl =
      config.addressBookUrl ??
      (canReuseCursorBook ? prevCursor.addressBookUrl! : undefined) ??
      (await discoverAddressBook(config, secret, signal)).addressBookUrl;

    const linkByLocalId = new Map<string, string>();
    for (const link of ctx.links) {
      if (link.localId && !removedSet.has(link.externalId)) {
        linkByLocalId.set(link.localId, link.externalId);
      }
    }

    const rawConnectedMs = parseTimestampMs(ctx.connectorCreatedAt);
    // SQLite `datetime('now')` on contacts.addedAt / updatedAt has 1-second
    // resolution (truncating milliseconds), while connectors.createdAt is ISO
    // with milliseconds. Floor connectedMs to whole seconds so a contact created
    // immediately after connecting within the same second is not skipped.
    const connectedMs = Number.isFinite(rawConnectedMs)
      ? Math.floor(rawConnectedMs / 1000) * 1000
      : NaN;
    let pushed = 0;
    const newLinks: Array<{ externalId: string; localId: string }> = [];

    for (const contact of ctx.contacts) {
      signal.throwIfAborted();
      const currentHash = vcardContentHash(contact.vcardInput);
      if (ctx.ingestedContactIds.has(contact.id)) {
        pushedHashes[contact.id] = currentHash;
        continue;
      }

      const linkedHref = linkByLocalId.get(contact.id);
      const lastHash = pushedHashes[contact.id];
      const legacyTs = legacyUpdatedAt[contact.id];

      if (lastHash) {
        if (lastHash === currentHash) {
          continue;
        }
      } else if (legacyTs) {
        const lastMs = parseTimestampMs(legacyTs);
        const updatedMs = parseTimestampMs(contact.updatedAt);
        if (
          Number.isFinite(lastMs) &&
          Number.isFinite(updatedMs) &&
          Math.floor(lastMs / 1000) * 1000 >= updatedMs
        ) {
          pushedHashes[contact.id] = currentHash;
          continue;
        }
      } else if (!linkedHref) {
        // Unlinked contact never pushed before: skip archived rows and contacts
        // that existed before the connector was connected (unless edited after).
        if (contact.isArchived) {
          pushedHashes[contact.id] = currentHash;
          continue;
        }
        if (!config.pushExistingContacts && Number.isFinite(connectedMs)) {
          const addedMs = parseTimestampMs(contact.addedAt);
          const updatedMs = parseTimestampMs(contact.updatedAt);
          const latestLocalMs = Math.max(
            Number.isFinite(addedMs) ? addedMs : 0,
            Number.isFinite(updatedMs) ? updatedMs : 0,
          );
          if (latestLocalMs > 0 && latestLocalMs < connectedMs) {
            pushedHashes[contact.id] = currentHash;
            continue;
          }
        }
      }

      const targetHref =
        linkedHref ??
        normalizeHrefPath(
          `${addressBookUrl.replace(/\/?$/, "/")}${encodeURIComponent(contact.id)}.vcf`,
          addressBookUrl,
        );
      const targetUrl = resolveUrl(addressBookUrl, targetHref);

      let vcardBody: string;
      if (linkedHref) {
        // GET the current server card first so we replace only the properties
        // Contrack owns and preserve PHOTO, NICKNAME, structured ADR, Apple
        // labels, UID, and every X-* property.
        let existingVCard: string | null = null;
        try {
          const getRes = await davRequest(targetUrl, {
            method: "GET",
            auth,
            signal,
          });
          if (getRes.status === 401) {
            throw new ConnectorAuthError(
              "CardDAV server rejected the credentials on push (HTTP 401)",
            );
          }
          if (
            getRes.status >= 200 &&
            getRes.status < 300 &&
            getRes.body.includes("BEGIN:VCARD")
          ) {
            existingVCard = getRes.body;
            const liveEtag = cleanEtag(getRes.headers.get("etag"));
            if (liveEtag) {
              if (!etags[linkedHref]) {
                etags[linkedHref] = liveEtag;
              } else if (
                isWeakEtag(etags[linkedHref]) &&
                liveEtag !== etags[linkedHref]
              ) {
                log(
                  "Skipped pushing a contact modified on the CardDAV server since last sync",
                );
                pushedHashes[contact.id] = currentHash;
                delete etags[targetHref];
                continue;
              }
            }
          }
        } catch (err: unknown) {
          if (err instanceof ConnectorAuthError) throw err;
        }

        if (existingVCard) {
          vcardBody = patchVCard(existingVCard, contact.vcardInput);
        } else {
          vcardBody = serializeVCard(contact.vcardInput);
        }
      } else {
        vcardBody = serializeVCard({ ...contact.vcardInput, uid: contact.id });
      }

      const headers: Record<string, string> = {};
      if (linkedHref && etags[linkedHref] && !isWeakEtag(etags[linkedHref])) {
        headers["If-Match"] = formatEtagHeader(etags[linkedHref]);
      } else if (!linkedHref) {
        headers["If-None-Match"] = "*";
      }

      const putRes = await davRequest(targetUrl, {
        method: "PUT",
        auth,
        contentType: "text/vcard; charset=utf-8",
        headers,
        body: vcardBody,
        signal,
      });

      if (putRes.status === 401) {
        throw new ConnectorAuthError(
          "CardDAV server rejected the credentials on push (HTTP 401)",
        );
      }

      if (
        putRes.status === 403 ||
        putRes.status === 409 ||
        putRes.status === 412
      ) {
        log(
          `Skipped pushing contact ${contact.id} (CardDAV server returned HTTP ${putRes.status})`,
        );
        pushedHashes[contact.id] = currentHash;
        if (putRes.status === 409 || putRes.status === 412) {
          delete etags[targetHref];
        }
        continue;
      }

      if (putRes.status >= 200 && putRes.status < 300) {
        pushed++;
        pushedHashes[contact.id] = currentHash;
        const responseEtag = cleanEtag(putRes.headers.get("etag"));
        if (responseEtag) {
          etags[targetHref] = responseEtag;
        } else {
          delete etags[targetHref];
        }
        newLinks.push({ externalId: targetHref, localId: contact.id });
      }
    }

    return {
      pushed,
      cursor: {
        addressBookUrl,
        configuredUrl: config.url,
        syncToken: prevCursor.syncToken ?? null,
        etags,
        pushedHashes,
        deletedHrefs: [],
        lastSyncAt: prevCursor.lastSyncAt,
      },
      newLinks,
      removedExternalIds,
    };
  },
};
