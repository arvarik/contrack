/**
 * The CardDAV connector, for any RFC 6352 CardDAV server (Nextcloud, Radicale,
 * Baïkal, Apple iCloud, Fastmail, Synology). Discovers the user's address book
 * via `.well-known/carddav`, `current-user-principal` and
 * `addressbook-home-set`, pulls changes via `sync-collection` / ETag diffing
 * and `addressbook-multiget`, and optionally pushes local contact creates and
 * edits back via conditional `PUT`.
 *
 * @module server/connectors/adapters/carddav
 */

import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
// The slim entry parses with htmlparser2 alone, which xmlMode below uses.
// The full entry loads parse5, which the Docker image removes.
import * as cheerio from "cheerio/slim";
import type { AnyNode, Element } from "domhandler";
import { z } from "zod";
import {
  extractVCardContacts,
  patchVCard,
  serializeVCard,
  VCARD_FIELDS,
  type VCardField,
  type VCardInput,
} from "../../../shared/vcard.ts";
import { isPrivateAddress, safeFetch } from "../../utils/urlSafety.ts";
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
  bookSwitchPending?: boolean;
  activeBookHrefs?: string[];
  syncToken?: string | null;
  etags?: Record<string, string>;
  cardHashes?: Record<string, string>;
  pushedHashes?: Record<string, string>;
  pushedUpdatedAt?: Record<string, string>;
  deletedHrefs?: string[];
  /** Cards the last pull could not read, read again on the next. */
  retryHrefs?: string[];
  /** Cards too large to read, by their ETag: read again when it changes. */
  tooLargeEtags?: Record<string, string>;
  /** Contacts the server refused, by the field hashes it refused. */
  failedHashes?: Record<string, string>;
  lastSyncAt?: string;
}

export const MAX_DAV_BYTES = 5 * 1024 * 1024; // 5 MB response body cap per request
const DAV_TIMEOUT_MS = 15_000;
const DAV_DEADLINE_MS = 60_000;
/**
 * A listing of the book (PROPFIND, sync-collection) carries an href and an
 * ETag per card, about 330 bytes on Radicale, and the server builds it before
 * it answers: 15,000 cards were 4.9 MB after 11 seconds. A larger cap and
 * wait let a book of about 150,000 cards sync.
 */
const MAX_DAV_LISTING_BYTES = 48 * 1024 * 1024;
const DAV_LISTING_TIMEOUT_MS = 5 * 60_000;
export const MULTIGET_BATCH_SIZE = 10;
const MAX_SYNC_PAGES = 50;

