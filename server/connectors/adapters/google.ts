/**
 * server/connectors/adapters/google.ts — Google Workspace connector adapter.
 *
 * Connects to Google Workspace / Gmail using OAuth 2.0 with PKCE.
 * Syncs:
 *   1. Contacts via Google People API (connections.list with syncToken)
 *   2. Emails via Gmail API (messages.list / history.list, metadata headers by default,
 *      full bodies only for matched contacts when summaries are enabled)
 *   3. Events via Google Calendar API (events.list with syncToken, meetings for past,
 *      upcoming_events for future)
 *
 * Maps invalid_grant and 401s to ConnectorAuthError to trigger needs_reauth.
 *
 * @module server/connectors/adapters/google
 */

import {
  google,
  type gmail_v1,
  type people_v1,
  type calendar_v3,
} from "googleapis";
import { z } from "zod";
import { ConnectorAuthError, ConnectorConfigError } from "../errors.ts";
import { normalizeEmail } from "../email/normalize.ts";
import { summarizeEmail, MAX_SUMMARIES_PER_RUN } from "../summaries.ts";
import { getGoogleOAuthCredentials } from "../../services/integrationSettings.ts";
import type {
  ConnectorAdapter,
  Participant,
  SyncContext,
  SyncEvent,
} from "../types.ts";

export const googleConfigSchema = z.object({
  syncContacts: z.boolean().default(true),
  syncEmail: z.boolean().default(true),
  syncCalendar: z.boolean().default(true),
  summaries: z.boolean().default(false),
  lookbackDays: z.coerce.number().int().min(1).max(365).default(90),
  rollup: z.boolean().default(true),
  ghostThreshold: z.coerce.number().int().min(1).max(10).default(3),
  maxMessagesPerRun: z.coerce.number().int().min(1).default(5000),
  aliases: z.array(z.string()).default([]),
});

export type GoogleConfig = z.infer<typeof googleConfigSchema>;

export const googleSecretSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
  accessToken: z.string().optional(),
  expiryDate: z.number().optional(),
  email: z.string().optional(),
});

export type GoogleSecret = z.infer<typeof googleSecretSchema>;

export interface GoogleCursor {
  contactsSyncToken?: string;
  calendarSyncToken?: string;
  gmailHistoryId?: string;
  lastSyncAt?: string;
}

export function isAuthError(err: unknown): boolean {
  if (err instanceof ConnectorAuthError) return true;
  const msg = ((err as Error)?.message || "").toLowerCase();
  const rec = err as
    | {
        status?: number;
        code?: number | string;
        response?: { status?: number };
      }
    | null
    | undefined;
  const status = rec?.status || rec?.code || rec?.response?.status;

  return (
    status === 401 ||
    msg.includes("invalid_grant") ||
    msg.includes("invalid_token") ||
    msg.includes("unauthorized") ||
    msg.includes("token has been expired or revoked")
  );
}

/**
 * Creates an OAuth2 client configured with instance credentials and user refresh tokens.
 */
export function createOAuth2Client(secret: GoogleSecret) {
  const creds = getGoogleOAuthCredentials();
  if (!creds) {
    throw new ConnectorConfigError("Google OAuth client is not configured");
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
  );

  oauth2Client.setCredentials({
    refresh_token: secret.refreshToken,
    access_token: secret.accessToken,
    expiry_date: secret.expiryDate,
  });

  return oauth2Client;
}

/**
 * Recursively extracts plain text body from a Gmail payload.
 */
export function extractGmailBody(
  payload?: gmail_v1.Schema$MessagePart,
): string | undefined {
  if (!payload) return undefined;

  // Direct text/plain body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }

  // Multipart parts traversal
  if (payload.parts && payload.parts.length > 0) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    // Search sub-parts recursively
    for (const part of payload.parts) {
      const sub = extractGmailBody(part);
      if (sub) return sub;
    }
    // Fallback to text/html stripped of tags if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        return html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    const html = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return undefined;
}

