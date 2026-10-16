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

import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { z } from "zod";
import {
  extractVCardContacts,
  firstValue,
  parseVCards,
  serializeVCard,
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
});

export const carddavSecretSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type CarddavConfig = z.infer<typeof carddavConfigSchema>;
export type CarddavSecret = z.infer<typeof carddavSecretSchema>;

export interface CarddavCursor {
  addressBookUrl?: string;
  syncToken?: string | null;
  etags?: Record<string, string>;
  uids?: Record<string, string>;
  pushedUpdatedAt?: Record<string, string>;
  deletedHrefs?: string[];
  lastSyncAt?: string;
}

const MAX_DAV_BYTES = 5 * 1024 * 1024; // 5 MB response body cap
const DAV_TIMEOUT_MS = 15_000;
const DAV_DEADLINE_MS = 60_000;
const MULTIGET_BATCH_SIZE = 50;

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

function formatEtagHeader(etag: string): string {
  const trimmed = etag.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith('"') || trimmed.startsWith("W/")) return trimmed;
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
          throw new ConnectorConfigError(
            `CardDAV response exceeded 5 MB cap (received > ${MAX_DAV_BYTES} bytes)`,
          );
        }
        received += value.byteLength;
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
    return text;
  } finally {
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

  const body = await readCappedBody(res, signal);
  return {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    body,
    finalUrl,
  };
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

interface ParsedMultiStatusItem {
  href: string;
  status: string | null;
  isAddressBook: boolean;
  isCollection: boolean;
  displayName: string | null;
  principalHref: string | null;
  homeSetHref: string | null;
  etag: string | null;
  addressData: string | null;
  syncToken: string | null;
}

interface ParsedMultiStatus {
  syncToken: string | null;
  items: ParsedMultiStatusItem[];
}

/**
 * Parse a WebDAV 207 Multi-Status XML payload using Cheerio in XML mode,
 * stripping namespace prefixes so any server's prefix choices work.
 */
export function parseMultiStatusXml(xml: string): ParsedMultiStatus {
  const $ = cheerio.load(xml, { xmlMode: true });
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

    const status = directChildText($, $resp, "status");
    const propstats = findElements($, $resp, "propstat");

    // Collect properties from 2xx propstat blocks (or directly under response if no propstat).
    const okProps: cheerio.Cheerio<AnyNode>[] = [];
    if (propstats.length > 0) {
      for (const ps of propstats) {
        const $ps = $(ps);
        const psStatus = directChildText($, $ps, "status");
        if (!psStatus || /\s2\d\d(\s|$)/.test(psStatus)) {
          for (const propEl of findElements($, $ps, "prop")) {
            okProps.push($(propEl));
          }
        }
      }
    } else {
      okProps.push($resp);
    }

    let isAddressBook = false;
    let isCollection = false;
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
      displayName,
      principalHref,
      homeSetHref,
      etag,
      addressData,
      syncToken: itemSyncToken,
    });
  }

  return {
    syncToken:
      rootSyncToken ?? items.find((i) => i.syncToken)?.syncToken ?? null,
    items,
  };
}

function resolveUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString();
}

function normalizeHrefPath(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).pathname;
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
    <d:sync-token/>
  </d:prop>
