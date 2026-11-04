/**
 * The Google Workspace connector, with OAuth 2.0 and PKCE. It syncs:
 *   1. Contacts through the People API (connections.list with syncToken)
 *   2. Email through the Gmail API (messages.list / history.list, metadata
 *      headers by default, full bodies only for matched contacts when
 *      summaries are on)
 *   3. Events through the Calendar API (events.list with syncToken for past
 *      meetings, and a window listed in full for upcoming_events and the
 *      meetings that ended since the last run)
 * invalid_grant and 401s become ConnectorAuthError, which sets needs_reauth.
 *
 * @module server/connectors/adapters/google
 */

import {
  google,
  type CalendarEvent,
  type CalendarEventsQuery,
  type GmailMessagePart,
  type PeopleConnectionsQuery,
} from "../googleApis.ts";
import { z } from "zod";
import { ConnectorAuthError, ConnectorConfigError } from "../errors.ts";
import {
  BULK_HEADERS,
  isBulkMail,
  mailDate,
  normalizeEmail,
  organizerIsPerson,
} from "../email/normalize.ts";
import {
  summarizeEmail,
  summariesAllowed,
  MAX_SUMMARIES_PER_RUN,
} from "../summaries.ts";
import { getGoogleOAuthCredentials } from "../../services/integrationSettings.ts";
import { pageText } from "../../services/research/pages.ts";
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
  /**
   * The account's address, from sign-in. The connector is found by it again
   * when its secret cannot be opened, so Reconnect fixes it in place.
   */
  accountEmail: z.string().optional(),
  /**
   * Whether Google granted gmail.readonly, which summaries need to read a
   * body. Undefined for a connector made before this was recorded.
   */
  mailBodies: z.boolean().optional(),
});

export type GoogleConfig = z.infer<typeof googleConfigSchema>;

export const googleSecretSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
  accessToken: z.string().optional(),
  expiryDate: z.number().optional(),
  email: z.string().optional(),
});

export type GoogleSecret = z.infer<typeof googleSecretSchema>;

/**
 * A first Gmail listing that reached the cap: where it started, where it got
 * to, and the mailbox's history id from before it began. The next run lists
 * older mail, and takes that history id when the window is done.
 */
export interface GmailBackfill {
  /** The start of the window, in seconds (Gmail's `after:`). */
  since: number;
  /** The second after the oldest mail fetched so far (Gmail's `before:`). */
  before?: number;
  historyId?: string;
}

/**
 * The fields of every People request. `metadata` carries `deleted`, the only
 * sign of a person removed since the last sync: without it, a deleted person
 * came back with no fields and was skipped as an empty card. A sync token
 * answers for the fields of the request that made it, so the cursor keeps
 * them, and a token made with other fields is dropped for one full pull.
 */
const PERSON_FIELDS =
  "metadata,names,emailAddresses,phoneNumbers,organizations,photos,birthdays,addresses,biographies,urls,memberships";

/** The first entry Google marks primary, else the first entry. */
function primary<T extends { metadata?: { primary?: boolean } }>(
  list: T[] | undefined,
): T | undefined {
  return list?.find((item) => item.metadata?.primary) ?? list?.[0];
}

/**
 * A People birthday as Contrack stores one: "1990-05-14", or "--05-14" when
 * the card has no year. Google's free text when the date has no day.
 */
function birthdayText(birthday?: {
  date?: { year?: number; month?: number; day?: number };
  text?: string;
}): string | undefined {
  const date = birthday?.date;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (date?.month && date.day) {
    const year = date.year ? String(date.year).padStart(4, "0") : "-";
    return `${year}-${pad(date.month)}-${pad(date.day)}`;
  }
  return birthday?.text?.trim() || undefined;
}

export interface GoogleCursor {
  contactsSyncToken?: string;
  /** The `personFields` that `contactsSyncToken` was made with. */
  contactsFields?: string;
  calendarSyncToken?: string;
  /** When the calendar window was last listed in full. */
  calendarListedAt?: string;
  gmailHistoryId?: string;
  gmailBackfill?: GmailBackfill;
  lastSyncAt?: string;
}

