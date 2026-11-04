/**
 * Connector lab helpers: an owner, mail in GreenMail, cards in Radicale and
 * an ICS feed served from the test. The servers come from
 * tests/lab/compose.yml, see `npm run test:lab`.
 */

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ImapFlow } from "imapflow";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";

export const IMAP_PORT = 3143;
export const RADICALE = "http://127.0.0.1:5232";
export const DAY_MS = 86_400_000;

/** A new owner with a user row, so the login address counts as the owner. */
export function labOwner(): { ownerId: string; scope: Scope; email: string } {
  const ownerId = `lab-${crypto.randomUUID().slice(0, 8)}`;
  const email = `${ownerId}@lab.test`;
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')`,
    )
    .run(ownerId, email, ownerId);
  return { ownerId, scope: scopeForOwnerId(ownerId), email };
}

/** An RFC 5322 message as GreenMail stores it. */
export function mail(m: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: Date;
  messageId?: string;
  headers?: Record<string, string>;
  body?: string;
}): string {
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc ? [`Cc: ${m.cc}`] : []),
    `Subject: ${m.subject}`,
    `Date: ${m.date.toUTCString()}`,
    `Message-ID: ${m.messageId ?? `<${crypto.randomUUID()}@lab.test>`}`,
    ...Object.entries(m.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    m.body ?? "Hello.",
    "",
  ].join("\r\n");
}

/** Signs in to GreenMail as `user`, which makes the mailbox on first use. */
export async function imap<T>(
  user: string,
  work: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = new ImapFlow({
    host: "127.0.0.1",
    port: IMAP_PORT,
    secure: false,
    auth: { user, pass: "lab" },
    logger: false,
  });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.logout();
  }
}

/** Puts each message in `folder`, with its date as the internal date. */
export function appendMail(
  user: string,
  folder: string,
  messages: Array<Parameters<typeof mail>[0]>,
): Promise<void> {
  return imap(user, async (client) => {
    if (folder !== "INBOX") {
      const list = await client.list();
      if (!list.some((m) => m.path === folder))
        await client.mailboxCreate(folder);
    }
    for (const m of messages)
      await client.append(folder, mail(m), ["\\Seen"], m.date);
  });
}

/** An ICS feed on 127.0.0.1 whose body a test can change between syncs. */
export async function icsFeed(): Promise<{
  url: string;
  set(body: string): void;
  close(): Promise<void>;
}> {
  let body = "";
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/calendar.ics`,
    set: (next) => (body = next),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A VCALENDAR around the given VEVENT blocks. */
export function calendar(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Contrack//Lab//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** An ICS UTC timestamp, such as 20261104T090000Z. */
export function icsTime(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** A vCard 3.0 with the given property lines. */
export function vcard(...lines: string[]): string {
  return ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD", ""].join("\r\n");
}

/** A Radicale address book for `user`, made empty for this test. */
export async function radicaleBook(user: string) {
  const auth = `Basic ${Buffer.from(`${user}:lab`).toString("base64")}`;
  const url = `${RADICALE}/${user}/contacts/`;
  const dav = (path: string, init: RequestInit) =>
    fetch(path, {
      ...init,
      headers: { Authorization: auth, ...(init.headers ?? {}) },
    });
  const made = await dav(url, {
    method: "MKCOL",
    headers: { "Content-Type": "application/xml" },
    body: `<?xml version="1.0" encoding="utf-8"?>
<mkcol xmlns="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav"><set><prop>
<resourcetype><collection/><CR:addressbook/></resourcetype>
<displayname>Contacts</displayname></prop></set></mkcol>`,
  });
  if (!made.ok) throw new Error(`MKCOL ${made.status}`);
  return {
    url,
    user,
    async put(uid: string, card: string): Promise<void> {
      const res = await dav(`${url}${uid}.vcf`, {
        method: "PUT",
        headers: { "Content-Type": "text/vcard; charset=utf-8" },
        body: card,
      });
      if (!res.ok) throw new Error(`PUT ${uid} ${res.status}`);
    },
    async remove(uid: string): Promise<void> {
      const res = await dav(`${url}${uid}.vcf`, { method: "DELETE" });
      if (!res.ok) throw new Error(`DELETE ${uid} ${res.status}`);
    },
    /** Every card in the book, by file name. */
    async cards(): Promise<Map<string, string>> {
      const res = await dav(url, {
        method: "REPORT",
        headers: { Depth: "1", "Content-Type": "application/xml" },
        body: `<?xml version="1.0" encoding="utf-8"?>
<CR:addressbook-query xmlns="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav">
<prop><CR:address-data/></prop></CR:addressbook-query>`,
      });
      const xml = await res.text();
      const out = new Map<string, string>();
      for (const m of xml.matchAll(
        /<href>[^<]*\/([^/<]+)<\/href>[\s\S]*?<CR:address-data>([\s\S]*?)<\/CR:address-data>/g,
      ))
        out.set(decodeURIComponent(m[1]), m[2].replace(/&#13;/g, "\r"));
      return out;
    },
  };
}