</d:propfind>`;

export interface DiscoveredAddressBook {
  addressBookUrl: string;
  displayName: string;
}

/**
 * Resolve a CardDAV server URL, principal URL, home-set URL, or direct address
 * book URL into the target address book collection URL and display name.
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

  async function probeEndpoint(targetUrl: string): Promise<{
    res: DavResponse;
    parsed: ParsedMultiStatus | null;
  }> {
    const res = await davRequest(targetUrl, {
      method: "PROPFIND",
      auth,
      depth: "0",
      contentType: "application/xml; charset=utf-8",
      body: DISCOVERY_PROPFIND_BODY,
      signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new ConnectorAuthError(
        `CardDAV server rejected the credentials (HTTP ${res.status})`,
      );
    }
    if (res.status >= 200 && res.status < 300 && res.body.includes("<")) {
      return { res, parsed: parseMultiStatusXml(res.body) };
    }
    return { res, parsed: null };
  }

  let { res: initialRes, parsed } = await probeEndpoint(config.url);
  let baseUrl = initialRes.finalUrl;

  const hasDiscoveryData = (p: ParsedMultiStatus | null) =>
    Boolean(
      p &&
      p.items.some((i) => i.isAddressBook || i.homeSetHref || i.principalHref),
    );

  // If the configured URL is a bare origin or path without DAV properties, try /.well-known/carddav
  if (!hasDiscoveryData(parsed)) {
    const wellKnownUrl = new URL("/.well-known/carddav", config.url).toString();
    if (wellKnownUrl !== config.url) {
      const wk = await probeEndpoint(wellKnownUrl);
      if (hasDiscoveryData(wk.parsed)) {
        initialRes = wk.res;
        parsed = wk.parsed;
        baseUrl = wk.res.finalUrl;
      }
    }
  }

  if (!parsed || parsed.items.length === 0) {
    throw new ConnectorConfigError(
      `CardDAV discovery failed at ${new URL(config.url).host} (HTTP ${initialRes.status})`,
    );
  }

  // 1. Direct address book URL
  const directAb = parsed.items.find((i) => i.isAddressBook);
  if (directAb) {
    return {
      addressBookUrl: resolveUrl(baseUrl, directAb.href),
      displayName: directAb.displayName || "Contacts",
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

  if (listRes.status === 401 || listRes.status === 403) {
    throw new ConnectorAuthError(
      `CardDAV server rejected the credentials (HTTP ${listRes.status})`,
    );
  }

  if (listRes.status < 200 || listRes.status >= 300) {
    throw new ConnectorConfigError(
      `CardDAV address book listing failed (HTTP ${listRes.status})`,
    );
  }

  const listParsed = parseMultiStatusXml(listRes.body);
  const addressBookItem = listParsed.items.find((i) => i.isAddressBook);
  if (!addressBookItem) {
    throw new ConnectorConfigError(
      "No CardDAV address book collection found on the server",
    );
  }

  return {
    addressBookUrl: resolveUrl(listRes.finalUrl, addressBookItem.href),
    displayName: addressBookItem.displayName || "Contacts",
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
  ): Promise<{ ok: true; detail: string }> {
    const discovered = await discoverAddressBook(config, secret);
    return {
      ok: true,
      detail: `Connected to ${discovered.displayName}`,
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
    const nextUids: Record<string, string> = { ...(prevCursor.uids ?? {}) };

    log("Discovering CardDAV address book");
    const { addressBookUrl } = await discoverAddressBook(
      config,
      secret,
      signal,
    );
    const abPath = normalizeHrefPath(addressBookUrl, addressBookUrl);

    let nextSyncToken: string | null = prevCursor.syncToken ?? null;
    const toFetchHrefs: string[] = [];
    const deletedHrefs: string[] = [];
    let usedSyncCollection = false;

    // 1. Try incremental RFC 6578 sync-collection REPORT if we have a syncToken
    if (prevCursor.syncToken) {
      const syncReportBody = `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${escapeXml(prevCursor.syncToken)}</d:sync-token>
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

      if (reportRes.status >= 200 && reportRes.status < 300) {
        usedSyncCollection = true;
        const parsed = parseMultiStatusXml(reportRes.body);
        if (parsed.syncToken) {
          nextSyncToken = parsed.syncToken;
        }
        for (const item of parsed.items) {
          const normHref = normalizeHrefPath(item.href, addressBookUrl);
          if (samePath(normHref, abPath)) continue;
          if (item.isCollection || item.isAddressBook) continue;

          const isDeleted =
            item.status !== null && /\s(404|410)(\s|$)/.test(item.status);
          if (isDeleted) {
            deletedHrefs.push(normHref);
            delete nextEtags[normHref];
            delete nextUids[normHref];
            continue;
          }

          const etag = cleanEtag(item.etag);
          if (!prevEtags[normHref] || !etag || prevEtags[normHref] !== etag) {
            toFetchHrefs.push(normHref);
          }
          if (etag) {
            nextEtags[normHref] = etag;
          }
        }
      } else {
        log(
          `Incremental sync token not accepted (HTTP ${reportRes.status}), falling back to full ETag scan`,
        );
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

      if (propRes.status === 401 || propRes.status === 403) {
        throw new ConnectorAuthError(
          `CardDAV server rejected the credentials (HTTP ${propRes.status})`,
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
          toFetchHrefs.push(normHref);
        }
        if (etag) {
          nextEtags[normHref] = etag;
        }
      }

      for (const oldHref of Object.keys(prevEtags)) {
        if (!seenHrefs.has(oldHref)) {
          deletedHrefs.push(oldHref);
          delete nextEtags[oldHref];
          delete nextUids[oldHref];
        }
      }
    }

    // 3. Batch-fetch modified vCards via addressbook-multiget REPORT
    let fetched = 0;
    for (let i = 0; i < toFetchHrefs.length; i += MULTIGET_BATCH_SIZE) {
      signal.throwIfAborted();
      const batch = toFetchHrefs.slice(i, i + MULTIGET_BATCH_SIZE);
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

      const mgRes = await davRequest(addressBookUrl, {
        method: "REPORT",
        auth,
        depth: "1",
        contentType: "application/xml; charset=utf-8",
        body: multigetBody,
        signal,
      });

      if (mgRes.status === 401 || mgRes.status === 403) {
        throw new ConnectorAuthError(
          `CardDAV server rejected the credentials (HTTP ${mgRes.status})`,
        );
      }

      const vcardPayloads: Array<{
        href: string;
        etag: string | null;
        vcard: string;
      }> = [];

      if (mgRes.status >= 200 && mgRes.status < 300) {
        const parsedMg = parseMultiStatusXml(mgRes.body);
        for (const item of parsedMg.items) {
          if (!item.addressData) continue;
          const normHref = normalizeHrefPath(item.href, addressBookUrl);
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
          const getRes = await davRequest(resolveUrl(addressBookUrl, href), {
            method: "GET",
            auth,
            signal,
          });
          if (getRes.status >= 200 && getRes.status < 300 && getRes.body) {
            vcardPayloads.push({
              href,
              etag: cleanEtag(getRes.headers.get("etag")) || null,
              vcard: getRes.body,
            });
          }
        }
      }

      for (const entry of vcardPayloads) {
        if (entry.etag) {
          nextEtags[entry.href] = entry.etag;
        }
        const rawCards = parseVCards(entry.vcard);
        const firstUid = rawCards[0] ? firstValue(rawCards[0], "UID") : null;
        if (firstUid) {
          nextUids[entry.href] = firstUid;
        }

        const { contacts } = extractVCardContacts(entry.vcard);
        for (const parsedContact of contacts) {
          fetched++;
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
      syncToken: nextSyncToken,
      etags: nextEtags,
      uids: nextUids,
      pushedUpdatedAt: { ...(prevCursor.pushedUpdatedAt ?? {}) },
      deletedHrefs,
      lastSyncAt: new Date().toISOString(),
    };
  },

  async push(
    ctx: PushContext<CarddavConfig, CarddavSecret>,
  ): Promise<PushResult> {
    const { config, secret, signal, log } = ctx;
    const prevCursor = (ctx.cursor as CarddavCursor | null) ?? {};
    const etags: Record<string, string> = { ...(prevCursor.etags ?? {}) };
    const uids: Record<string, string> = { ...(prevCursor.uids ?? {}) };
    const pushedUpdatedAt: Record<string, string> = {
      ...(prevCursor.pushedUpdatedAt ?? {}),
    };
    const removedExternalIds = prevCursor.deletedHrefs ?? [];
    const removedSet = new Set(removedExternalIds);

    for (const removedHref of removedExternalIds) {
      delete etags[removedHref];
      delete uids[removedHref];
    }

    // Mark contacts just pulled during this run so we never echo them right back
    for (const contact of ctx.contacts) {
      if (ctx.ingestedContactIds.has(contact.id)) {
        pushedUpdatedAt[contact.id] = contact.updatedAt;
      }
    }

    if ((config.syncDirection ?? "two_way") === "pull_only") {
      return {
        pushed: 0,
        cursor: {
          ...prevCursor,
          etags,
          uids,
          pushedUpdatedAt,
          deletedHrefs: [],
        },
        newLinks: [],
        removedExternalIds,
      };
    }

    if (!secret?.password) {
      throw new ConnectorAuthError("CardDAV password is required");
    }

    const auth = basicAuthHeader(config.username, secret.password);
    const addressBookUrl =
      prevCursor.addressBookUrl ??
      (await discoverAddressBook(config, secret, signal)).addressBookUrl;

    const linkByLocalId = new Map<string, string>();
    for (const link of ctx.links) {
      if (link.localId && !removedSet.has(link.externalId)) {
        linkByLocalId.set(link.localId, link.externalId);
      }
    }

    let pushed = 0;
    const newLinks: Array<{ externalId: string; localId: string }> = [];

    for (const contact of ctx.contacts) {
      signal.throwIfAborted();
      if (ctx.ingestedContactIds.has(contact.id)) {
        continue;
      }

      const linkedHref = linkByLocalId.get(contact.id);
      const lastPushed = pushedUpdatedAt[contact.id];

      if (linkedHref) {
        if (lastPushed && lastPushed >= contact.updatedAt) {
          continue;
        }
      } else {
        // Unlinked contact: if it was already synced earlier and hasn't been
        // edited since, it was deleted on the remote server—do not resurrect it.
        if (lastPushed && lastPushed >= contact.updatedAt) {
          continue;
        }
      }

      const targetHref =
        linkedHref ??
        normalizeHrefPath(
          `${addressBookUrl.replace(/\/?$/, "/")}${encodeURIComponent(contact.id)}.vcf`,
          addressBookUrl,
        );
      const targetUrl = resolveUrl(addressBookUrl, targetHref);
      const uid = (linkedHref ? uids[linkedHref] : undefined) || contact.id;
      const vcardBody = serializeVCard({ ...contact.vcardInput, uid });

      const headers: Record<string, string> = {};
      if (linkedHref && etags[linkedHref]) {
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

      if (putRes.status === 401 || putRes.status === 403) {
        throw new ConnectorAuthError(
          `CardDAV server rejected the credentials on push (HTTP ${putRes.status})`,
        );
      }

      if (putRes.status === 412 || putRes.status === 409) {
        log(
          "Skipped pushing a contact modified on the CardDAV server since last sync",
        );
        pushedUpdatedAt[contact.id] = contact.updatedAt;
        delete etags[targetHref];
        continue;
      }

      if (putRes.status >= 200 && putRes.status < 300) {
        pushed++;
        pushedUpdatedAt[contact.id] = contact.updatedAt;
        uids[targetHref] = uid;
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
        ...prevCursor,
        addressBookUrl,
        etags,
        uids,
        pushedUpdatedAt,
        deletedHrefs: [],
      },
      newLinks,
      removedExternalIds,
    };
  },
};
