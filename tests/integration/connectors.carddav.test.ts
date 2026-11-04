/**
 * tests/integration/connectors.carddav.test.ts — the CardDAV connector against
 * a stub server, for the answers Radicale in the connector lab
 * (tests/lab/carddav.lab.test.ts, the main proof) cannot give: a root 401, a
 * read-only book, another host, sabre's 403 and 507, weak and missing ETags, a
 * report that is not XML, answers over 5 MB, refused and failed writes, and
 * the cursor rules for what a failed run leaves to the next.
 */

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import {
  canFollowDiscoveryRedirect,
  MAX_DAV_BYTES,
  normalizeHrefPath,
  parseTimestampMs,
} from "../../server/connectors/adapters/carddav.ts";
import {
  createConnector,
  getConnector,
  runNow,
  testConnector,
  updateConnector,
} from "../../server/connectors/service.ts";
import { contactService } from "../../server/services/contactService.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";

const USER = "alice@example.com";
const PASS = "app-secret-1234";
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;
const A = "/dav/ab/a/";
const B = "/dav/ab/b/";

const vcf = (fn: string, ...lines: string[]) =>
  ["BEGIN:VCARD", "VERSION:3.0", `FN:${fn}`, ...lines, "END:VCARD"].join(
    "\r\n",
  );
/** One multistatus response: its properties, or a 404 when null. */
const entry = (href: string, prop: string | null, extra = "") =>
  `<d:response><d:href>${href}</d:href>${
    prop === null
      ? "<d:status>HTTP/1.1 404 Not Found</d:status>"
      : `<d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>`
  }${extra}</d:response>`;
const BOOK_TYPE =
  "<d:resourcetype><d:collection/><c:addressbook/></d:resourcetype>";

interface Card {
  etag: string;
  vcard: string;
  /** The change that wrote it, for sync-collection. */
  rev: number;
}