class DavResponseTooLargeError extends ConnectorConfigError {
  constructor(maxBytes: number) {
    super(
      `CardDAV response exceeded the ${maxBytes / 1024 / 1024} MB cap (received > ${maxBytes} bytes)`,
    );
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
  return crypto.hash("sha256", serializeVCard(normalized(input))).slice(0, 16);
}

/** A contact's card fields in one form, so a hash changes only with them. */
function normalized(input: VCardInput): VCardInput {
  return {
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
}

const FIELDS = Object.keys(VCARD_FIELDS) as VCardField[];

/**
 * A short hash of each card field Contrack writes, joined by dots: the
 * baseline push keeps per contact, so a push writes only the fields that
 * changed since and a change made on the server to another field stays.
 */
export function vcardFieldHashes(input: VCardInput): string {
  const n = normalized(input);
  const values: Record<VCardField, unknown> = {
    name: [n.name, n.firstName, n.lastName],
    company: n.company,
    role: n.role,
    birthday: n.birthday,
    about: n.about,
    emails: n.emails,
    phones: n.phones,
    addresses: n.addresses,
    web: [n.website, n.socialLinks],
    tags: n.tags,
  };
  return FIELDS.map((field) =>
    crypto.hash("sha256", JSON.stringify(values[field])).slice(0, 6),
  ).join(".");
}

/**
 * The fields that differ from the baseline, or undefined for all of them: a
 * baseline of an earlier version is one hash of the whole card.
 */
function changedFields(
  baseline: string,
  current: string,
): Set<VCardField> | undefined {
  const before = baseline.split(".");
  if (before.length !== FIELDS.length) return undefined;
  const now = current.split(".");
  return new Set(FIELDS.filter((_, i) => before[i] !== now[i]));
}

function remoteCardHash(
  contactFields: VCardInput,
  avatarUrl?: string | null,
): string {
  const base = vcardContentHash(contactFields);
  const photo = avatarUrl?.trim();
  return photo ? `${base}:${crypto.hash("sha256", photo).slice(0, 16)}` : base;
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
  maxBytes: number,
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
        if (received + value.byteLength > maxBytes) {
          throw new DavResponseTooLargeError(maxBytes);
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

/**
 * Whether a host is on the private network: plain http goes only there, with
 * CONNECTORS_ALLOW_PRIVATE_HOSTS, so a password never crosses the internet in
 * cleartext.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  try {
    const addresses = await dns.lookup(host, { all: true });
    return (
      addresses.length > 0 &&
      addresses.every((a) => isPrivateAddress(a.address))
    );
  } catch {
    return false;
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
    /** A listing of the whole book: a larger cap and a longer wait. */
    listing?: boolean;
  },
): Promise<DavResponse> {
  const deadline = AbortSignal.timeout(
    options.listing ? DAV_LISTING_TIMEOUT_MS : DAV_DEADLINE_MS,
  );
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
  if (
    parsedTarget.protocol !== "https:" &&
    !(allowPrivate && (await isPrivateHost(parsedTarget.hostname)))
  ) {
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
      timeoutMs: options.listing ? DAV_LISTING_TIMEOUT_MS : DAV_TIMEOUT_MS,
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

  const body = await readCappedBody(
    res,
    options.listing ? MAX_DAV_LISTING_BYTES : MAX_DAV_BYTES,
    signal,
  );
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
      let fallbackStatus: string | null = null;
      for (const ps of propstats) {
        const $ps = $(ps);
        const psStatus = directChildText($, $ps, "status");
        if (!psStatus || /\s2\d\d(\s|$)/.test(psStatus)) {
          for (const propEl of findElements($, $ps, "prop")) {
            okProps.push($(propEl));
          }
        } else if (!fallbackStatus || /\s507(\s|$)/.test(psStatus)) {
          fallbackStatus = psStatus;
        }
      }
      if (
        !status &&
        (okProps.length === 0 ||
          (fallbackStatus && /\s507(\s|$)/.test(fallbackStatus)))
      ) {
        status = fallbackStatus;
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

function sameAddressBookUrl(urlA: string, urlB: string): boolean {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    if (a.origin.toLowerCase() !== b.origin.toLowerCase()) return false;
    return samePath(
      normalizeHrefPath(a.pathname, a.origin),
      normalizeHrefPath(b.pathname, b.origin),
    );
  } catch {
    return false;
  }
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
  selectedBookFound?: boolean;
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
  options?: { allowFallbackBook?: boolean },
): Promise<DiscoveredAddressBook> {
  if (!secret?.password) {
    throw new ConnectorAuthError("CardDAV password is required");
  }
  const auth = basicAuthHeader(config.username, secret.password);
  const startUrl = config.url;

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
  const canTryWellKnown = wellKnownUrl !== startUrl;

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
    const directMatches =
      !config.addressBookUrl ||
      sameAddressBookUrl(resolved, config.addressBookUrl);
    if (!directMatches && !options?.allowFallbackBook) {
      throw new ConnectorConfigError(
        "Selected address book was not found on the CardDAV server",
      );
    }
    const displayName = directAb.displayName || "Contacts";
    return {
      addressBookUrl: resolved,
      displayName,
      addressBooks: [
        { url: resolved, displayName, readOnly: directAb.readOnly },
      ],
      selectedBookFound: directMatches,
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
  const matchedBook = config.addressBookUrl
    ? sortedBooks.find((b) => sameAddressBookUrl(b.url, config.addressBookUrl!))
    : undefined;
  if (config.addressBookUrl && !matchedBook && !options?.allowFallbackBook) {
    throw new ConnectorConfigError(
      "Selected address book was not found on the CardDAV server",
    );
  }
  const chosen = matchedBook ?? sortedBooks[0]!;

  return {
    addressBookUrl: chosen.url,
    displayName: chosen.displayName,
    addressBooks: sortedBooks,
    selectedBookFound: config.addressBookUrl ? Boolean(matchedBook) : true,
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
    options?: { allowFallbackBook?: boolean },
  ): Promise<{
    ok: true;
    detail: string;
    addressBooks?: AddressBookOption[];
  }> {
    const discovered = await discoverAddressBook(
      config,
      secret,
      undefined,
      options,
    );
    return {
      ok: true,
      detail:
        discovered.selectedBookFound === false
          ? `Selected address book was not found; switched to ${discovered.displayName}`
          : `Connected to ${discovered.displayName}`,
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

    const canReuseCursorBook =
      Boolean(prevCursor.addressBookUrl) &&
      (!prevCursor.configuredUrl ||
        sameAddressBookUrl(prevCursor.configuredUrl, config.url)) &&
      (!config.addressBookUrl ||
        sameAddressBookUrl(prevCursor.addressBookUrl!, config.addressBookUrl));
    const addressBookUrl = canReuseCursorBook
      ? prevCursor.addressBookUrl!
      : (await discoverAddressBook(config, secret, signal)).addressBookUrl;
    const abPath = normalizeHrefPath(addressBookUrl, addressBookUrl);
    const sameBook =
      !prevCursor.addressBookUrl ||
      ((!prevCursor.configuredUrl ||
        sameAddressBookUrl(prevCursor.configuredUrl, config.url)) &&
        sameAddressBookUrl(prevCursor.addressBookUrl, addressBookUrl));
    const needsBookCleanup = !sameBook || Boolean(prevCursor.bookSwitchPending);

    const prevEtags: Record<string, string> = sameBook
      ? { ...(prevCursor.etags ?? {}) }
      : {};
    const nextEtags: Record<string, string> = { ...prevEtags };
    const prevCardHashes: Record<string, string> = sameBook
      ? { ...(prevCursor.cardHashes ?? {}) }
      : {};
    const nextCardHashes: Record<string, string> = { ...prevCardHashes };

    let nextSyncToken: string | null = sameBook
      ? (prevCursor.syncToken ?? null)
      : null;
    const toFetchHrefs = new Set<string>();
    const pendingEtags = new Map<string, string>();
    // Deletions the last push did not take, because it failed, are still
    // owed: the push unlinks them.
    const deletedHrefs = new Set<string>(
      sameBook ? (prevCursor.deletedHrefs ?? []) : [],
    );
    /** Cards that could not be read, with why, for the next run. */
    const failedHrefs = new Map<string, string>();
    /**
     * Cards over the size cap, by their ETag. Reported once and not read
     * again until the ETag changes: the next read would fail the same way.
     */
    const tooLarge: Record<string, string> = sameBook
      ? { ...(prevCursor.tooLargeEtags ?? {}) }
      : {};
    const markTooLarge = (href: string, why: string) => {
      failedHrefs.set(href, why);
      const etag = pendingEtags.get(href);
      if (etag) tooLarge[href] = etag;
    };
    /** A card the server no longer has. Its hash goes after the fetch. */
    const markDeleted = (href: string) => {
      delete tooLarge[href];
      deletedHrefs.add(href);
      toFetchHrefs.delete(href);
      pendingEtags.delete(href);
      delete nextEtags[href];
    };
    /** Keeps a card whose ETag is unchanged, and queues any other to fetch. */
    const noteEtag = (href: string, raw: string | null) => {
      deletedHrefs.delete(href);
      const etag = cleanEtag(raw);
      if (etag && tooLarge[href] === etag) return;
      delete tooLarge[href];
      if (etag && prevEtags[href] === etag) {
        nextEtags[href] = etag;
        return;
      }
      toFetchHrefs.add(href);
      delete nextEtags[href];
      if (etag) pendingEtags.set(href, etag);
    };
    let usedSyncCollection = false;
    let activeBookHrefs: string[] | undefined;

    // 1. Try incremental RFC 6578 sync-collection REPORT if we have a syncToken,
    // following 507 Insufficient Storage truncation pages within the same run.
    if (nextSyncToken && !needsBookCleanup) {
      let currentToken: string = nextSyncToken;
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
          listing: true,
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
          }
          if (samePath(normHref, abPath)) continue;
          if (item.isCollection || item.isAddressBook) continue;

          const isDeleted =
            item.status !== null && /\s(404|410)(\s|$)/.test(item.status);
          if (isDeleted) markDeleted(normHref);
          else noteEtag(normHref, item.etag);
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
        listing: true,
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
      if (!parsed.isMultiStatus) {
        throw new ConnectorConfigError(
          "CardDAV PROPFIND did not return a WebDAV Multi-Status response",
        );
      }
      if (parsed.syncToken) {
        nextSyncToken = parsed.syncToken;
      }

      const seenHrefs = new Set<string>();
      let has507Truncation = false;
      for (const item of parsed.items) {
        const normHref = normalizeHrefPath(item.href, addressBookUrl);
        if (item.status !== null && /\s507(\s|$)/.test(item.status)) {
          has507Truncation = true;
        }
        if (samePath(normHref, abPath)) continue;
        if (item.isCollection || item.isAddressBook) continue;
        if (item.status !== null && !/\s2\d\d(\s|$)/.test(item.status)) {
          continue;
        }

        seenHrefs.add(normHref);
        noteEtag(normHref, item.etag);
      }

      if (needsBookCleanup && !has507Truncation && seenHrefs.size > 0) {
        activeBookHrefs = Array.from(seenHrefs);
      }

      // Guard against an empty or 507-truncated PROPFIND response wiping all links
      if (!has507Truncation && seenHrefs.size > 0) {
        for (const oldHref of Object.keys(prevEtags)) {
          if (!seenHrefs.has(oldHref)) markDeleted(oldHref);
        }
        for (const href of Object.keys(tooLarge)) {
          if (!seenHrefs.has(href)) delete tooLarge[href];
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
          markTooLarge(batch[0]!, "larger than 5 MB");
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
        markTooLarge(batch[0]!, `HTTP ${mgRes.status}`);
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
            markDeleted(normHref);
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
              markDeleted(href);
              continue;
            }
            if (getRes.status >= 200 && getRes.status < 300 && getRes.body) {
              vcardPayloads.push({
                href,
                etag: cleanEtag(getRes.headers.get("etag")) || null,
                vcard: getRes.body,
              });
            } else {
              failedHrefs.set(href, `HTTP ${getRes.status}`);
            }
          } catch (err: unknown) {
            if (err instanceof ConnectorAuthError) throw err;
            failedHrefs.set(href, (err as Error).message);
          }
        }
      }

      return vcardPayloads;
    };

    if (sameBook) {
      for (const href of prevCursor.retryHrefs ?? []) {
        if (!deletedHrefs.has(href)) toFetchHrefs.add(href);
      }
    }
    const hrefList = Array.from(toFetchHrefs);
    for (let i = 0; i < hrefList.length; i += MULTIGET_BATCH_SIZE) {
      const batch = hrefList.slice(i, i + MULTIGET_BATCH_SIZE);
      const vcardPayloads = await fetchMultigetBatch(batch);
      // A card the answer left out was not read: it is tried again, and
      // after a sync-collection nothing else would bring it back.
      const read = new Set(vcardPayloads.map((p) => p.href));
      for (const href of batch) {
        if (!read.has(href) && !deletedHrefs.has(href)) {
          if (!failedHrefs.has(href)) {
            failedHrefs.set(href, "the server did not return it");
          }
        } else {
          failedHrefs.delete(href);
          delete tooLarge[href];
        }
      }

      for (const entry of vcardPayloads) {
        const resolvedEtag = entry.etag ?? pendingEtags.get(entry.href);
        if (resolvedEtag) {
          nextEtags[entry.href] = resolvedEtag;
        }

        const { contacts } = extractVCardContacts(entry.vcard);
        for (const parsedContact of contacts) {
          const { avatarUrl, ...contactFields } = parsedContact;
          const remoteHash = remoteCardHash(contactFields, avatarUrl);
          const prevHash = prevCardHashes[entry.href];
          nextCardHashes[entry.href] = remoteHash;
          if (prevHash && prevHash === remoteHash) {
            continue;
          }
          yield {
            kind: "contact",
            externalId: entry.href,
            contact: contactFields,
            photoUrl: avatarUrl ?? undefined,
            noPhoto: !avatarUrl || undefined,
          };
        }
      }
    }

    for (const deletedHref of deletedHrefs) {
      delete nextCardHashes[deletedHref];
    }
    if (failedHrefs.size > 0) {
      const [href, why] = failedHrefs.entries().next().value!;
      yield {
        kind: "stage_failed",
        message: `${failedHrefs.size} CardDAV card(s) could not be read (${href}: ${why}). A card too large to read is read again when it changes, any other on the next sync`,
      };
    }
    const retry = [...failedHrefs.keys()].filter((href) => !tooLarge[href]);

    return {
      addressBookUrl,
      configuredUrl: config.url,
      bookSwitchPending: needsBookCleanup || undefined,
      activeBookHrefs,
      syncToken: nextSyncToken,
      etags: nextEtags,
      cardHashes: nextCardHashes,
      pushedHashes: { ...(prevCursor.pushedHashes ?? {}) },
      failedHashes: prevCursor.failedHashes,
      deletedHrefs: Array.from(deletedHrefs),
      retryHrefs: retry.length > 0 ? retry : undefined,
      tooLargeEtags: Object.keys(tooLarge).length > 0 ? tooLarge : undefined,
      lastSyncAt: new Date().toISOString(),
    };
  },

  async push(
    ctx: PushContext<CarddavConfig, CarddavSecret>,
  ): Promise<PushResult> {
    const { config, secret, signal } = ctx;
    const prevCursor = (ctx.cursor as CarddavCursor | null) ?? {};
    const etags: Record<string, string> = { ...(prevCursor.etags ?? {}) };
    const cardHashes: Record<string, string> = {
      ...(prevCursor.cardHashes ?? {}),
    };
    const prevHashes: Record<string, string> = {
      ...(prevCursor.pushedHashes ?? {}),
    };
    const legacyUpdatedAt: Record<string, string> = {
      ...(prevCursor.pushedUpdatedAt ?? {}),
    };
    const pushedHashes: Record<string, string> = {};
    const prevFailed = prevCursor.failedHashes ?? {};
    /** Contacts the server refused, kept while their fields stay the same. */
    const failedHashes: Record<string, string> = {};
    const removedExternalIds = [...(prevCursor.deletedHrefs ?? [])];
    const removedSet = new Set(removedExternalIds);

    for (const removedHref of removedExternalIds) {
      delete etags[removedHref];
      delete cardHashes[removedHref];
    }

    const activeBookSet = prevCursor.activeBookHrefs
      ? new Set(prevCursor.activeBookHrefs)
      : null;
    const deferBookSwitchCleanup =
      Boolean(prevCursor.bookSwitchPending) && !activeBookSet;

    // Keep pushedHashes pruned to only active contacts in ctx.contacts. A
    // contact the pull just wrote is at its baseline.
    for (const contact of ctx.contacts) {
      if (prevHashes[contact.id]) {
        pushedHashes[contact.id] = prevHashes[contact.id];
      }
      if (ctx.ingestedContactIds.has(contact.id)) {
        pushedHashes[contact.id] = vcardFieldHashes(contact.vcardInput);
      }
    }

    const canReuseCursorBook =
      Boolean(prevCursor.addressBookUrl) &&
      (!prevCursor.configuredUrl ||
        sameAddressBookUrl(prevCursor.configuredUrl, config.url)) &&
      (!config.addressBookUrl ||
        sameAddressBookUrl(prevCursor.addressBookUrl!, config.addressBookUrl));

    if ((config.syncDirection ?? "two_way") === "pull_only") {
      if (activeBookSet) {
        for (const link of ctx.links) {
          if (removedSet.has(link.externalId)) continue;
          if (!activeBookSet.has(link.externalId)) {
            removedExternalIds.push(link.externalId);
            removedSet.add(link.externalId);
          }
        }
      }
      // A baseline for every contact, so Two-way sync later writes only the
      // contacts edited after this, not every one a meeting touched.
      for (const contact of ctx.contacts) {
        pushedHashes[contact.id] ??= vcardFieldHashes(contact.vcardInput);
      }
      return {
        pushed: 0,
        cursor: {
          addressBookUrl: prevCursor.addressBookUrl ?? undefined,
          configuredUrl: prevCursor.configuredUrl ?? config.url,
          bookSwitchPending: deferBookSwitchCleanup || undefined,
          syncToken: prevCursor.syncToken ?? null,
          etags,
          cardHashes,
          pushedHashes,
          failedHashes: prevCursor.failedHashes,
          deletedHrefs: [],
          retryHrefs: prevCursor.retryHrefs,
          tooLargeEtags: prevCursor.tooLargeEtags,
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
    const addressBookUrl = canReuseCursorBook
      ? prevCursor.addressBookUrl!
      : (await discoverAddressBook(config, secret, signal)).addressBookUrl;

    // The cards each contact is linked to. A contact two cards share, such
    // as a family's address, is written to the card that made it, or else to
    // the card it was linked to first: never to every card.
    const linksByLocalId = new Map<
      string,
      Array<{ href: string; made: boolean }>
    >();
    const pendingSwitchLocalIds = new Set<string>();
    for (const link of ctx.links) {
      if (removedSet.has(link.externalId)) continue;
      if (activeBookSet && !activeBookSet.has(link.externalId)) {
        removedExternalIds.push(link.externalId);
        removedSet.add(link.externalId);
        delete etags[link.externalId];
        delete cardHashes[link.externalId];
        continue;
      }
      if (deferBookSwitchCleanup) {
        if (link.localId) pendingSwitchLocalIds.add(link.localId);
        continue;
      }
      if (link.localId) {
        const list = linksByLocalId.get(link.localId) ?? [];
        list.push({ href: link.externalId, made: Boolean(link.made) });
        linksByLocalId.set(link.localId, list);
      }
    }
    const targetHrefs = (localId: string): string[] => {
      const links = linksByLocalId.get(localId) ?? [];
      const made = links.filter((l) => l.made).map((l) => l.href);
      return made.length > 0 ? made : links.slice(0, 1).map((l) => l.href);
    };

    const connectedMs = parseTimestampMs(ctx.connectorCreatedAt);
    let pushed = 0;
    const newLinks: Array<{ externalId: string; localId: string }> = [];
    /** Contacts not written this run, with why. They are tried again. */
    const failed: string[] = [];

    for (const contact of ctx.contacts) {
      signal.throwIfAborted();
      if (pendingSwitchLocalIds.has(contact.id)) {
        continue;
      }
      const current = vcardFieldHashes(contact.vcardInput);
      if (ctx.ingestedContactIds.has(contact.id)) {
        pushedHashes[contact.id] = current;
        continue;
      }
      if (prevFailed[contact.id] === current) {
        // Refused for good with these fields, and reported then: tried again
        // after the next edit.
        failedHashes[contact.id] = current;
        continue;
      }

      const linkedHrefs = targetHrefs(contact.id);
      const lastHash = pushedHashes[contact.id];
      const legacyTs = legacyUpdatedAt[contact.id];
      /** The fields to write to a linked card. Undefined writes them all. */
      let fields: Set<VCardField> | undefined;

      if (lastHash) {
        if (lastHash === current) continue;
        if (!lastHash.includes(".")) {
          // A whole-card hash of an earlier version: it cannot tell which
          // field changed, and the writer that made it is gone. These fields
          // become the baseline, and nothing is written by surprise.
          pushedHashes[contact.id] = current;
          continue;
        }
        fields = changedFields(lastHash, current);
      } else if (legacyTs) {
        const lastMs = parseTimestampMs(legacyTs);
        const updatedMs = parseTimestampMs(contact.updatedAt);
        if (
          Number.isFinite(lastMs) &&
          Number.isFinite(updatedMs) &&
          Math.floor(lastMs / 1000) * 1000 >= updatedMs
        ) {
          pushedHashes[contact.id] = current;
          continue;
        }
      } else if (linkedHrefs.length === 0) {
        // Unlinked contact never pushed before: skip archived rows and
        // contacts added before the connector was connected. Their content
        // becomes the baseline, so an edit after this uploads them. Not
        // updatedAt: a meeting or a briefing moves it too.
        if (contact.isArchived) {
          pushedHashes[contact.id] = current;
          continue;
        }
        const addedMs = parseTimestampMs(contact.addedAt);
        // SQLite `datetime('now')` on contacts.addedAt has 1-second
        // resolution, while connectors.createdAt is ISO with milliseconds.
        if (
          !config.pushExistingContacts &&
          Number.isFinite(connectedMs) &&
          Number.isFinite(addedMs) &&
          addedMs < Math.floor(connectedMs / 1000) * 1000
        ) {
          pushedHashes[contact.id] = current;
          continue;
        }
      }

      const targets =
        linkedHrefs.length > 0
          ? linkedHrefs
          : [
              normalizeHrefPath(
                `${addressBookUrl.replace(/\/?$/, "/")}${encodeURIComponent(contact.id)}.vcf`,
                addressBookUrl,
              ),
            ];
      /**
       * Writes the contact to one card: true, or why it could not. A linked
       * card is read first, so the PUT changes only the fields Contrack
       * changed and keeps every other line, and its ETag guards the PUT.
       */
      const putCard = async (
        targetHref: string,
        linked: boolean,
      ): Promise<true | { why: string; permanent: boolean }> => {
        /** A refusal that the same request would get again. */
        const refused = (status: number) =>
          status >= 400 && status < 500 && ![408, 412, 429].includes(status);
        const targetUrl = resolveUrl(addressBookUrl, targetHref);
        let vcardBody: string;
        // A new card goes only where nothing is, and a card read first only
        // over the version read. A weak ETag cannot guard a PUT.
        let condition: Record<string, string> = { "If-None-Match": "*" };
        /** The server changed the card after the pull listed it. */
        let changedSincePull = false;
        if (linked) {
          let getRes: DavResponse;
          try {
            getRes = await davRequest(targetUrl, {
              method: "GET",
              auth,
              signal,
            });
          } catch (err: unknown) {
            return {
              why: (err as Error).message,
              permanent: err instanceof DavResponseTooLargeError,
            };
          }
          if (getRes.status === 401) {
            throw new ConnectorAuthError(
              "CardDAV server rejected the credentials on push (HTTP 401)",
            );
          }
          if (getRes.status === 404 || getRes.status === 410) {
            // Gone on the server since the pull: written again in full,
            // only where nothing is.
            delete etags[targetHref];
            vcardBody = serializeVCard({
              ...contact.vcardInput,
              uid: contact.id,
            });
          } else if (
            getRes.status >= 200 &&
            getRes.status < 300 &&
            getRes.body.includes("BEGIN:VCARD")
          ) {
            vcardBody = patchVCard(getRes.body, contact.vcardInput, fields);
            // The ETag of the card just read, not the pull's: the patch is
            // made on this card.
            const readEtag = cleanEtag(getRes.headers.get("etag"));
            const etag = formatEtagHeader(readEtag);
            condition = etag ? { "If-Match": etag } : {};
            changedSincePull = readEtag !== (etags[targetHref] ?? "");
          } else {
            return {
              why: `reading the card answered HTTP ${getRes.status}`,
              permanent: refused(getRes.status),
            };
          }
        } else {
          vcardBody = serializeVCard({
            ...contact.vcardInput,
            uid: contact.id,
          });
        }

        let putRes: DavResponse;
        try {
          putRes = await davRequest(targetUrl, {
            method: "PUT",
            auth,
            contentType: "text/vcard; charset=utf-8",
            headers: condition,
            body: vcardBody,
            signal,
          });
        } catch (err: unknown) {
          if (err instanceof ConnectorAuthError) throw err;
          return { why: (err as Error).message, permanent: false };
        }
        if (putRes.status === 401) {
          throw new ConnectorAuthError(
            "CardDAV server rejected the credentials on push (HTTP 401)",
          );
        }
        if (putRes.status < 200 || putRes.status >= 300) {
          return {
            why: `HTTP ${putRes.status}`,
            permanent: refused(putRes.status),
          };
        }
        if (changedSincePull) {
          // The PUT carried a server edit the pull has not read: no ETag or
          // hash is kept, so the next pull reads the card and takes it.
          delete etags[targetHref];
          delete cardHashes[targetHref];
          return true;
        }
        const { contacts: pushedParsed } = extractVCardContacts(vcardBody);
        cardHashes[targetHref] = pushedParsed[0]
          ? remoteCardHash(pushedParsed[0], pushedParsed[0].avatarUrl)
          : vcardContentHash(contact.vcardInput);
        const responseEtag = cleanEtag(putRes.headers.get("etag"));
        if (responseEtag) {
          etags[targetHref] = responseEtag;
        } else {
          delete etags[targetHref];
        }
        return true;
      };

      let wroteAll = true;
      let allRefused = true;
      for (const targetHref of targets) {
        const result = await putCard(targetHref, linkedHrefs.length > 0);
        if (result === true) {
          if (linkedHrefs.length === 0) {
            newLinks.push({ externalId: targetHref, localId: contact.id });
          }
        } else {
          wroteAll = false;
          allRefused &&= result.permanent;
          failed.push(`${contact.vcardInput.name}: ${result.why}`);
        }
      }
      if (wroteAll) {
        pushed++;
        pushedHashes[contact.id] = current;
      } else if (allRefused) {
        failedHashes[contact.id] = current;
      }
    }

    return {
      pushed,
      errors:
        failed.length > 0
          ? [
              `${failed.length} contact(s) could not be written to the CardDAV server (${failed[0]}). A contact the server refused is tried again after its next edit, any other on the next sync`,
            ]
          : undefined,
      cursor: {
        addressBookUrl,
        configuredUrl: config.url,
        bookSwitchPending: deferBookSwitchCleanup || undefined,
        syncToken: prevCursor.syncToken ?? null,
        etags,
        cardHashes,
        pushedHashes,
        failedHashes:
          Object.keys(failedHashes).length > 0 ? failedHashes : undefined,
        deletedHrefs: [],
        retryHrefs: prevCursor.retryHrefs,
        tooLargeEtags: prevCursor.tooLargeEtags,
        lastSyncAt: prevCursor.lastSyncAt,
      },
      newLinks,
      removedExternalIds,
    };
  },
};