/**
 * Mail that is not a conversation: Gmail's spam, its trash and the owner's own
 * drafts. messages.list leaves the first two out by itself, history.list does
 * not, so a sender of spam became a correspondent, and a ghost at three mails.
 */
const SKIPPED_GMAIL_LABELS = new Set(["SPAM", "TRASH", "DRAFT"]);

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
 * A sync token Google no longer takes, which calls for a full sync. Calendar
 * answers 410. People answers 400 with the reason EXPIRED_SYNC_TOKEN, 7 days
 * after the full sync that gave the token: checking only 410 kept a connector
 * that had stopped for a week from ever syncing contacts again.
 */
export function syncTokenExpired(err: unknown): boolean {
  const e = err as {
    code?: number | string;
    status?: number;
    message?: string;
    response?: { status?: number; data?: unknown };
  } | null;
  const status = Number(e?.response?.status ?? e?.status ?? e?.code);
  if (status === 410) return true;
  const said = `${e?.message ?? ""} ${JSON.stringify(e?.response?.data ?? "")}`;
  return (
    status === 400 && /EXPIRED_SYNC_TOKEN|sync token is expired/i.test(said)
  );
}

/** How far ahead the calendar keeps upcoming events. Pulse shows a week. */
const UPCOMING_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Contrack's label for a Google email type. Google's "home" is Contrack's
 * "personal". The repository reads `label`: sent as `type`, every synced
 * address was "personal".
 */
function emailLabel(type: string | undefined): string {
  const t = type?.toLowerCase();
  if (!t || t === "home") return "personal";
  return t === "work" ? "work" : "other";
}

/** Contrack's label for a Google phone type, such as "workMobile". */
function phoneLabel(type: string | undefined): string | undefined {
  const t = type?.toLowerCase();
  if (!t) return undefined;
  if (t === "mobile" || t === "home") return t;
  return t.startsWith("work") ? "work" : "other";
}

/**
 * Gmail's answer to `q` under the gmail.metadata scope, the one a connector
 * holds when AI summaries were off at sign-in: 403 "Metadata scope does not
 * support 'q' parameter". Every first sync of such a connector failed on it.
 */
function queryRefused(err: unknown): boolean {
  const e = err as {
    message?: string;
    response?: { data?: unknown };
  } | null;
  const said = `${e?.message ?? ""} ${JSON.stringify(e?.response?.data ?? "")}`;
  return /does not support 'q'/i.test(said);
}

/**
 * How long one call to Google may take, from request to last byte. gaxios sets
 * no timeout unless asked, so a half-open connection would hold a sync forever,
 * with its scheduler and owner slots taken until a restart. Every call carries
 * this timeout and the sync's signal, and the OAuth client gives the token
 * refresh, which no call site makes itself, the same timeout.
 */
export const GOOGLE_CALL_TIMEOUT_MS = 60_000;

/** The options every Google call takes: the timeout and the sync's signal. */
function callOptions(signal?: AbortSignal) {
  return { timeout: GOOGLE_CALL_TIMEOUT_MS, signal };
}

/**
 * Creates an OAuth2 client configured with instance credentials and user refresh tokens.
 */
export function createOAuth2Client(secret: GoogleSecret) {
  const creds = getGoogleOAuthCredentials();
  if (!creds) {
    throw new ConnectorConfigError("Google OAuth client is not configured");
  }

  const oauth2Client = new google.auth.OAuth2({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    transporterOptions: { timeout: GOOGLE_CALL_TIMEOUT_MS },
  });

  oauth2Client.setCredentials({
    refresh_token: secret.refreshToken,
    access_token: secret.accessToken,
    expiry_date: secret.expiryDate,
  });

  return oauth2Client;
}

/**
 * Recursively extracts plain text body from a Gmail payload. HTML is read as
 * a research page is, so a style sheet or a script is not taken for text.
 */
