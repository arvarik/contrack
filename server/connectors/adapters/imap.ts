/**
 * The IMAP connector: any standard IMAP server (Gmail, Fastmail, iCloud,
 * Dovecot) with an app password. It pulls message headers into interactions,
 * and fetches bodies for AI summaries of matched contacts when asked.
 *
 * @module server/connectors/adapters/imap
 */

import net from "node:net";
import dns from "node:dns/promises";
import { text } from "node:stream/consumers";
import { ImapFlow, type MessageStructureObject } from "imapflow";
import { z } from "zod";
import { isPrivateAddress } from "../../utils/urlSafety.ts";
import { log } from "../../utils/logger.ts";
import { pageText } from "../../services/research/pages.ts";
import {
  ConnectorAuthError,
  ConnectorConfigError,
  ConnectorUnavailableError,
  type ConnectorError,
} from "../errors.ts";
import { mailDate, normalizeEmail } from "../email/normalize.ts";
import {
  summarizeEmail,
  summariesAllowed,
  MAX_SUMMARIES_PER_RUN,
} from "../summaries.ts";
import type { ConnectorAdapter, SyncContext, SyncEvent } from "../types.ts";

export const imapConfigSchema = z.object({
  host: z.string().trim().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535).default(993),
  secure: z.boolean().default(true),
  username: z.string().trim().min(1, "Username is required"),
  folders: z.array(z.string()).optional(),
  aliases: z.array(z.string()).default([]),
  summaries: z.boolean().default(false),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(90),
  rollup: z.boolean().default(true),
  ghostThreshold: z.coerce.number().int().min(1).max(10).default(3),
  maxMessagesPerFolder: z.coerce.number().int().min(1).default(5000),
});

export type ImapConfig = z.infer<typeof imapConfigSchema>;

export const imapSecretSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type ImapSecret = z.infer<typeof imapSecretSchema>;

export interface FolderCursor {
  uidValidity: number;
  lastUid: number;
}

export interface ImapCursor {
  folders: Record<string, FolderCursor>;
  lastSyncAt?: string;
}

/**
 * Validates that the host does not resolve to a private/internal IP address
 * unless CONNECTORS_ALLOW_PRIVATE_HOSTS is enabled.
 */
export async function assertSafeImapHost(host: string): Promise<string> {
  const cleanHost = host
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();

  if (process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true") {
    return cleanHost || host;
  }

  if (net.isIP(cleanHost)) {
    if (isPrivateAddress(cleanHost)) {
      throw new ConnectorConfigError(
        `Host '${host}' is a private or loopback IP address`,
      );
    }
    return cleanHost;
  }

  if (cleanHost === "localhost" || cleanHost.endsWith(".localhost")) {
    throw new ConnectorConfigError(`Host '${host}' is a localhost address`);
  }

  try {
    const addresses = await dns.lookup(cleanHost, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new ConnectorConfigError(`Cannot resolve host: ${host}`);
    }
    for (const addr of addresses) {
      if (isPrivateAddress(addr.address)) {
        throw new ConnectorConfigError(
          `Host '${host}' resolves to private IP: ${addr.address}`,
        );
      }
    }
    return addresses[0].address;
  } catch (err: unknown) {
    if (err instanceof ConnectorConfigError) throw err;
    throw new ConnectorConfigError(
      `DNS lookup failed for host '${host}': ${(err as Error).message}`,
    );
  }
}

/**
 * Create and configure an ImapFlow client.
 *
 * After connect, ImapFlow reports a dropped or reset socket as an `error`
 * event. With no listener Node throws it, and the server exits. The listener
 * only logs: the command that was waiting rejects on its own, and the sync
 * fails with that error.
 */