const servers: http.Server[] = [];
afterAll(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

/**
 * A CardDAV server with books a and b, the flags that make it answer as
 * another server would, and the PUTs it received.
 */
async function startDav() {
  const books: Record<string, Map<string, Card>> = {
    [A]: new Map(),
    [B]: new Map(),
  };
  /** A card's book: b by its path, or a, which also has cards elsewhere. */
  const bookOf = (href: string) => books[href.startsWith(B) ? B : A]!;
  const tombstones = new Map<string, number>();
  const prefix = `tok-${crypto.randomUUID().slice(0, 6)}-`;
  let rev = 0;
  const flags = {
    rootDenied: false,
    homeSet: "",
    rejectSync: false,
    htmlSync: false,
    page507: false,
    truncate507: false,
    emptyListing: false,
    padListing: false,
    omitEtags: false,
    bigMultiget: false,
    multigetFails: false,
    getStatus: 0,
    editOnGet: false,
    putStatus: 0,
    dropPut: "",
  };
  const dav = {
    url: "",
    flags,
    books,
    puts: [] as Array<{ body: string; ifMatch?: string; ifNoneMatch?: string }>,
    discoveries: 0,
    /** Writes a card, as an edit on the server does. */
    set(href: string, vcard: string, etag = `"e${rev + 1}"`) {
      bookOf(href).set(href, { etag, vcard, rev: ++rev });
    },
    /** Deletes a card, which the next sync-collection reports. */
    drop(href: string) {
      bookOf(href).delete(href);
      tombstones.set(href, ++rev);
    },
  };

  const server = http.createServer(async (req, res) => {
    const p = normalizeHrefPath(
      new URL(req.url!, "http://h").pathname,
      "http://h",
    );
    const send = (status: number, body = "", headers = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    const xml = (...entries: string[]) =>
      send(
        207,
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">${entries.join("")}</d:multistatus>`,
        { "Content-Type": "application/xml" },
      );
    if (p === "/hop") {
      const other = dav.url.replace("127.0.0.1", "localhost");
      return send(302, "", { Location: `${other}/echo` });
    }
    if (p === "/echo") return send(200, req.headers.authorization ?? "none");
    if (req.headers.authorization !== AUTH) return send(401);
    if (p === "/" && flags.rootDenied) return send(401);
    let body = "";
    for await (const chunk of req) body += chunk;

    const token = (at = rev) => `<d:sync-token>${prefix}${at}</d:sync-token>`;
    const etag = (c: Card) =>
      flags.omitEtags ? "" : `<d:getetag>${c.etag}</d:getetag>`;
    // A listing past the 5 MB that a single card may take.
    const pad = flags.padListing
      ? entry(
          `${p}pad/`,
          `<d:resourcetype><d:collection/></d:resourcetype><d:displayname>${"x".repeat(6 << 20)}</d:displayname>`,
        )
      : "";
    const book = books[p];
    const card = bookOf(p).get(p);

    if (p === "/" || p === "/.well-known/carddav") {
      return send(301, "", { Location: "/dav/" });
    }
    if (p === "/dav/") {
      dav.discoveries++;
      return xml(
        entry(
          p,
          "<d:current-user-principal><d:href>/dav/p/</d:href></d:current-user-principal>",
        ),
      );
    }
    if (p === "/dav/p/") {
      return xml(
        entry(
          p,
          `<c:addressbook-home-set><d:href>${flags.homeSet || "/dav/ab/"}</d:href></c:addressbook-home-set>`,
        ),
      );
    }
    if (p === "/dav/ab/") {
      // Book b is read-only and listed first, as Nextcloud lists its
      // "Recently contacted".
      return xml(
        ...[B, A].map((b) =>
          entry(
            b,
            `${BOOK_TYPE}<d:displayname>Book ${b === A ? "a" : "b"}</d:displayname><d:current-user-privilege-set><d:privilege><d:read/></d:privilege>${b === A ? "<d:privilege><d:write/></d:privilege>" : ""}</d:current-user-privilege-set>`,
          ),
        ),
      );
    }
    if (book && req.method === "PROPFIND") {
      const listing = req.headers.depth === "1";
      const truncated =
        listing && flags.truncate507
          ? "<d:propstat><d:prop/><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:propstat>"
          : "";
      const items =
        listing && !flags.emptyListing
          ? [...book].map(([h, c]) => entry(h, `<d:resourcetype/>${etag(c)}`))
          : [];
      return xml(entry(p, `${BOOK_TYPE}${token()}`, truncated), ...items, pad);
    }
    if (book && body.includes("sync-collection")) {
      if (flags.htmlSync) return send(200, "<html>Not WebDAV</html>");
      const since = /<d:sync-token>([^<]*)</.exec(body)?.[1] ?? "";
      if (flags.rejectSync || !since.startsWith(prefix)) {
        return send(
          403,
          '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>',
        );
      }
      const after = Number(since.slice(prefix.length));
      // Absolute hrefs, as some servers write them.
      const changed = [...book]
        .filter(([, c]) => c.rev > after)
        .sort(([, x], [, y]) => x.rev - y.rev)
        .map(([h, c]) => ({
          xml: entry(`${dav.url}${h}`, etag(c)),
          rev: c.rev,
        }));
      if (flags.page507 && changed.length > 1) {
        // sabre's paging: one change, a 507, and the token to go on from.
        return xml(
          changed[0]!.xml,
          `<d:response><d:href>${p}</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>`,
          token(changed[0]!.rev),
        );
      }
      const gone = [...tombstones]
        .filter(([h, at]) => at > after && h.startsWith(p))
        .map(([h]) => entry(h, null));
      return xml(...changed.map((c) => c.xml), ...gone, pad, token());
    }
    if (book) {
      // addressbook-multiget
      if (flags.multigetFails) return send(500);
      const hrefs = [...body.matchAll(/<d:href>([^<]+)</g)].map(([, h]) =>
        normalizeHrefPath(h!, "http://h"),
      );
      if (flags.bigMultiget && hrefs.length > 1) {
        return send(207, "x".repeat(6 << 20));
      }
      return xml(
        ...hrefs.map((h) => {
          const c = bookOf(h).get(h);
          const data = c?.vcard
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return entry(
            h,
            c ? `${etag(c)}<c:address-data>${data}</c:address-data>` : null,
          );
        }),
      );
    }
    if (req.method === "GET") {
      if (flags.getStatus || !card) return send(flags.getStatus || 404);
      if (flags.editOnGet) {
        // Somebody edits the card on the server after the pull.
        flags.editOnGet = false;
        const note = card.vcard.replace(
          "END:VCARD",
          "NOTE:Server note\r\nEND:VCARD",
        );
        dav.set(p, note, '"edited"');
      }
      const now = bookOf(p).get(p)!;
      return send(200, now.vcard, flags.omitEtags ? {} : { ETag: now.etag });
    }
    if (req.method === "PUT") {
      if (flags.dropPut && p.includes(flags.dropPut)) {
        return void req.socket.destroy();
      }
      const ifMatch = req.headers["if-match"];
      const ifNoneMatch = req.headers["if-none-match"];
      dav.puts.push({ body, ifMatch, ifNoneMatch });
      if (flags.putStatus) return send(flags.putStatus);
      if (
        (ifMatch && ifMatch !== card?.etag) ||
        (ifNoneMatch === "*" && card)
      ) {
        return send(412);
      }
      dav.set(p, body);
      const headers = flags.omitEtags ? {} : { ETag: bookOf(p).get(p)!.etag };
      return send(card ? 204 : 201, "", headers);
    }
    send(404);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  dav.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return dav;
}

function newOwner(): Scope {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'h')`,
    )
    .run(id, `${id}@x.test`, id);
  return scopeForOwnerId(id);
}

/** A CardDAV connector on `url`, two-way on book a unless `config` says otherwise. */
const connect = (s: Scope, url: string, config: Record<string, unknown> = {}) =>
  createConnector(s, {
    kind: "carddav",
    name: "dav",
    config: { url, username: USER, addressBookUrl: `${url}${A}`, ...config },
    secret: { password: PASS },
  });

/** The cards a connector links to. */
const linkIds = (connectorId: string) =>
  sqlite
    .prepare(
      "SELECT externalId FROM connector_links WHERE connectorId = ? ORDER BY externalId",
    )
    .pluck()
    .all(connectorId) as string[];

/** The ids of the owner's contacts with this name. */
const named = (s: Scope, name: string) =>
  sqlite
    .prepare("SELECT id FROM contacts WHERE ownerId = ? AND name = ?")
    .pluck()
    .all(s.ownerId, name) as string[];

describe("CardDAV against a stub server", () => {
  it("finds the writable book past a root 401, a read-only book and a home on another host, and keeps the password safe", async () => {
    const s = newOwner();
    const dav = await startDav();
    const test = (config: Record<string, unknown>, password = PASS) =>
      testConnector(s, "carddav", { username: USER, ...config }, { password });

    // iCloud answers 401 at the root, and Nextcloud lists a read-only book.
    dav.flags.rootDenied = true;
    const found = await test({ url: dav.url });
    expect(found.detail).toBe("Connected to Book a");
    expect(found.addressBooks?.map((b) => b.readOnly)).toEqual([false, true]);
    // A chosen book still lists them all.
    const chosen = await test({
      url: dav.url,
      addressBookUrl: found.addressBooks![1]!.url,
    });
    expect([chosen.detail, chosen.addressBooks?.length]).toEqual([
      "Connected to Book b",
      2,
    ]);
    await expect(test({ url: dav.url }, "wrong")).rejects.toThrow(
      /rejected the credentials/,
    );

    // iCloud keeps the books on another host than the one signed in to.
    const partition = dav.url.replace("127.0.0.1", "localhost");
    dav.flags.homeSet = `${partition}/dav/ab/`;
    dav.set(`${A}one.vcf`, vcf("Card One"));
    const icloud = await connect(s, dav.url, {
      addressBookUrl: `${partition}${A}`,
    });
    expect((await runNow(s, icloud.id)).stats.contacts).toBe(1);

    // Plain http goes only to a private host, and only when that is allowed.
    await expect(test({ url: "http://192.0.2.10/dav/" })).rejects.toThrow(
      /https:\/\//,
    );
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "false";
    try {
      await expect(test({ url: dav.url })).rejects.toThrow(/https:\/\//);
    } finally {
      process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    }

    // A redirect to another host does not carry the password, and discovery
    // follows one only to the same host or a subdomain, over https.
    const hop = await safeFetch(`${dav.url}/hop`, {
      headers: { Authorization: AUTH },
      allowPrivate: true,
    });
    expect(await hop.response.text()).toBe("none");
    expect(
      [
        ["https://me.github.io", "https://evil.github.io/dav"],
        ["https://a.co.uk", "https://b.co.uk/dav"],
        ["https://example.com", "http://example.com/dav"],
        ["https://example.com", "https://dav.example.com/dav"],
      ].map(([from, to]) => canFollowDiscoveryRedirect(from!, to!)),
    ).toEqual([false, false, false, true]);
  });

  it("pulls through sabre's 403 and 507, a report that is not XML, answers over 5 MB, and cards it could not read", async () => {
    const s = newOwner();
    const dav = await startDav();
    dav.set(`${A}one.vcf`, vcf("Card One"));
    // Outside the book's path, as behind a proxy.
    dav.set("/cards/two.vcf", vcf("Card Two"));
    Object.assign(dav.flags, { padListing: true, bigMultiget: true });
    const conn = await connect(s, dav.url, { syncDirection: "pull_only" });
    const run = () => runNow(s, conn.id);
    const errors = async () => (await run()).stats.errors ?? 0;

    // A listing over 5 MB, by PROPFIND and then by sync-collection, and a
    // multiget over 5 MB, halved until each answer fits.
    expect([await errors(), await errors()]).toEqual([0, 0]);
    expect(linkIds(conn.id)).toEqual(["/cards/two.vcf", `${A}one.vcf`]);

    // sabre answers a long change list a page at a time.
    dav.set(`${A}three.vcf`, vcf("Card Three"));
    dav.set(`${A}four.vcf`, vcf("Card Four"));
    dav.flags.page507 = true;
    expect(await errors()).toBe(0);
    expect(named(s, "Card Four")).toHaveLength(1);

    // A 200 that is not XML falls back to a full listing.
    Object.assign(dav.flags, { page507: false, htmlSync: true });
    dav.set(`${A}five.vcf`, vcf("Card Five"));
    expect(await errors()).toBe(0);
    expect(named(s, "Card Five")).toHaveLength(1);

    // After sabre's 403 valid-sync-token, a full listing finds a deleted
    // card, but one truncated by a 507, or empty, deletes nothing.
    Object.assign(dav.flags, { htmlSync: false, rejectSync: true });
    dav.drop(`${A}five.vcf`);
    for (const flag of ["truncate507", "emptyListing"] as const) {
      dav.flags[flag] = true;
      await run();
      dav.flags[flag] = false;
      expect(linkIds(conn.id)).toContain(`${A}five.vcf`);
    }
    await run();
    expect(linkIds(conn.id)).not.toContain(`${A}five.vcf`);

    // A card over 5 MB is reported once, and read again when it changes.
    const huge = `${A}huge.vcf`;
    dav.set(huge, vcf("Huge", `NOTE:${"x".repeat(MAX_DAV_BYTES)}`), '"h1"');
    expect([await errors(), await errors()]).toEqual([1, 0]);
    dav.set(huge, vcf("Huge"), '"h2"');
    await run();
    expect(named(s, "Huge")).toHaveLength(1);

    // A card the server would not send is read on the next sync, which
    // does not list it again.
    Object.assign(dav.flags, {
      rejectSync: false,
      multigetFails: true,
      getStatus: 503,
    });
    dav.set(`${A}six.vcf`, vcf("Card Six"));
    expect(await errors()).toBe(1);
    Object.assign(dav.flags, { multigetFails: false, getStatus: 0 });
    await run();
    expect(named(s, "Card Six")).toHaveLength(1);
  });

  it("pushes past a weak ETag, refusals, server errors, failed reads, a server edit and a dropped connection", async () => {
    const s = newOwner();
    const dav = await startDav();
    const kim = `${A}kim.vcf`;
    dav.set(kim, vcf("Kim Lee", "NICKNAME:Kiki"), 'W/"weak"');
    const conn = await connect(s, dav.url);
    const run = () => runNow(s, conn.id);
    const errors = async () => (await run()).stats.errors ?? 0;
    await run();
    const [id] = named(s, "Kim Lee");
    const edit = (company: string) =>
      contactService.updateContact(s, id!, { company });
    const lastPut = () => dav.puts.at(-1)!;
    const stored = () => dav.books[A]!.get(kim)!.vcard;

    // A weak ETag cannot guard a PUT.
    edit("Weak");
    expect(await errors()).toBe(0);
    expect(lastPut().ifMatch).toBeUndefined();

    // A server error is tried again on every run, and a refusal is reported
    // once and tried again after the next edit, with the connector active.
    edit("Refused");
    dav.flags.putStatus = 503;
    expect([await errors(), await errors()]).toEqual([1, 1]);
    dav.flags.putStatus = 403;
    expect(await errors()).toBe(1);
    expect(getConnector(s, conn.id)?.status).toBe("active");
    let tried = dav.puts.length;
    expect(await errors()).toBe(0);
    expect(dav.puts).toHaveLength(tried);

    // A server edit after the pull: the PUT goes over the card it read, and
    // the next pull takes the edit the PUT carried.
    Object.assign(dav.flags, { putStatus: 0, editOnGet: true });
    edit("Edited");
    expect(await errors()).toBe(0);
    expect(lastPut().ifMatch).toBe('"edited"');
    await run();
    expect(contactService.getContactById(s, id!)!.about).toBe("Server note");

    // A card that cannot be read first is not written over.
    edit("Unread");
    dav.flags.getStatus = 503;
    tried = dav.puts.length;
    expect(await errors()).toBe(1);
    expect(dav.puts).toHaveLength(tried);
    // A false 404 writes only where nothing is, which the server refuses.
    dav.flags.getStatus = 404;
    expect(await errors()).toBe(1);
    expect(lastPut().ifNoneMatch).toBe("*");
    expect(stored()).toContain("NICKNAME:Kiki");
    dav.flags.getStatus = 0;
    expect(await errors()).toBe(0);
    expect(stored()).toContain("ORG:Unread");

    // A connection dropped mid-push keeps the cards already written.
    const one = contactService.createContact(s, { name: "Aaa Local" })!;
    const two = contactService.createContact(s, { name: "Bbb Local" })!;
    const linked = () =>
      [one.id, two.id].map((c) =>
        linkIds(conn.id).includes(`${A}${encodeURIComponent(c)}.vcf`),
      );
    dav.flags.dropPut = two.id;
    await run();
    expect(linked()).toEqual([true, false]);
    dav.flags.dropPut = "";
    await run();
    expect(linked()).toEqual([true, true]);
  });

  it("finishes a deletion and a book switch that a refused push left open, and discovers the book again only for another server", async () => {
    const s = newOwner();
    const dav = await startDav();
    dav.set(`${A}one.vcf`, vcf("Card One"));
    dav.set(`${A}two.vcf`, vcf("Card Two"));
    dav.set(`${B}other.vcf`, vcf("Other Person"));
    const conn = await connect(s, dav.url);
    const run = () => runNow(s, conn.id);
    await run();
    const [one] = named(s, "Card One");
    const edit = (company: string) =>
      contactService.updateContact(s, one!, { company });

    // The server reports a deletion once, in a run whose push it refuses.
    dav.drop(`${A}two.vcf`);
    edit("First");
    dav.flags.putStatus = 401;
    expect((await run()).status).toBe("error");
    dav.flags.putStatus = 0;
    await run();
    expect(linkIds(conn.id)).toEqual([`${A}one.vcf`]);

    // On a switch to book b, a listing that is empty or truncated, or a
    // refused push, keeps a's links until a full listing of b, which an
    // ETag-less server gives too.
    await updateConnector(s, conn.id, {
      config: {
        url: dav.url,
        username: USER,
        addressBookUrl: `${dav.url}${B}`,
      },
    });
    for (const flag of ["emptyListing", "truncate507"] as const) {
      dav.flags[flag] = true;
      await run();
      dav.flags[flag] = false;
      expect(linkIds(conn.id)).toContain(`${A}one.vcf`);
    }
    edit("Second");
    dav.flags.putStatus = 401;
    expect((await run()).status).toBe("error");
    Object.assign(dav.flags, { putStatus: 0, omitEtags: true });
    await run();
    expect(linkIds(conn.id)).toEqual([`${B}${one}.vcf`, `${B}other.vcf`]);
    // A PUT answered without an ETag is not read back as a change.
    const settled = await run();
    expect([settled.stats.contacts, settled.stats.pushed]).toEqual([
      0,
      undefined,
    ]);

    // The cursor keeps the book, until the server URL changes.
    let found = dav.discoveries;
    await run();
    expect(dav.discoveries).toBe(found);
    await updateConnector(s, conn.id, {
      config: {
        url: dav.url.replace("127.0.0.1", "localhost"),
        username: USER,
      },
      secret: { password: PASS },
    });
    found = dav.discoveries;
    await run();
    expect(dav.discoveries).toBe(found + 1);
  });

  it("reads a SQLite timestamp as UTC", () => {
    expect(parseTimestampMs("2026-10-16 12:00:00")).toBe(
      Date.parse("2026-10-16T12:00:00Z"),
    );
  });
});