export function extractGmailBody(
  payload?: GmailMessagePart,
): string | undefined {
  if (!payload) return undefined;
  const decode = (data: string) =>
    Buffer.from(data, "base64url").toString("utf-8");

  // Direct text/plain body
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode(payload.body.data);
  }

  // Multipart parts traversal
  if (payload.parts && payload.parts.length > 0) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decode(part.body.data);
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
        return pageText(decode(part.body.data)) ?? undefined;
      }
    }
  }

  if (payload.mimeType === "text/html" && payload.body?.data) {
    return pageText(decode(payload.body.data)) ?? undefined;
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

  async revoke(secret: GoogleSecret) {
    if (!secret?.refreshToken) return;
    await createOAuth2Client(secret).revokeToken(secret.refreshToken);
  },

  async test(_config: GoogleConfig, secret: GoogleSecret | null) {
    if (!secret?.refreshToken) {
      throw new ConnectorAuthError(
        "Missing refresh token for Google Workspace",
      );
    }

    const auth = createOAuth2Client(secret);

    try {
      // Test credentials by fetching user info
      const res = await google.oauth2(auth).userinfo.get(callOptions());
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

    // A stage that is off forgets its place, so turning it on again is a
    // first sync from the lookback date.
    let contactsSyncToken =
      config.syncContacts !== false && cursor.contactsFields === PERSON_FIELDS
        ? cursor.contactsSyncToken
        : undefined;
    const calendarOn = config.syncCalendar !== false;
    let calendarSyncToken = calendarOn ? cursor.calendarSyncToken : undefined;
    let calendarListedAt = calendarOn ? cursor.calendarListedAt : undefined;
    let gmailHistoryId =
      config.syncEmail !== false ? cursor.gmailHistoryId : undefined;
    const firstSince = ctx.firstSince ?? ctx.since;

    const selfEmails = [
      secret.email || "",
      ...(config.aliases || []),
      ...(ctx.selfAddresses.emails || []),
    ].filter(Boolean);

    let totalFetched = 0;
    let summaryTries = 0;
    let stagesSucceeded = 0;
    let stagesFailed = 0;
    let firstStageError: unknown = null;

    // 1. Contacts (People API)
    if (config.syncContacts !== false) {
      const people = google.people(auth);
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      let labels: Map<string, string> | undefined;
      /**
       * The owner's labels by resource name, read once a card has one. Of the
       * system groups, Google Contacts shows only friends, family and
       * coworkers as labels, so myContacts and starred are left out.
       */
      const labelNames = async () => {
        if (!labels) {
          // ponytail: one page of 1,000 labels. Follow nextPageToken if an
          // owner ever has more.
          const res = await people.contactGroups.list(
            { pageSize: 1000, groupFields: "name,groupType" },
            callOptions(signal),
          );
          labels = new Map();
          for (const group of res.data.contactGroups ?? []) {
            const name = group.formattedName || group.name;
            if (
              group.resourceName &&
              name &&
              (group.groupType === "USER_CONTACT_GROUP" ||
                /^contactGroups\/(friends|family|coworkers)$/.test(
                  group.resourceName,
                ))
            ) {
              labels.set(group.resourceName, name);
            }
          }
        }
        return labels;
      };

      try {
        do {
          signal.throwIfAborted();
          const params: PeopleConnectionsQuery = {
            resourceName: "people/me",
            personFields: PERSON_FIELDS,
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
            res = await people.people.connections.list(
              params,
              callOptions(signal),
            );
          } catch (err: unknown) {
            if (contactsSyncToken && syncTokenExpired(err)) {
              // Sync token expired: reset and perform full pull
              contactsSyncToken = undefined;
              delete params.syncToken;
              delete params.pageToken;
              res = await people.people.connections.list(
                params,
                callOptions(signal),
              );
            } else {
              throw err;
            }
          }

          const connections = res.data.connections || [];
          for (const person of connections) {
            if (!person.resourceName) continue;
            // A delta names a person Google deleted with the flag alone.
            if (person.metadata?.deleted) {
              yield {
                kind: "contact_deleted",
                externalId: person.resourceName,
              };
              continue;
            }
            const primaryName =
              person.names?.find((n) => n.metadata?.primary)?.displayName ||
              person.names?.[0]?.displayName;

            const emails = (person.emailAddresses || [])
              .map((e) => ({
                email: e.value || "",
                label: emailLabel(e.type),
                isPrimary: e.metadata?.primary ?? false,
              }))
              .filter((e) => e.email);

            const phones = (person.phoneNumbers || [])
              .map((p) => ({
                phone: p.value || "",
                label: phoneLabel(p.type),
                isPrimary: p.metadata?.primary ?? false,
              }))
              .filter((p) => p.phone);

            const org =
              person.organizations?.find((o) => o.metadata?.primary) ||
              person.organizations?.[0];
            const photo = primary(person.photos);
            // Google's letter tile for a card with no photo is marked
            // `default`. The URL test is a fallback for a tile without it.
            const placeholder =
              photo?.default || photo?.url?.includes("/default-user");
            // A card with an address and no name is still a person: ingest
            // names it by the address, or keeps the linked contact's name.
            if (!primaryName && emails.length === 0 && phones.length === 0) {
              continue;
            }

            const addresses = (person.addresses ?? [])
              .map((a) => ({
                address: (a.formattedValue ?? "")
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .join(", "),
                label: a.type || "home",
                isPrimary: a.metadata?.primary ?? false,
              }))
              .filter((a) => a.address);
            const urls = (person.urls ?? []).flatMap((u) => {
              const url = u.value?.trim();
              return url ? [{ url, type: u.type }] : [];
            });
            const groups = (person.memberships ?? []).flatMap(
              (m) => m.contactGroupMembership?.contactGroupResourceName ?? [],
            );
            const names = groups.length ? await labelNames() : undefined;
            const tags = groups.flatMap((g) => names?.get(g) ?? []);

            yield {
              kind: "contact",
              externalId: person.resourceName,
              contact: {
                ...(primaryName ? { name: primaryName } : {}),
                emails,
                phones,
                company: org?.name || undefined,
                role: org?.title || undefined,
                birthday: birthdayText(primary(person.birthdays)),
                about: primary(person.biographies)?.value?.trim() || undefined,
                // The first link labeled as a home page or with no label.
                website: urls.find((u) => !u.type || u.type === "homePage")
                  ?.url,
                // Left out when the card has none, so a card without them
                // does not clear the contact's.
                ...(addresses.length ? { addresses } : {}),
                ...(urls.length
                  ? { socialLinks: urls.map(({ url }) => ({ url })) }
                  : {}),
                ...(tags.length ? { tags } : {}),
              },
              photoUrl: photo?.url && !placeholder ? photo.url : undefined,
              defaultPhotoUrl:
                photo?.url && placeholder ? photo.url : undefined,
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
        stagesSucceeded++;
      } catch (err: unknown) {
        signal.throwIfAborted();
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during contacts sync: ${(err as Error).message}`,
          );
        }
        stagesFailed++;
        firstStageError ??= err;
        const message = `Error syncing Google contacts: ${(err as Error).message}`;
        ctx.log(message);
        yield { kind: "stage_failed", message };
      }
    }

    // 2. Email (Gmail API)
    let gmailBackfill =
      config.syncEmail !== false ? cursor.gmailBackfill : undefined;
    if (config.syncEmail !== false) {
      const gmail = google.gmail(auth);
      const maxMessages = config.maxMessagesPerRun ?? 5000;

      /** The mailbox's history id now, or undefined when the call fails. */
      const profileHistoryId = async (): Promise<string | undefined> => {
        try {
          const profile = await gmail.users.getProfile(
            { userId: "me" },
            callOptions(signal),
          );
          return profile.data.historyId || undefined;
        } catch (profileErr) {
          ctx.log(
            `Could not get Gmail profile historyId: ${(profileErr as Error).message}`,
          );
          return undefined;
        }
      };

      /** When Gmail took a message in, in ms, or NaN when the call fails. */
      const internalDateMs = async (id: string): Promise<number> => {
        try {
          const res = await gmail.users.messages.get(
            { userId: "me", id, format: "metadata", metadataHeaders: [] },
            callOptions(signal),
          );
          return Number(res.data.internalDate);
        } catch (err: unknown) {
          signal.throwIfAborted();
          if (isAuthError(err)) throw err;
          return NaN;
        }
      };

      try {
        const messageIds: string[] = [];
        let newHistoryId: string | undefined;
        let nextBackfill: GmailBackfill | undefined;
        /** The listing's bounds in seconds, kept here when `q` cannot be. */
        let dateWindow: { since: number; before?: number } | undefined;

        if (gmailHistoryId) {
          try {
            // Whole records, up to the cap. The cursor moves to the last
            // record taken, so a run that stops at the cap leaves nothing
            // behind: the next one starts right after it. Taking a record's
            // ids and then dropping the ones past the cap lost them for good.
            let pageToken: string | undefined;
            let lastTakenId: string | undefined;
            let left = false;
            do {
              signal.throwIfAborted();
              const res = await gmail.users.history.list(
                {
                  userId: "me",
                  startHistoryId: gmailHistoryId,
                  historyTypes: ["messageAdded"],
                  pageToken,
                },
                callOptions(signal),
              );

              const histories = res.data.history || [];
              let taken = 0;
              for (
                ;
                taken < histories.length && messageIds.length < maxMessages;
                taken++
              ) {
                const h = histories[taken];
                for (const ma of h.messagesAdded || []) {
                  if (ma.message?.id) messageIds.push(ma.message.id);
                }
                if (h.id) lastTakenId = h.id;
              }
              pageToken = res.data.nextPageToken || undefined;
              left =
                taken < histories.length ||
                (Boolean(pageToken) && messageIds.length >= maxMessages);
              if (!left && !pageToken) {
                newHistoryId = res.data.historyId || lastTakenId;
              }
            } while (pageToken && messageIds.length < maxMessages);
            if (left) newHistoryId = lastTakenId ?? gmailHistoryId;
          } catch (err: unknown) {
            const code =
              (err as { code?: number; status?: number })?.code ??
              (err as { code?: number; status?: number })?.status;
            if (code === 404 || code === 410) {
              // History ID expired: fall back to messages.list, which lists
              // the window again, so the pages read so far are dropped.
              gmailHistoryId = undefined;
              messageIds.length = 0;
            } else {
              throw err;
            }
          }
        }

        if (!gmailHistoryId) {
          // A first sync, or one after the history id expired, lists the
          // window newest first. The mailbox's history id is taken before the
          // listing, so a change during it reaches the next run. A run that
          // stops at the cap keeps its place, and the next one lists the mail
          // before the oldest it fetched, until the window is done. Jumping
          // to the history id at once lost the older mail for good.
          const start: GmailBackfill = gmailBackfill ?? {
            since: Math.floor(
              new Date(
                cursor.gmailHistoryId ? ctx.since : firstSince,
              ).getTime() / 1000,
            ),
            historyId: await profileHistoryId(),
          };
          /** One page, by `q` until Google refuses it, then without. */
          const listPage = async (pageToken: string | undefined) => {
            const maxResults = Math.min(100, maxMessages - messageIds.length);
            if (!dateWindow) {
              try {
                return await gmail.users.messages.list(
                  {
                    userId: "me",
                    q: `after:${start.since}${start.before ? ` before:${start.before}` : ""}`,
                    maxResults,
                    pageToken,
                  },
                  callOptions(signal),
                );
              } catch (err: unknown) {
                if (!queryRefused(err)) throw err;
                dateWindow = { since: start.since, before: start.before };
              }
            }
            return gmail.users.messages.list(
              { userId: "me", maxResults, pageToken },
              callOptions(signal),
            );
          };

          let pageToken: string | undefined;
          let done = false;
          do {
            signal.throwIfAborted();
            const res = await listPage(pageToken);
            pageToken = res.data.nextPageToken || undefined;

            let ids = (res.data.messages || []).flatMap((m) =>
              m.id ? [m.id] : [],
            );
            if (dateWindow && ids.length > 0) {
              // Without `q` the list is the whole mailbox, newest first, and
              // the last mail on a page dates it: a page newer than the window
              // is passed over, and the page that reaches past its start is
              // the last. The loop below drops the mail outside it. A backfill
              // bound is the second after the oldest mail already taken, so a
              // page that ends in that second was taken too: counting it
              // filled the cap with known mail, and every other run was lost.
              const last = await internalDateMs(ids[ids.length - 1]);
              if (
                dateWindow.before !== undefined &&
                last >= (dateWindow.before - 1) * 1000
              ) {
                ids = [];
              } else if (last < dateWindow.since * 1000) {
                pageToken = undefined;
              }
            }
            messageIds.push(...ids);
            done = !pageToken;
          } while (pageToken && messageIds.length < maxMessages);

          if (done) newHistoryId = start.historyId;
          else nextBackfill = start;
        }

        let oldestMs = Infinity;
        for (const msgId of [...new Set(messageIds)]) {
          signal.throwIfAborted();

          let meta;
          try {
            meta = await gmail.users.messages.get(
              {
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
                  ...BULK_HEADERS,
                ],
              },
              callOptions(signal),
            );
          } catch (msgErr) {
            // A refused token fails every message: stop the run, so the
            // history id does not move past the whole mailbox.
            signal.throwIfAborted();
            if (isAuthError(msgErr)) throw msgErr;
            ctx.log(
              `Could not fetch metadata for Google message ${msgId}: ${(msgErr as Error).message}`,
            );
            continue;
          }

          if (!meta.data) continue;
          if (meta.data.internalDate) {
            oldestMs = Math.min(oldestMs, Number(meta.data.internalDate));
          }
          if (dateWindow) {
            const ms = Number(meta.data.internalDate);
            if (
              ms < dateWindow.since * 1000 ||
              (dateWindow.before !== undefined &&
                ms >= dateWindow.before * 1000)
            ) {
              continue;
            }
          }
          if (meta.data.labelIds?.some((l) => SKIPPED_GMAIL_LABELS.has(l))) {
            continue;
          }

          const headers = meta.data.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())
              ?.value;

          const norm = normalizeEmail(
            {
              externalId: getHeader("Message-ID") || msgId,
              messageId: getHeader("Message-ID") || undefined,
              inReplyTo: getHeader("In-Reply-To") || undefined,
              date: mailDate(getHeader("Date"), meta.data.internalDate),
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

          // summariesAllowed before the body is fetched: with AI off for
          // the instance or for the owner, the body is not needed at all. A
          // token without gmail.readonly cannot read a body, so none is
          // tried. The cap counts tries: counting only summaries made, a
          // failing body or model let one run try every matching message.
          if (
            config.summaries &&
            config.mailBodies !== false &&
            matchesContact &&
            summaryTries < MAX_SUMMARIES_PER_RUN &&
            summariesAllowed(ctx.accountId)
          ) {
            summaryTries++;
            try {
              const full = await gmail.users.messages.get(
                { userId: "me", id: msgId, format: "full" },
                callOptions(signal),
              );
              const bodyText = extractGmailBody(full.data.payload);
              if (bodyText) {
                const summary = await summarizeEmail(norm.subject, bodyText, {
                  signal: ctx.signal,
                  accountId: ctx.accountId,
                });
                if (summary) summaryContent = summary;
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
            automated: isBulkMail(meta.data.labelIds, getHeader),
            raw: { messageId: msgId, threadId: meta.data.threadId },
          };

          totalFetched++;
          if (totalFetched % 50 === 0) {
            yield { kind: "progress", fetched: totalFetched };
          }
        }

        if (nextBackfill && oldestMs < Infinity) {
          // The second after the oldest mail fetched, but always before the
          // bound this run started from: a cap filled by mail from a single
          // second would give that bound back, and list the same mail forever.
          const after = Math.floor(oldestMs / 1000) + 1;
          const previous = nextBackfill.before;
          nextBackfill = {
            ...nextBackfill,
            before:
              previous === undefined ? after : Math.min(after, previous - 1),
          };
        }
        gmailBackfill = nextBackfill;
        if (newHistoryId) {
          gmailHistoryId = newHistoryId;
        }
        stagesSucceeded++;
      } catch (err: unknown) {
        signal.throwIfAborted();
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during Gmail sync: ${(err as Error).message}`,
          );
        }
        stagesFailed++;
        firstStageError ??= err;
        const message = `Error syncing Gmail: ${(err as Error).message}`;
        ctx.log(message);
        yield { kind: "stage_failed", message };
      }
    }

    // 3. Calendar (Google Calendar API), in two listings. A sync token returns
    // only the events that changed, so an upcoming event that ended unchanged
    // never came back and was never logged, and Google refuses timeMin and
    // timeMax with a token.
    //   a. The token: the changes since the last run, or a full pull that
    //      makes a token. It logs the meetings that ended by `from`, such as
    //      one added after it took place.
    //   b. The window: the events that end after `from` and start in the next
    //      UPCOMING_DAYS, listed in full on every run. It logs the meetings
    //      that ended after `from`, and yields the others as upcoming events,
    //      which replace the connector's rows (`upcoming_listed`). So an event
    //      shows when it enters the window and is logged when it ends, and a
    //      cancelled event, a whole cancelled series or a 410 leaves no row.
    // `from` is when the last window was listed, so each meeting is logged
    // once, by one of the two.
    if (calendarOn) {
      const calendar = google.calendar(auth);
      const now = new Date();
      const from = new Date(
        calendarListedAt ?? (calendarSyncToken ? ctx.since : firstSince),
      );
      const selfSet = new Set(selfEmails.map((e) => e.toLowerCase()));

      /** The meeting or upcoming event a Google event is, and when it ends. */
      const calendarItem = (
        event: CalendarEvent,
      ): { end: Date; sync: SyncEvent } | undefined => {
        // Only meetings: not a birthday, an out of office, a focus time, a
        // working location or an event from Gmail.
        if (!event.id || event.status === "cancelled") return undefined;
        if ((event.eventType ?? "default") !== "default") return undefined;

        const startStr = event.start?.dateTime || event.start?.date;
        const endStr = event.end?.dateTime || event.end?.date;
        if (!startStr) return undefined;

        const startDate = new Date(startStr);
        const endDate = endStr
          ? new Date(endStr)
          : new Date(startDate.getTime() + 60 * 60 * 1000);
        // An all-day event has a day and no time, and is kept as the day
        // (`2026-10-09`), which every reader's calendar reads as that day.
        // Midnight UTC would be the evening before west of UTC.
        const allDay = !event.start?.dateTime;
        const startsAt = allDay ? startStr : startDate.toISOString();
        const endsAt =
          allDay && event.end?.date ? event.end.date : endDate.toISOString();

        // The owner declined: no meeting, and nothing upcoming. A room is no
        // person, and someone who declined was not there.
        if (
          event.attendees?.some(
            (a) => a.self && a.responseStatus === "declined",
          )
        ) {
          return undefined;
        }
        const people = (event.attendees || []).filter(
          (a) => !a.resource && a.responseStatus !== "declined",
        );
        const organizer = event.organizer;
        if (
          organizer &&
          (organizer.email || organizer.displayName) &&
          organizerIsPerson(organizer.email, organizer.displayName) &&
          !people.some((a) => a.email === organizer.email)
        ) {
          people.push(organizer);
        }
        const participants: Participant[] = people
          .map((a) => ({
            email: a.email || undefined,
            name: a.displayName || undefined,
          }))
          .filter((a) => a.email || a.name);

        const externalId = `google:calendar:${event.id}`;
        const title = event.summary?.trim() || "(No title)";

        if (endDate <= now) {
          return {
            end: endDate,
            sync: {
              kind: "interaction",
              externalId,
              type: "meeting",
              title,
              date: startsAt,
              endsAt,
              participants,
              raw: { id: event.id, iCalUID: event.iCalUID },
            },
          };
        }
        // An event of the owner alone, such as a reminder, stays out of Pulse.
        const withOthers = people.some(
          (p) =>
            !p.self &&
            (p.email || p.displayName) &&
            !(p.email && selfSet.has(p.email.toLowerCase())),
        );
        if (!withOthers) return undefined;
        return {
          end: endDate,
          sync: {
            kind: "upcoming",
            externalId,
            title,
            startsAt,
            endsAt,
            participants,
          },
        };
      };

      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;

      try {
        // a. The token.
        do {
          signal.throwIfAborted();
          const params: CalendarEventsQuery = {
            calendarId: "primary",
            singleEvents: true,
            maxResults: 250,
            pageToken,
          };

          if (calendarSyncToken) {
            params.syncToken = calendarSyncToken;
          } else {
            params.timeMin = from.toISOString();
          }

          let res;
          try {
            res = await calendar.events.list(params, callOptions(signal));
          } catch (err: unknown) {
            if (calendarSyncToken && syncTokenExpired(err)) {
              // Sync token expired
              calendarSyncToken = undefined;
              delete params.syncToken;
              delete params.pageToken;
              params.timeMin = from.toISOString();
              res = await calendar.events.list(params, callOptions(signal));
            } else {
              throw err;
            }
          }

          for (const event of res.data.items || []) {
            const item = calendarItem(event);
            if (!item || item.end > from) continue;
            yield item.sync;
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

        // b. The window. It starts a day early, because Google can end an
        // all-day event at midnight in the calendar's time zone, up to 14
        // hours before the midnight UTC that `calendarItem` uses.
        do {
          signal.throwIfAborted();
          const res = await calendar.events.list(
            {
              calendarId: "primary",
              singleEvents: true,
              maxResults: 250,
              pageToken,
              timeMin: new Date(from.getTime() - DAY_MS).toISOString(),
              timeMax: new Date(
                now.getTime() + UPCOMING_DAYS * DAY_MS,
              ).toISOString(),
            },
            callOptions(signal),
          );
          for (const event of res.data.items || []) {
            const item = calendarItem(event);
            if (!item || item.end <= from) continue;
            yield item.sync;
            totalFetched++;
            if (totalFetched % 50 === 0) {
              yield { kind: "progress", fetched: totalFetched };
            }
          }
          pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
        calendarListedAt = now.toISOString();
        yield { kind: "upcoming_listed" };
        stagesSucceeded++;
      } catch (err: unknown) {
        signal.throwIfAborted();
        if (isAuthError(err)) {
          throw new ConnectorAuthError(
            `Google authentication failed during Calendar sync: ${(err as Error).message}`,
          );
        }
        stagesFailed++;
        firstStageError ??= err;
        const message = `Error syncing Google Calendar: ${(err as Error).message}`;
        ctx.log(message);
        yield { kind: "stage_failed", message };
      }
    }

    if (stagesFailed > 0 && stagesSucceeded === 0 && firstStageError) {
      throw firstStageError;
    }

    return {
      contactsSyncToken,
      contactsFields: PERSON_FIELDS,
      calendarSyncToken,
      calendarListedAt,
      gmailHistoryId,
      gmailBackfill,
      lastSyncAt:
        stagesFailed === 0 ? new Date().toISOString() : cursor.lastSyncAt,
    };
  },
};