export function createImapClient(
  config: ImapConfig,
  secret: ImapSecret,
  connectHost: string = config.host,
): ImapFlow {
  const cleanServername = config.host.replace(/^\[|\]$/g, "").trim();
  const client = new ImapFlow({
    host: connectHost,
    port: config.port,
    secure: config.secure,
    ...(connectHost !== config.host && !net.isIP(cleanServername)
      ? { tls: { servername: cleanServername } }
      : {}),
    auth: {
      user: config.username,
      pass: secret.password,
    },
    logger: false,
    emitLogs: false,
  });
  client.on("error", (err: NodeJS.ErrnoException) => {
    log.warn("Connectors", `IMAP connection error: ${err.code ?? err.message}`);
  });
  return client;
}

/** Messages per FETCH: one round trip each, not one per message. */
const FETCH_BATCH = 200;

/**
 * The most bytes of one body part a summary downloads. The prompt keeps 8,000
 * characters, and an HTML part needs room for its markup.
 */
export const SUMMARY_PART_BYTES = 64 * 1024;

/**
 * The part a summary reads: the first text/plain part that is not an
 * attachment, else the first text/html one. A single-part message is part
 * "1", which ImapFlow reads as the message text. Null when there is none.
 */
export function summaryPart(
  node: MessageStructureObject | undefined,
): { part: string; html: boolean } | null {
  let html: { part: string; html: boolean } | null = null;
  const walk = (
    n: MessageStructureObject,
  ): { part: string; html: boolean } | null => {
    if (n.disposition === "attachment") return null;
    if (n.childNodes?.length) {
      for (const child of n.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    if (n.type === "text/plain") return { part: n.part ?? "1", html: false };
    if (n.type === "text/html" && !html)
      html = { part: n.part ?? "1", html: true };
    return null;
  };
  return node ? (walk(node) ?? html) : null;
}

/** The readable text of one message for a summary, at most SUMMARY_PART_BYTES of it. */
async function summaryText(
  client: ImapFlow,
  uid: number,
  structure: MessageStructureObject | undefined,
): Promise<string> {
  const found = summaryPart(structure);
  if (!found) return "";
  const { content } = await client.download(String(uid), found.part, {
    uid: true,
    maxBytes: SUMMARY_PART_BYTES,
  });
  if (!content) return "";
  const body = await text(content);
  return (found.html ? pageText(body) : body.trim()) ?? "";
}

/** RFC 5530 codes that mean "not now", not "wrong password". */
const TEMPORARY_IMAP_CODES = new Set([
  "UNAVAILABLE",
  "INUSE",
  "LIMIT",
  "SERVERBUG",
  "OVERQUOTA",
]);

/**
 * Why the server refused: the credentials, a temporary state, or neither. A
 * response code decides first. Without one, the words do: Gmail sends its
 * connection limit as `NO [ALERT] Too many simultaneous connections`, and
 * imapflow marks every refused LOGIN `authenticationFailed`.
 */
function imapRefusal(err: unknown): "auth" | "temporary" | null {
  if (!err || typeof err !== "object") return null;
  const error = err as {
    authenticationFailed?: boolean;
    responseCode?: string;
    serverResponseCode?: string;
    responseText?: string;
    message?: string;
  };
  const code = (
    error.serverResponseCode ??
    error.responseCode ??
    ""
  ).toUpperCase();
  if (TEMPORARY_IMAP_CODES.has(code)) return "temporary";
  if (code === "AUTHENTICATIONFAILED" || code === "AUTHORIZATIONFAILED") {
    return "auth";
  }
  const msg =
    `${error.message ?? ""} ${error.responseText ?? ""}`.toLowerCase();
  if (
    msg.includes("authentication failed") ||
    msg.includes("invalid credentials") ||
    msg.includes("login failed") ||
    msg.includes("auth error")
  ) {
    return "auth";
  }
  if (/too many (simultaneous )?connections/.test(msg)) return "temporary";
  return error.authenticationFailed ? "auth" : null;
}

function imapErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const error = err as {
    message?: string;
    responseText?: string;
    serverResponseCode?: string;
    responseCode?: string;
  };
  // ImapFlow's own message is often only "Command failed": the server's
  // words, or its response code, say more.
  const detail =
    error.responseText || (error.serverResponseCode ?? error.responseCode);
  if (detail && (!error.message || error.message === "Command failed")) {
    return detail;
  }
  return error.message || "Unknown IMAP error";
}

/** The connector error for a failed connect or login. */
function connectError(err: unknown): ConnectorError {
  const message = imapErrorMessage(err);
  switch (imapRefusal(err)) {
    case "auth":
      return new ConnectorAuthError(`IMAP authentication failed: ${message}`);
    case "temporary":
      return new ConnectorUnavailableError(
        `IMAP server is unavailable for now: ${message}`,
      );
    default:
      return new ConnectorConfigError(
        `Failed to connect to IMAP server: ${message}`,
      );
  }
}

export const imapAdapter: ConnectorAdapter<ImapConfig, ImapSecret> = {
  kind: "imap",
  label: "Mailbox (IMAP)",
  description: "Sync sent and received mail headers from any IMAP account",
  capabilities: {
    schedule: true,
    summaries: true,
  },
  configSchema: imapConfigSchema,
  secretSchema: imapSecretSchema,

  async test(
    config: ImapConfig,
    secret: ImapSecret | null,
  ): Promise<{ ok: true; detail: string }> {
    if (!secret?.password) {
      throw new ConnectorConfigError(
        "Password is required to test IMAP connection",
      );
    }

    const resolvedHost = await assertSafeImapHost(config.host);

    const client = createImapClient(config, secret, resolvedHost);
    try {
      await client.connect();

      const mailboxes = await client.list();
      const folderNames = mailboxes.map((m) => m.path);

      await client.logout();

      return {
        ok: true,
        detail: `Connected successfully. Found ${folderNames.length} folders: ${folderNames.slice(0, 5).join(", ")}${folderNames.length > 5 ? "..." : ""}`,
      };
    } catch (err: unknown) {
      try {
        await client.logout();
      } catch {
        // Ignore logout errors after failure
      }

      throw connectError(err);
    }
  },

  async *sync(
    ctx: SyncContext<ImapConfig, ImapSecret>,
  ): AsyncGenerator<SyncEvent, unknown | null> {
    const { config, secret, signal } = ctx;

    if (!secret?.password) {
      throw new ConnectorAuthError("Missing password for IMAP account");
    }

    const resolvedHost = await assertSafeImapHost(config.host);

    const client = createImapClient(config, secret, resolvedHost);
    // ImapFlow times out a connection, a greeting and five quiet minutes on
    // its own. An abort, at the sync's deadline or at shutdown, closes the
    // socket too, so a command that is still waiting ends at once.
    const closeOnAbort = () => client.close();
    signal.addEventListener("abort", closeOnAbort, { once: true });

    try {
      await client.connect();
    } catch (err: unknown) {
      throw connectError(err);
    }

    try {
      // 1. Determine which folders to sync
      const targetFolders: string[] = [...(config.folders ?? [])];
      const mailboxes = await client.list();

      if (targetFolders.length === 0) {
        // Auto-detect INBOX and Sent
        const inboxBox = mailboxes.find(
          (m) => m.specialUse === "\\Inbox" || m.path.toUpperCase() === "INBOX",
        );
        const sentBox = mailboxes.find(
          (m) =>
            m.specialUse === "\\Sent" ||
            /^sent(\s*items|\s*messages)?$/i.test(m.path) ||
            m.path.toUpperCase().includes("SENT"),
        );

        if (inboxBox) targetFolders.push(inboxBox.path);
        else targetFolders.push("INBOX");

        if (sentBox && sentBox.path !== targetFolders[0]) {
          targetFolders.push(sentBox.path);
        }
      }

      // 2. Initialize cursor
      const cursor: ImapCursor =
        ctx.cursor && typeof ctx.cursor === "object" && "folders" in ctx.cursor
          ? (ctx.cursor as unknown as ImapCursor)
          : { folders: {} };

      const updatedFolders: Record<string, FolderCursor> = {
        ...cursor.folders,
      };
      const selfEmails = [
        config.username,
        ...(config.aliases || []),
        ...(ctx.selfAddresses.emails || []),
      ];

      const maxPerFolder = config.maxMessagesPerFolder ?? 5000;
      let totalFetched = 0;
      let summaryCount = 0;
      let foldersSucceeded = 0;
      let foldersFailed = 0;
      let firstFolderError: Error | null = null;
      // A mail in two folders, such as one sent to oneself, is yielded once a
      // run: a second copy would count its strangers twice and summarize it
      // twice before ingest saw that the id was known.
      const seenMessageIds = new Set<string>();

      for (const folder of targetFolders) {
        signal.throwIfAborted();

        let lock;
        try {
          lock = await client.getMailboxLock(folder);
        } catch (err) {
          signal.throwIfAborted();
          if (imapRefusal(err) === "auth") {
            throw new ConnectorAuthError(
              `IMAP authentication failed on folder ${folder}: ${imapErrorMessage(err)}`,
            );
          }
          foldersFailed++;
          firstFolderError ??= err as Error;
          ctx.log(`Could not open folder ${folder}: ${imapErrorMessage(err)}`);
          continue;
        }

        try {
          if (!client.mailbox) {
            ctx.log(`Mailbox ${folder} is not open`);
            continue;
          }
          const currentUidValidity = Number(client.mailbox.uidValidity);
          const prevFolderCursor = updatedFolders[folder];
          let lastUid = 0;

          if (
            prevFolderCursor &&
            prevFolderCursor.uidValidity === currentUidValidity
          ) {
            lastUid = prevFolderCursor.lastUid;
          }

          let uids: number[] = [];

          if (lastUid > 0) {
            // Search for messages with UID greater than lastUid
            const searchRange = `${lastUid + 1}:*`;
            const foundUids = await client.search(
              { uid: searchRange },
              { uid: true },
            );
            if (foundUids && Array.isArray(foundUids)) {
              uids = foundUids.filter((u) => u > lastUid);
            }
          } else {
            // A folder with no cursor, on the first run or added later, reads
            // the whole lookback window. (`ctx.since` is the last sync once
            // there was one, which gave a folder added later a day of mail.)
            const sinceDate = new Date(
              Date.now() - (config.lookbackDays ?? 90) * 24 * 60 * 60 * 1000,
            );
            const foundUids = await client.search(
              { since: sinceDate },
              { uid: true },
            );
            if (foundUids && Array.isArray(foundUids)) {
              uids = foundUids;
            }
          }

          uids.sort((a, b) => a - b);
          if (uids.length > maxPerFolder) {
            uids = uids.slice(0, maxPerFolder);
          }

          let highestUid = lastUid;

          // One FETCH per batch. A body is downloaded only after its batch has
          // arrived: ImapFlow cannot run a command inside a running FETCH.
          const messages = async function* () {
            for (let i = 0; i < uids.length; i += FETCH_BATCH) {
              signal.throwIfAborted();
              const batch = await client.fetchAll(
                uids.slice(i, i + FETCH_BATCH).join(","),
                {
                  envelope: true,
                  internalDate: true,
                  uid: true,
                  bodyStructure: true,
                },
                { uid: true },
              );
              yield* batch.sort((a, b) => a.uid - b.uid);
            }
          };

          for await (const message of messages()) {
            signal.throwIfAborted();
            const uid = message.uid;
            if (!message.envelope) continue;

            if (uid > highestUid) {
              highestUid = uid;
            }

            const rawFrom = message.envelope.from?.map((f) => ({
              name: f.name || undefined,
              address: f.address || undefined,
            }));
            const rawTo = message.envelope.to?.map((t) => ({
              name: t.name || undefined,
              address: t.address || undefined,
            }));
            const rawCc = message.envelope.cc?.map((c) => ({
              name: c.name || undefined,
              address: c.address || undefined,
            }));

            const norm = normalizeEmail(
              {
                externalId: message.envelope.messageId || `${folder}:${uid}`,
                messageId: message.envelope.messageId,
                inReplyTo: message.envelope.inReplyTo,
                date: mailDate(message.envelope.date, message.internalDate),
                subject: message.envelope.subject,
                from: rawFrom,
                to: rawTo,
                cc: rawCc,
              },
              { selfEmails, includeBody: false },
            );
            if (norm.messageId) {
              if (seenMessageIds.has(norm.messageId)) continue;
              seenMessageIds.add(norm.messageId);
            }

            // Determine whether any counterparty matches a known contact
            let matchesContact = false;
            if (ctx.isContactParticipant) {
              const counterparties =
                norm.direction === "in" ? norm.from : [...norm.to, ...norm.cc];
              matchesContact = counterparties.some((p) =>
                ctx.isContactParticipant ? ctx.isContactParticipant(p) : false,
              );
            }

            let summaryContent: string | undefined;

            // Fetch body and summarize only if summaries enabled, matched
            // contact, under cap, and AI on for the instance and the owner
            if (
              config.summaries &&
              matchesContact &&
              summaryCount < MAX_SUMMARIES_PER_RUN &&
              summariesAllowed(ctx.accountId)
            ) {
              try {
                const bodyText = await summaryText(
                  client,
                  uid,
                  message.bodyStructure,
                );
                if (bodyText) {
                  const summary = await summarizeEmail(norm.subject, bodyText, {
                    signal: ctx.signal,
                    accountId: ctx.accountId,
                  });
                  if (summary) {
                    summaryContent = summary;
                    summaryCount++;
                  }
                }
              } catch (downloadErr) {
                ctx.log(
                  `Could not download/summarize message ${uid}: ${(downloadErr as Error).message}`,
                );
              }
            }

            // One interaction per message, whatever folders hold it: keyed by
            // its Message-ID, else by folder and UID. The id with the folder
            // in it, which earlier versions gave, made a mail in INBOX and
            // Sent two interactions.
            yield {
              kind: "interaction",
              externalId: norm.messageId
                ? `imap:${norm.messageId}`
                : `imap:${folder}:${uid}`,
              // Earlier versions keyed it by folder: list every synced folder's
              // id, so the link from whichever folder held it first is found.
              legacyExternalIds: norm.messageId
                ? targetFolders.map((f) => `imap:${f}:${norm.externalId}`)
                : [`imap:${folder}:${norm.externalId}`],
              type: "email",
              title: norm.title,
              content: summaryContent,
              date: norm.date,
              direction: norm.direction,
              participants: norm.participants,
              raw: { folder, uid, messageId: norm.messageId },
            };

            totalFetched++;
            if (totalFetched % 50 === 0) {
              yield { kind: "progress", fetched: totalFetched };
            }
          }

          updatedFolders[folder] = {
            uidValidity: currentUidValidity,
            lastUid: highestUid,
          };
          foldersSucceeded++;
        } finally {
          lock.release();
        }
      }

      if (foldersFailed > 0 && foldersSucceeded === 0 && firstFolderError) {
        throw new ConnectorConfigError(
          `Could not open any configured IMAP folder: ${imapErrorMessage(firstFolderError)}`,
        );
      }

      yield {
        kind: "progress",
        fetched: totalFetched,
        message: `Fetched ${totalFetched} emails across ${targetFolders.length} folders`,
      };

      return {
        folders: updatedFolders,
        lastSyncAt:
          foldersFailed === 0 ? new Date().toISOString() : cursor.lastSyncAt,
      };
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
      // On a closed socket (an abort, a dropped connection) logout throws, and
      // a throw here would replace the error that ended the sync.
      await client.logout().catch(() => client.close());
    }
  },
};
