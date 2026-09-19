/**
 * server/connectors/adapters/imap.ts — IMAP email connector adapter.
 *
 * Connects to any standard IMAP server (Gmail, Fastmail, iCloud, Dovecot, etc.)
 * using app passwords. Pulls message headers, normalizes them into interactions,
 * and optionally fetches bodies to generate AI summaries for matched contacts.
 *
 * @module server/connectors/adapters/imap
 */

import net from "node:net";
import dns from "node:dns/promises";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { z } from "zod";
import { isPrivateAddress } from "../../utils/urlSafety.ts";
import { ConnectorAuthError, ConnectorConfigError } from "../errors.ts";
import { normalizeEmail } from "../email/normalize.ts";
import { summarizeEmail, MAX_SUMMARIES_PER_RUN } from "../summaries.ts";
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
 */
export function createImapClient(
  config: ImapConfig,
  secret: ImapSecret,
): ImapFlow {
  return new ImapFlow({
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
  description: "Sync sent and received mail headers from any IMAP account.",
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

          for (const uid of uids) {
            signal.throwIfAborted();

            const message = await client.fetchOne(
              String(uid),
              {
                envelope: true,
                internalDate: true,
                uid: true,
                bodyStructure: true,
              },
              { uid: true },
            );

            if (!message || !message.envelope) continue;

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

            // Fetch body and summarize only if summaries enabled, matched contact, and under cap
            if (
              config.summaries &&
              matchesContact &&
              summaryCount < MAX_SUMMARIES_PER_RUN
            ) {
              try {
                const downloadResult = await client.download(
                  String(uid),
                  undefined,
                  {
                    uid: true,
                  },
                );
                if (downloadResult?.content) {
                  const parsed = await simpleParser(downloadResult.content);
                  const bodyText = parsed.text || "";
                  if (bodyText) {
                    const summary = await summarizeEmail(
                      norm.subject,
                      bodyText,
                      { signal: ctx.signal, accountId: ctx.accountId },
                    );
                    if (summary) {
                      summaryContent = summary;
                      summaryCount++;
                    }
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
      await client.logout();
    }
  },
};
