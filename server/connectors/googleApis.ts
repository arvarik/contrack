// The Google REST calls the Google connector makes, and its OAuth client. Each
// call is one GET through the OAuth client's own request(), which adds the
// access token, refreshes it when it has expired, and throws gaxios'
// GaxiosError. The four @googleapis packages sent the same requests through
// googleapis-common. The object keeps the shape of googleapis' `google`
// export, so call sites read the same and a test can replace one API with
// vi.spyOn.

import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

export { CodeChallengeMethod };

/** The options a call takes: its timeout and the sync's signal. */
interface CallOptions {
  timeout?: number;
  signal?: AbortSignal;
}

/**
 * RFC 3986 percent-encoding, which googleapis-common used for the path (by
 * url-template) and the query (by qs): encodeURIComponent, plus !'()*.
 */
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * One GET, with the URL googleapis-common built: the keys in order, an
 * undefined value left out, an array as a repeated key (a=1&a=2). retry: true
 * keeps gaxios' retries of 408, 429, 5xx and lost connections, which
 * googleapis-common turned on. Google compresses an answer only when asked by
 * Accept-Encoding and by "gzip" in the user agent.
 */
function get<T>(
  auth: OAuth2Client,
  url: string,
  query: object,
  options: CallOptions,
) {
  const search = Object.entries(query)
    .flatMap(([key, value]) =>
      value === undefined
        ? []
        : [value].flat().map((v) => `${encode(key)}=${encode(String(v))}`),
    )
    .join("&");
  return auth.request<T>({
    ...options,
    method: "GET",
    url: search ? `${url}?${search}` : url,
    headers: { "Accept-Encoding": "gzip", "User-Agent": "contrack (gzip)" },
    retry: true,
  });
}

// The fields the connector reads from each answer.

type Primary = { metadata?: { primary?: boolean } };

interface Person {
  resourceName?: string;
  metadata?: { deleted?: boolean };
  names?: (Primary & { displayName?: string })[];
  emailAddresses?: (Primary & { value?: string; type?: string })[];
  phoneNumbers?: (Primary & { value?: string; type?: string })[];
  organizations?: (Primary & { name?: string; title?: string })[];
  photos?: (Primary & { url?: string })[];
}

export interface PeopleConnectionsQuery {
  resourceName: string;
  personFields: string;
  pageSize: number;
  pageToken?: string;
  syncToken?: string;
  requestSyncToken?: boolean;
}

export interface GmailMessagePart {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailMessagePart;
}

interface CalendarPerson {
  email?: string;
  displayName?: string;
}

interface CalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  iCalUID?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: (CalendarPerson & {
    self?: boolean;
    resource?: boolean;
    responseStatus?: string;
  })[];
  organizer?: CalendarPerson;
}

export interface CalendarEventsQuery {
  calendarId: string;
  singleEvents: boolean;
  maxResults: number;
  pageToken?: string;
  syncToken?: string;
  timeMin?: string;
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users";

export const google = {
  auth: { OAuth2: OAuth2Client },
  oauth2: (auth: OAuth2Client) => ({
    userinfo: {
      get: (options: CallOptions) =>
        get<{ email?: string }>(
          auth,
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {},
          options,
        ),
    },
  }),
  people: (auth: OAuth2Client) => ({
    people: {
      connections: {
        list: (
          { resourceName, ...query }: PeopleConnectionsQuery,
          options: CallOptions,
        ) =>
          get<{
            connections?: Person[];
            nextPageToken?: string;
            nextSyncToken?: string;
          }>(
            auth,
            `https://people.googleapis.com/v1/${resourceName.split("/").map(encode).join("/")}/connections`,
            query,
            options,
          ),
      },
    },
  }),
  gmail: (auth: OAuth2Client) => ({
    users: {
      getProfile: ({ userId }: { userId: string }, options: CallOptions) =>
        get<{ historyId?: string }>(
          auth,
          `${GMAIL}/${encode(userId)}/profile`,
          {},
          options,
        ),
      history: {
        list: (
          {
            userId,
            ...query
          }: {
            userId: string;
            startHistoryId: string;
            historyTypes: string[];
            pageToken?: string;
          },
          options: CallOptions,
        ) =>
          get<{
            history?: {
              id?: string;
              messagesAdded?: { message?: { id?: string } }[];
            }[];
            nextPageToken?: string;
            historyId?: string;
          }>(auth, `${GMAIL}/${encode(userId)}/history`, query, options),
      },
      messages: {
        list: (
          {
            userId,
            ...query
          }: {
            userId: string;
            q: string;
            maxResults: number;
            pageToken?: string;
          },
          options: CallOptions,
        ) =>
          get<{ messages?: { id?: string }[]; nextPageToken?: string }>(
            auth,
            `${GMAIL}/${encode(userId)}/messages`,
            query,
            options,
          ),
        get: (
          {
            userId,
            id,
            ...query
          }: {
            userId: string;
            id: string;
            format: "metadata" | "full";
            metadataHeaders?: string[];
          },
          options: CallOptions,
        ) =>
          get<GmailMessage>(
            auth,
            `${GMAIL}/${encode(userId)}/messages/${encode(id)}`,
            query,
            options,
          ),
      },
    },
  }),
  calendar: (auth: OAuth2Client) => ({
    events: {
      list: (
        { calendarId, ...query }: CalendarEventsQuery,
        options: CallOptions,
      ) =>
        get<{
          items?: CalendarEvent[];
          nextPageToken?: string;
          nextSyncToken?: string;
        }>(
          auth,
          `https://www.googleapis.com/calendar/v3/calendars/${encode(calendarId)}/events`,
          query,
          options,
        ),
    },
  }),
};
