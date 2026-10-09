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
import { ConnectorAuthError, ConnectorConfigError } from "../errors.ts";
import { normalizeEmail } from "../email/normalize.ts";
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
export async function assertSafeImapHost(host: string): Promise<void> {
  if (process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS === "true") {
    return;
  }

  const cleanHost = host
    .replace(/^\[|\]$/g, "")
    .trim()
    .toLowerCase();

  if (net.isIP(cleanHost)) {
    if (isPrivateAddress(cleanHost)) {
      throw new ConnectorConfigError(
        `Host '${host}' is a private or loopback IP address`,
      );
    }
    return;
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
): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
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

function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const error = err as {
    authenticationFailed?: boolean;
    responseCode?: string;
    message?: string;
  };
  if (error.authenticationFailed) return true;
  if (error.responseCode === "AUTHENTICATIONFAILED") return true;
  const msg = error.message?.toLowerCase() || "";
  return (
    msg.includes("authentication failed") ||
    msg.includes("invalid credentials") ||
    msg.includes("login failed") ||
    msg.includes("auth error")
  );
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

    await assertSafeImapHost(config.host);

    const client = createImapClient(config, secret);
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

      if (isAuthError(err)) {
        throw new ConnectorAuthError(
          `IMAP authentication failed: ${(err as Error).message}`,
        );
      }
      throw new ConnectorConfigError(
        `Failed to connect to IMAP server: ${(err as Error).message}`,
      );
    }
  },

  async *sync(
    ctx: SyncContext<ImapConfig, ImapSecret>,
  ): AsyncGenerator<SyncEvent, unknown | null> {
    const { config, secret, signal } = ctx;

    if (!secret?.password) {
      throw new ConnectorAuthError("Missing password for IMAP account");
    }

    await assertSafeImapHost(config.host);

    const client = createImapClient(config, secret);
    // ImapFlow times out a connection, a greeting and five quiet minutes on
    // its own. An abort, at the sync's deadline or at shutdown, closes the
    // socket too, so a command that is still waiting ends at once.
    const closeOnAbort = () => client.close();
    signal.addEventListener("abort", closeOnAbort, { once: true });

    try {
      await client.connect();
    } catch (err: unknown) {
      if (isAuthError(err)) {
        throw new ConnectorAuthError(
          `IMAP authentication failed: ${(err as Error).message}`,
        );
      }
      throw new ConnectorConfigError(
        `Failed to connect to IMAP server: ${(err as Error).message}`,
      );
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

      for (const folder of targetFolders) {
        signal.throwIfAborted();

        let lock;
        try {
          lock = await client.getMailboxLock(folder);
        } catch (err) {
          ctx.log(`Could not open folder ${folder}: ${(err as Error).message}`);
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
            // Initial sync: fetch since lookback date
            const sinceDate = new Date(ctx.since);
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

            const dateValue = message.envelope.date ?? message.internalDate;
            const norm = normalizeEmail(
              {
                externalId: message.envelope.messageId || `${folder}:${uid}`,
                messageId: message.envelope.messageId,
                inReplyTo: message.envelope.inReplyTo,
                date: dateValue,
                subject: message.envelope.subject,
                from: rawFrom,
                to: rawTo,
                cc: rawCc,
              },
              { selfEmails, includeBody: false },
            );

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

            yield {
              kind: "interaction",
              externalId: `imap:${folder}:${norm.externalId}`,
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
        } finally {
          lock.release();
        }
      }

      yield {
        kind: "progress",
        fetched: totalFetched,
        message: `Fetched ${totalFetched} emails across ${targetFolders.length} folders`,
      };

      return {
        folders: updatedFolders,
        lastSyncAt: new Date().toISOString(),
      };
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
      // On a closed socket (an abort, a dropped connection) logout throws, and
      // a throw here would replace the error that ended the sync.
      await client.logout().catch(() => client.close());
    }
  },
};