export const googleAdapter: ConnectorAdapter<GoogleConfig, GoogleSecret> = {
  kind: "google",
  label: "Google Workspace",
  description: "Sync contacts, mail and calendar with Google",
  capabilities: {
    schedule: true,
    oauth: true,
    summaries: true,
  },
  configSchema: googleConfigSchema,
  secretSchema: googleSecretSchema,

  async test(_config: GoogleConfig, secret: GoogleSecret | null) {
    if (!secret?.refreshToken) {
      throw new ConnectorAuthError(
        "Missing refresh token for Google Workspace",
      );
    }

    const auth = createOAuth2Client(secret);

    try {
      // Test credentials by fetching user info
      const oauth2 = google.oauth2({ version: "v2", auth });
      const res = await oauth2.userinfo.get();
      const email = res.data.email || secret.email || "user";
      return {
        ok: true as const,
        detail: `Connected to Google Workspace as ${email}`,
      };
    } catch (err: unknown) {
      if (isAuthError(err)) {
        throw new ConnectorAuthError(
          `Google authentication failed: ${(err as Error).message}`,
        );
      }
      throw new ConnectorConfigError(
        `Failed to connect to Google Workspace: ${(err as Error).message}`,
      );
    }
  },

  async *sync(
    ctx: SyncContext<GoogleConfig, GoogleSecret>,
  ): AsyncGenerator<SyncEvent, unknown | null> {
    const { config, secret, signal } = ctx;

    if (!secret?.refreshToken) {
      throw new ConnectorAuthError(
        "Missing refresh token for Google Workspace",
      );
    }

    const auth = createOAuth2Client(secret);

    const cursor: GoogleCursor =
      ctx.cursor && typeof ctx.cursor === "object"
        ? (ctx.cursor as GoogleCursor)
        : {};

    let contactsSyncToken = cursor.contactsSyncToken;
    let calendarSyncToken = cursor.calendarSyncToken;
    let gmailHistoryId = cursor.gmailHistoryId;

    const selfEmails = [
      secret.email || "",
      ...(config.aliases || []),
      ...(ctx.selfAddresses.emails || []),
    ].filter(Boolean);

    let totalFetched = 0;
    let summaryCount = 0;

    // ─── 1. Contacts (People API) ──────────────────────────────────────────
    if (config.syncContacts !== false) {
      const people = google.people({ version: "v1", auth });
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      try {
        do {
          signal.throwIfAborted();
          const params: people_v1.Params$Resource$People$Connections$List = {
            resourceName: "people/me",
            personFields:
              "names,emailAddresses,phoneNumbers,organizations,photos",
            pageSize: 100,
            pageToken,
          };

          if (contactsSyncToken) {
            params.syncToken = contactsSyncToken;
            params.requestSyncToken = true;
          } else {
            params.requestSyncToken = true;
          }

          let res;
          try {
            res = await people.people.connections.list(params);
          } catch (err: unknown) {
            const code =
              (err as { code?: number; status?: number })?.code ??
              (err as { code?: number; status?: number })?.status;
            if (code === 410) {
              // Sync token expired: reset and perform full pull
              contactsSyncToken = undefined;
              delete params.syncToken;
              res = await people.people.connections.list(params);
            } else {
              throw err;
            }
          }

          const connections = res.data.connections || [];
          for (const person of connections) {
            if (!person.resourceName) continue;
            const primaryName =
              person.names?.find((n) => n.metadata?.primary)?.displayName ||
              person.names?.[0]?.displayName;
            if (!primaryName) continue;

            const emails = (person.emailAddresses || [])
              .map((e) => ({
                email: e.value || "",
                type: e.type || "other",
                isPrimary: e.metadata?.primary ?? false,
              }))
              .filter((e) => e.email);

            const phones = (person.phoneNumbers || [])
              .map((p) => ({
                phone: p.value || "",
                type: p.type || "other",
                isPrimary: p.metadata?.primary ?? false,
              }))
              .filter((p) => p.phone);

            const org =
              person.organizations?.find((o) => o.metadata?.primary) ||
              person.organizations?.[0];
            const photoUrl =
              person.photos?.find((p) => p.metadata?.primary)?.url ||
              person.photos?.[0]?.url;

            yield {
              kind: "contact",
              externalId: person.resourceName,
              contact: {
                name: primaryName,
                emails,
                phones,
                company: org?.name || undefined,
                role: org?.title || undefined,
              },
              photoUrl:
                photoUrl && !photoUrl.includes("/default-user")
                  ? photoUrl
                  : undefined,
            };

            totalFetched++;
            if (totalFetched % 50 === 0) {
              yield { kind: "progress", fetched: totalFetched };
            }
          }

          pageToken = res.data.nextPageToken || undefined;
          if (res.data.nextSyncToken) {
            nextSyncToken = res.data.nextSyncToken;
          }
        } while (pageToken);

        if (nextSyncToken) {
          contactsSyncToken = nextSyncToken;
        }
      } catch (err: unknown) {
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during contacts sync: ${(err as Error).message}`,
          );
        }
        ctx.log(`Error syncing Google contacts: ${(err as Error).message}`);
      }
    }

    // ─── 2. Email (Gmail API) ──────────────────────────────────────────────
    if (config.syncEmail !== false) {
      const gmail = google.gmail({ version: "v1", auth });
      const maxMessages = config.maxMessagesPerRun ?? 5000;

      try {
        let messageIds: string[] = [];
        let newHistoryId: string | undefined;

        if (gmailHistoryId) {
          try {
            let pageToken: string | undefined;
            do {
              signal.throwIfAborted();
              const res = await gmail.users.history.list({
                userId: "me",
                startHistoryId: gmailHistoryId,
                historyTypes: ["messageAdded"],
                pageToken,
              });

              const histories = res.data.history || [];
              for (const h of histories) {
                if (h.messagesAdded) {
                  for (const ma of h.messagesAdded) {
                    if (ma.message?.id) messageIds.push(ma.message.id);
                  }
                }
              }
              if (res.data.historyId) newHistoryId = res.data.historyId;
              pageToken = res.data.nextPageToken || undefined;
            } while (pageToken && messageIds.length < maxMessages);
          } catch (err: unknown) {
            const code =
              (err as { code?: number; status?: number })?.code ??
              (err as { code?: number; status?: number })?.status;
            if (code === 404) {
              // History ID expired: fall back to messages.list
              gmailHistoryId = undefined;
            } else {
              throw err;
            }
          }
        }

        if (!gmailHistoryId) {
          const sinceSeconds = Math.floor(new Date(ctx.since).getTime() / 1000);
          let pageToken: string | undefined;
          do {
            signal.throwIfAborted();
            const res = await gmail.users.messages.list({
              userId: "me",
              q: `after:${sinceSeconds}`,
              maxResults: Math.min(100, maxMessages - messageIds.length),
              pageToken,
            });

            const msgs = res.data.messages || [];
            for (const m of msgs) {
              if (m.id) messageIds.push(m.id);
            }
            pageToken = res.data.nextPageToken || undefined;
          } while (pageToken && messageIds.length < maxMessages);

          try {
            const profile = await gmail.users.getProfile({ userId: "me" });
            if (profile.data.historyId) {
              newHistoryId = profile.data.historyId;
            }
          } catch (profileErr) {
            ctx.log(
              `Could not get Gmail profile historyId: ${(profileErr as Error).message}`,
            );
          }
        }

        // Deduplicate message IDs
        messageIds = [...new Set(messageIds)];
        if (messageIds.length > maxMessages) {
          messageIds = messageIds.slice(0, maxMessages);
        }

        for (const msgId of messageIds) {
          signal.throwIfAborted();

          let meta;
          try {
            meta = await gmail.users.messages.get({
              userId: "me",
              id: msgId,
              format: "metadata",
              metadataHeaders: [
                "From",
                "To",
                "Cc",
                "Subject",
                "Date",
                "Message-ID",
                "In-Reply-To",
              ],
            });
          } catch (msgErr) {
            ctx.log(
              `Could not fetch metadata for Google message ${msgId}: ${(msgErr as Error).message}`,
            );
            continue;
          }

          if (!meta.data) continue;

          const headers = meta.data.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
              ?.value;

          const dateStr =
            getHeader("Date") ||
            (meta.data.internalDate
              ? new Date(Number(meta.data.internalDate)).toISOString()
              : new Date().toISOString());

          const norm = normalizeEmail(
            {
              externalId: getHeader("Message-ID") || msgId,
              messageId: getHeader("Message-ID") || undefined,
              inReplyTo: getHeader("In-Reply-To") || undefined,
              date: dateStr,
              subject: getHeader("Subject") || "",
              from: getHeader("From") || "",
              to: getHeader("To") || "",
              cc: getHeader("Cc") || "",
            },
            { selfEmails, includeBody: false },
          );

          let matchesContact = false;
          if (ctx.isContactParticipant) {
            const counterparties =
              norm.direction === "in" ? norm.from : [...norm.to, ...norm.cc];
            matchesContact = counterparties.some((p) =>
              ctx.isContactParticipant ? ctx.isContactParticipant(p) : false,
            );
          }

          let summaryContent: string | undefined;

          if (
            config.summaries &&
            matchesContact &&
            summaryCount < MAX_SUMMARIES_PER_RUN
          ) {
            try {
              const full = await gmail.users.messages.get({
                userId: "me",
                id: msgId,
                format: "full",
              });
              const bodyText = extractGmailBody(full.data.payload);
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
            } catch (bodyErr) {
              ctx.log(
                `Could not fetch body/summary for Google message ${msgId}: ${(bodyErr as Error).message}`,
              );
            }
          }

          yield {
            kind: "interaction",
            externalId: `google:gmail:${norm.externalId}`,
            type: "email",
            title: norm.title,
            content: summaryContent,
            date: norm.date,
            direction: norm.direction,
            participants: norm.participants,
            raw: { messageId: msgId, threadId: meta.data.threadId },
          };

          totalFetched++;
          if (totalFetched % 50 === 0) {
            yield { kind: "progress", fetched: totalFetched };
          }
        }

        if (newHistoryId) {
          gmailHistoryId = newHistoryId;
        }
      } catch (err: unknown) {
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during Gmail sync: ${(err as Error).message}`,
          );
        }
        ctx.log(`Error syncing Gmail: ${(err as Error).message}`);
      }
    }

    // ─── 3. Calendar (Google Calendar API) ─────────────────────────────────
    if (config.syncCalendar !== false) {
      const calendar = google.calendar({ version: "v3", auth });
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      try {
        do {
          signal.throwIfAborted();
          const params: calendar_v3.Params$Resource$Events$List = {
            calendarId: "primary",
            singleEvents: true,
            maxResults: 250,
            pageToken,
          };

          if (calendarSyncToken) {
            params.syncToken = calendarSyncToken;
          } else {
            params.timeMin = new Date(ctx.since).toISOString();
          }

          let res;
          try {
            res = await calendar.events.list(params);
          } catch (err: unknown) {
            const code =
              (err as { code?: number; status?: number })?.code ??
              (err as { code?: number; status?: number })?.status;
            if (code === 410) {
              // Sync token expired
              calendarSyncToken = undefined;
              delete params.syncToken;
              params.timeMin = new Date(ctx.since).toISOString();
              res = await calendar.events.list(params);
            } else {
              throw err;
            }
          }

          const items = res.data.items || [];
          const now = new Date();

          for (const event of items) {
            if (!event.id || event.status === "cancelled") continue;

            const startStr = event.start?.dateTime || event.start?.date;
            const endStr = event.end?.dateTime || event.end?.date;
            if (!startStr) continue;

            const startDate = new Date(startStr);
            const endDate = endStr
              ? new Date(endStr)
              : new Date(startDate.getTime() + 60 * 60 * 1000);

            const attendees: Participant[] = (event.attendees || [])
              .map((a) => ({
                email: a.email || undefined,
                name: a.displayName || undefined,
              }))
              .filter((a) => a.email || a.name);

            if (
              event.organizer &&
              (event.organizer.email || event.organizer.displayName)
            ) {
              if (!attendees.some((a) => a.email === event.organizer?.email)) {
                attendees.push({
                  email: event.organizer.email || undefined,
                  name: event.organizer.displayName || undefined,
                });
              }
            }

            const title = event.summary?.trim() || "(No title)";

            if (endDate < now) {
              yield {
                kind: "interaction",
                externalId: `google:calendar:${event.id}`,
                type: "meeting",
                title,
                date: startDate.toISOString(),
                endsAt: endDate.toISOString(),
                participants: attendees,
                raw: { id: event.id, iCalUID: event.iCalUID },
              };
            } else {
              yield {
                kind: "upcoming",
                externalId: `google:calendar:${event.id}`,
                title,
                startsAt: startDate.toISOString(),
                endsAt: endDate.toISOString(),
                participants: attendees,
              };
            }

            totalFetched++;
            if (totalFetched % 50 === 0) {
              yield { kind: "progress", fetched: totalFetched };
            }
          }

          pageToken = res.data.nextPageToken || undefined;
          if (res.data.nextSyncToken) {
            nextSyncToken = res.data.nextSyncToken;
          }
        } while (pageToken);

        if (nextSyncToken) {
          calendarSyncToken = nextSyncToken;
        }
      } catch (err: unknown) {
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during Calendar sync: ${(err as Error).message}`,
          );
        }
        ctx.log(`Error syncing Google Calendar: ${(err as Error).message}`);
      }
    }

    return {
      contactsSyncToken,
      calendarSyncToken,
      gmailHistoryId,
      lastSyncAt: new Date().toISOString(),
    };
  },
};
