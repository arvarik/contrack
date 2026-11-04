/**
 * The Google connector: its OAuth settings and sign-in routes, and its sync
 * with each Google API call mocked. Google cannot run in the connector lab,
 * so this file is the only automated proof of the Google stages.
 */

import crypto from "node:crypto";
import type http from "node:http";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { google } from "../../server/connectors/googleApis.ts";
import { makeTestApp } from "./helpers.ts";
import { createActor, resetAccounts, type Actor } from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  GOOGLE_CALL_TIMEOUT_MS,
  googleAdapter,
} from "../../server/connectors/adapters/google.ts";
import {
  setGoogleOAuthCredentials,
  getGoogleOAuthCredentials,
} from "../../server/services/integrationSettings.ts";
import { listConnectors } from "../../server/connectors/service.ts";
import { ConnectorAuthError } from "../../server/connectors/errors.ts";
import * as secretBox from "../../server/utils/secretBox.ts";
import * as gateway from "../../server/ai/gateway.ts";
import type { SyncEvent } from "../../server/connectors/types.ts";

/** The People fields the adapter asks for. `metadata` carries `deleted`. */
const PERSON_FIELDS =
  "metadata,names,emailAddresses,phoneNumbers,organizations,photos,birthdays,addresses,biographies,urls,memberships";

/** Everything the connect button asks for, with summaries on. */
const FULL_SCOPE = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
].join(" ");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** Answers Google's `api` with `client`, in place of the real one. */
const mockApi = (
  api: "people" | "gmail" | "calendar" | "oauth2",
  client: object,
) => vi.spyOn(google, api).mockReturnValue(client as never);

/** People answers its connections list with `data`. */
function mockPeople(data: object, groups?: Mock) {
  const list = vi.fn().mockResolvedValue({ data });
  mockApi("people", {
    people: { connections: { list } },
    ...(groups ? { contactGroups: { list: groups } } : {}),
  });
  return list;
}

/** Calendar answers its events list with these items. */
function mockCalendar(items: object[], nextSyncToken = "c1") {
  const list = vi.fn().mockResolvedValue({ data: { items, nextSyncToken } });
  mockApi("calendar", { events: { list } });
  return list;
}

/** A metadata answer for one message: a mail from `id`@example.com. */
function meta(
  id: string,
  extra: { labelIds?: string[]; date?: string; internalDate?: string } = {},
) {
  return {
    data: {
      id,
      threadId: "t",
      labelIds: extra.labelIds ?? ["INBOX"],
      internalDate: extra.internalDate ?? "1771164000000",
      payload: {
        headers: [
          { name: "From", value: `Sender ${id} <${id}@example.com>` },
          { name: "To", value: "me@example.com" },
          { name: "Subject", value: `Subject ${id}` },
          {
            name: "Date",
            value: extra.date ?? "Sun, 15 Feb 2026 14:00:00 +0000",
          },
          { name: "Message-ID", value: `<${id}@example.com>` },
        ],
      },
    },
  };
}

/**
 * Gmail with these parts. Each message is a metadata answer from `meta`,
 * unless `get` is replaced. Returns `get`.
 */
function mockGmail(users: { history?: Mock; list?: Mock; getProfile?: Mock }) {
  const get = vi.fn(({ id }: { id: string }) => Promise.resolve(meta(id)));
  mockApi("gmail", {
    users: {
      history: { list: users.history ?? vi.fn() },
      messages: { list: users.list ?? vi.fn(), get },
      getProfile:
        users.getProfile ??
        vi.fn().mockResolvedValue({ data: { historyId: "H-now" } }),
    },
  });
  return get;
}

type SyncContext = Parameters<typeof googleAdapter.sync>[0];
const CONFIG: SyncContext["config"] = {
  syncContacts: false,
  syncEmail: false,
  syncCalendar: false,
  summaries: false,
  lookbackDays: 90,
  rollup: true,
  ghostThreshold: 3,
  maxMessagesPerRun: 5000,
  aliases: [],
};

/** One sync of the stage(s) in `config`, from `cursor`. */
async function run(
  config: Partial<SyncContext["config"]>,
  cursor: unknown = null,
  extra: Partial<SyncContext> = {},
) {
  const events: SyncEvent[] = [];
  const gen = googleAdapter.sync({
    config: { ...CONFIG, ...config },
    secret: { refreshToken: "good-token", email: "me@example.com" },
    cursor,
    since: "2026-02-01T00:00:00.000Z",
    selfAddresses: { emails: ["me@example.com"], phones: [] },
    signal: new AbortController().signal,
    log: () => {},
    ...extra,
  });
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return {
    events: events.filter((e) => e.kind !== "progress"),
    cursor: step.value as Record<string, unknown>,
  };
}

/** The Message-IDs of the mails a sync yielded. */
const emailIds = (events: SyncEvent[]) =>
  events.flatMap((e) =>
    e.kind === "interaction"
      ? [e.externalId.replace("google:gmail:", "").replace(/^<|>$/g, "")]
      : [],
  );

const added = (...ids: string[]) => ids.map((id) => ({ message: { id } }));

describe("Google Workspace connector", () => {
  let server: http.Server;
  let adminActor: Actor;
  let memberActor: Actor;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    process.env.DISABLE_BACKGROUND_JOBS = "true";

    server = makeTestApp().listen(0);
    resetAccounts();
    adminActor = await createActor(server, {
      username: "adminuser",
      email: "adminuser@example.com",
    });
    sqlite
      .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
      .run(adminActor.user.id);
    memberActor = await createActor(server, {
      username: "memberuser",
      email: "memberuser@example.com",
    });
  });

  afterAll(async () => {
    process.env.AUTH_REQUIRED = "";
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    delete process.env.DISABLE_BACKGROUND_JOBS;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    resetAccounts();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    setGoogleOAuthCredentials({
      clientId: "test-google-client-id",
      clientSecret: "test-google-client-secret-12345",
    });
  });

  describe("OAuth settings and sign-in", () => {
    it("takes the OAuth client from the environment, refuses to save over it, and clears a saved one", async () => {
      const integrations = (method: "get" | "put", body?: object) => {
        const req = request(server);
        return req[method]("/api/admin/integrations")
          .set("Cookie", adminActor.cookie)
          .send(body);
      };
      const redirectUri = expect.stringMatching(
        /\/api\/connectors\/google\/callback$/,
      );

      const cleared = await integrations("put", { googleOAuth: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.googleOAuth).toEqual({
        configured: false,
        source: "none",
        clientId: null,
        clientSecretPreview: null,
        redirectUri,
      });
      expect(getGoogleOAuthCredentials()).toBeNull();

      process.env.GOOGLE_OAUTH_CLIENT_ID =
        "env-client-id.apps.googleusercontent.com";
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "env-secret-value-8888";
      expect((await integrations("get")).body.googleOAuth).toEqual({
        configured: true,
        source: "env",
        clientId: "env-client-id.apps.googleusercontent.com",
        clientSecretPreview: "••••8888",
        redirectUri,
      });
      const put = await integrations("put", {
        googleOAuth: { clientId: "ignored", clientSecret: "ignored" },
      });
      expect(put.status).toBe(409);
      expect(put.body.error.code).toBe("SET_BY_ENVIRONMENT");
    });

    it("starts a sign-in with PKCE and keeps its state", async () => {
      const res = await request(server)
        .get("/api/connectors/google/start?summaries=true")
        .set("Cookie", memberActor.cookie);

      expect(res.status).toBe(302);
      const url = new URL(res.headers.location);
      expect(url.host).toBe("accounts.google.com");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        response_type: "code",
        access_type: "offline",
        prompt: "consent",
        code_challenge: expect.any(String),
        code_challenge_method: "S256",
      });
      expect(
        sqlite
          .prepare(
            "SELECT ownerId, kind, codeVerifier FROM oauth_states WHERE state = ?",
          )
          .get(url.searchParams.get("state")),
      ).toEqual({
        ownerId: memberActor.user.id,
        kind: "google",
        codeVerifier: expect.any(String),
      });
    });

    /**
     * Come back from Google's consent screen as `email`, with a mocked code
     * exchange that hands out `refreshToken` (Google sends none on a repeat
     * consent).
     */
    async function signInWithGoogle(
      email: string,
      refreshToken?: string,
      scope = FULL_SCOPE,
    ) {
      const state = crypto.randomUUID();
      sqlite
        .prepare(
          `INSERT INTO oauth_states (state, ownerId, kind, codeVerifier, createdAt)
           VALUES (?, ?, 'google', ?, CURRENT_TIMESTAMP)`,
        )
        .run(state, memberActor.user.id, "verifier");
      vi.spyOn(google.auth, "OAuth2").mockImplementation(
        class {
          getToken = vi.fn().mockResolvedValue({
            tokens: {
              access_token: `access-${email}`,
              refresh_token: refreshToken,
              expiry_date: Date.now() + HOUR,
              scope,
            },
          });
          setCredentials = vi.fn();
        } as unknown as typeof google.auth.OAuth2,
      );
      mockApi("oauth2", {
        userinfo: { get: vi.fn().mockResolvedValue({ data: { email } }) },
      });
      vi.spyOn(googleAdapter, "test").mockResolvedValue({
        ok: true,
        detail: `Connected to Google Workspace as ${email}`,
      });
      const res = await request(server)
        .get(`/api/connectors/google/callback?code=code&state=${state}`)
        .set("Cookie", memberActor.cookie);
      // The state is used up either way.
      expect(
        sqlite.prepare("SELECT 1 FROM oauth_states WHERE state = ?").get(state),
      ).toBeUndefined();
      return res.headers.location;
    }

    const googleConnector = (email: string) =>
      listConnectors(memberActor.scope).find(
        (c) => c.name === `Google (${email})`,
      );

    /** Each Google connector's account and refresh token, by address. */
    const googleAccounts = () =>
      Object.fromEntries(
        (
          sqlite
            .prepare(
              "SELECT secret FROM connectors WHERE ownerId = ? AND kind = 'google'",
            )
            .pluck()
            .all(memberActor.user.id) as string[]
        ).map((secret) => {
          const opened = JSON.parse(secretBox.open(secret));
          return [opened.email, opened.refreshToken];
        }),
      );

    /** Removes a test's Google connectors, so later tests see only their own. */
    const dropGoogleConnectors = () =>
      sqlite
        .prepare("DELETE FROM connectors WHERE ownerId = ? AND kind = 'google'")
        .run(memberActor.user.id);

    it("connects an account, and keeps a second one and a returning one each on its own connector", async () => {
      expect(await signInWithGoogle("alice@example.com", "alice-refresh")).toBe(
        "/settings/connectors?connected=google",
      );
      expect(googleConnector("alice@example.com")).toMatchObject({
        status: "active",
        secretPresent: true,
        config: { summaries: true },
      });

      // A second account wrote its tokens over the first one's connector.
      await signInWithGoogle("bob@example.com", "bob-refresh");
      // Alice again, with no new refresh token: her connector keeps hers.
      await signInWithGoogle("Alice@Example.com");
      expect(googleAccounts()).toEqual({
        "Alice@Example.com": "alice-refresh",
        "bob@example.com": "bob-refresh",
      });
      dropGoogleConnectors();
    });

    // The browser opens the callback as a page: never raw JSON.
    it("sends a callback that expired, was denied, or brought no refresh token back to Connectors with a reason", async () => {
      const callback = async (query: string) =>
        (
          await request(server)
            .get(`/api/connectors/google/callback?${query}`)
            .set("Cookie", memberActor.cookie)
        ).headers.location;
      expect(await callback("code=bad-code&state=non-existent-state")).toBe(
        "/settings/connectors?error=expired",
      );
      expect(await callback("error=access_denied")).toBe(
        "/settings/connectors?error=denied",
      );
      // Without a refresh token the connector cannot sync. Before, the
      // secret schema refused it inside createConnector, and the browser
      // landed on a JSON 400.
      expect(await signInWithGoogle("carol@example.com", undefined)).toBe(
        "/settings/connectors?error=failed",
      );
      expect(googleConnector("carol@example.com")).toBeUndefined();
    });

    it("connects on a server east of UTC, and turns off a stage whose scope was not granted", async () => {
      // SQLite stores the state's time in UTC. Read as local time in Berlin,
      // a state made a second ago was an hour old, and every sign-in expired.
      const tz = process.env.TZ;
      process.env.TZ = "Europe/Berlin";
      try {
        expect(
          await signInWithGoogle(
            "east-of-utc@example.com",
            "east-refresh",
            "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.metadata",
          ),
        ).toBe("/settings/connectors?connected=google");
      } finally {
        process.env.TZ = tz;
      }
      expect(googleConnector("east-of-utc@example.com")?.config).toMatchObject({
        syncContacts: false,
        syncEmail: true,
        syncCalendar: false,
        summaries: false,
        mailBodies: false,
        accountEmail: "east-of-utc@example.com",
      });
      dropGoogleConnectors();
    });

    it("signs a connector whose secret the key no longer opens in again, in place", async () => {
      await signInWithGoogle("lost-key@example.com", "old-refresh");
      sqlite
        .prepare(
          "UPDATE connectors SET secret = 'not-a-sealed-secret' WHERE ownerId = ? AND kind = 'google'",
        )
        .run(memberActor.user.id);
      await signInWithGoogle("lost-key@example.com", "new-refresh");
      expect(googleAccounts()).toEqual({
        "lost-key@example.com": "new-refresh",
      });
      dropGoogleConnectors();
    });

    it("gives up the access at Google when the connector is removed, even when that fails", async () => {
      await signInWithGoogle("removed@example.com", "removed-refresh");
      const revoke = vi
        .spyOn(googleAdapter, "revoke")
        .mockRejectedValue(new Error("network down"));
      const res = await request(server)
        .delete(`/api/connectors/${googleConnector("removed@example.com")!.id}`)
        .set("Cookie", memberActor.cookie);
      expect(res.status).toBe(204);
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: "removed-refresh" }),
      );
    });
  });

  describe("test() and the request layer", () => {
    it("names the account, and reads invalid_grant as a sign-in to redo", async () => {
      const get = vi
        .fn()
        .mockResolvedValueOnce({ data: { email: "user@workspace.com" } })
        .mockRejectedValueOnce(new Error("invalid_grant: Bad Request"));
      mockApi("oauth2", { userinfo: { get } });
      const test = () => googleAdapter.test(CONFIG, { refreshToken: "token" });

      expect((await test()).detail).toContain("user@workspace.com");
      await expect(test()).rejects.toThrow(ConnectorAuthError);
    });

    // The URLs googleapis-common built, recorded before it was removed: RFC
    // 3986 encoding, an array as a repeated key, an undefined value left out.
    it("builds the URLs the googleapis clients built, with retries on", async () => {
      const request = vi.fn().mockResolvedValue({ data: {} });
      const auth = { request } as never;
      await google.gmail(auth).users.messages.get(
        {
          userId: "me",
          id: "a b",
          format: "metadata",
          metadataHeaders: ["From", "To"],
        },
        {},
      );
      await google.people(auth).people.connections.list(
        {
          resourceName: "people/me",
          personFields: "names,emailAddresses",
          pageSize: 100,
          pageToken: undefined,
          syncToken: "a +/=!*~",
          requestSyncToken: true,
        },
        {},
      );
      expect(request.mock.calls.map(([o]) => [o.url, o.retry])).toEqual([
        [
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/a%20b?format=metadata&metadataHeaders=From&metadataHeaders=To",
          true,
        ],
        [
          "https://people.googleapis.com/v1/people/me/connections?personFields=names%2CemailAddresses&pageSize=100&syncToken=a%20%2B%2F%3D%21%2A~&requestSyncToken=true",
          true,
        ],
      ]);
    });
  });

  describe("sync", () => {
    it("pulls People contacts, Gmail messages with an AI summary, and Calendar events, each call with a timeout and the sync's signal", async () => {
      const people = mockPeople({
        connections: [
          {
            resourceName: "people/c123456",
            names: [{ displayName: "Bob Builder" }],
            emailAddresses: [{ value: "bob@builder.com" }],
            organizations: [{ name: "Builder Corp", title: "Contractor" }],
          },
        ],
        nextSyncToken: "contacts-sync-token-v1",
      });

      const headers = [
        { name: "From", value: "Bob Builder <bob@builder.com>" },
        { name: "To", value: "Me <me@example.com>" },
        { name: "Subject", value: "Project Blueprint Update" },
        { name: "Date", value: "Sun, 15 Feb 2026 14:00:00 +0000" },
        { name: "Message-ID", value: "<msg-101@builder.com>" },
      ];
      const body = Buffer.from("The updated blueprint.").toString("base64url");
      const messages = vi.fn().mockResolvedValue({
        data: { messages: [{ id: "msg-101" }] },
      });
      const get = mockGmail({
        list: messages,
        getProfile: vi
          .fn()
          .mockResolvedValue({ data: { historyId: "history-9999" } }),
      });
      get.mockImplementation((({ format }: { format?: string }) =>
        Promise.resolve({
          data: {
            id: "msg-101",
            payload:
              format === "full"
                ? {
                    headers,
                    parts: [{ mimeType: "text/plain", body: { data: body } }],
                  }
                : { headers },
          },
        })) as never);

      const day = (days: number) => at(days * DAY).slice(0, 10);
      const meeting = (id: string, start: number) => ({
        id,
        summary: id,
        start: { dateTime: at(start) },
        end: { dateTime: at(start + HOUR) },
        attendees: [{ email: "bob@builder.com", displayName: "Bob Builder" }],
      });
      const calendar = mockCalendar(
        [
          meeting("Past Blueprint Sync", -2 * HOUR),
          meeting("Future Site Inspection", DAY),
          {
            id: "all-day",
            summary: "Site Holiday",
            start: { date: day(3) },
            end: { date: day(4) },
            attendees: [{ email: "bob@builder.com" }],
          },
        ],
        "calendar-sync-token-v1",
      );

      vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
      vi.spyOn(gateway, "generateFor").mockResolvedValue({
        text: "Bob sent the updated construction blueprint for review.",
        model: "test-model",
        tokenCount: 20,
        latencyMs: 40,
      } as gateway.AIGenerateResult);

      const signal = new AbortController().signal;
      const { events, cursor } = await run(
        {
          syncContacts: true,
          syncEmail: true,
          syncCalendar: true,
          summaries: true,
        },
        null,
        {
          since: "2026-01-01T00:00:00.000Z",
          signal,
          // The sync service always names the connector's owner. A summary
          // is checked against that owner's AI switch, and is refused when
          // no owner is named.
          accountId: "google-summary-owner",
          isContactParticipant: (p: { email?: string }) =>
            p.email === "bob@builder.com",
        },
      );

      expect(cursor).toEqual({
        contactsSyncToken: "contacts-sync-token-v1",
        contactsFields: PERSON_FIELDS,
        calendarSyncToken: "calendar-sync-token-v1",
        calendarListedAt: expect.any(String),
        gmailHistoryId: "history-9999",
        lastSyncAt: expect.any(String),
      });
      expect(
        events.map((e) => [
          e.kind,
          e.kind === "contact"
            ? [e.contact.name, e.contact.company]
            : "title" in e
              ? [e.title, e.kind === "interaction" ? e.content : e.startsAt]
              : null,
        ]),
      ).toEqual([
        ["contact", ["Bob Builder", "Builder Corp"]],
        [
          "interaction",
          [
            "Project Blueprint Update",
            "Bob sent the updated construction blueprint for review.",
          ],
        ],
        ["interaction", ["Past Blueprint Sync", undefined]],
        ["upcoming", ["Future Site Inspection", expect.any(String)]],
        // An all-day event is its day, not midnight UTC, so it never shows
        // on the evening before west of UTC.
        ["upcoming", ["Site Holiday", day(3)]],
        ["upcoming_listed", null],
      ]);

      // Every call carries a timeout and the sync's signal. With neither, a
      // half-open connection held the sync and its slots until a restart.
      const sent = [people, messages, get, calendar].flatMap((fn) =>
        fn.mock.calls.map((call: unknown[]) => call[1]),
      );
      expect(sent).toHaveLength(6);
      for (const option of sent) {
        expect(option).toEqual({ timeout: GOOGLE_CALL_TIMEOUT_MS, signal });
      }
    });

    it("runs a full People sync when the saved token has expired", async () => {
      // People answers an expired token with 400 EXPIRED_SYNC_TOKEN, not 410.
      const expired = Object.assign(new Error("Sync token is expired."), {
        status: 400,
        response: {
          status: 400,
          data: { error: { details: [{ reason: "EXPIRED_SYNC_TOKEN" }] } },
        },
      });
      const list = vi.fn(async (params: { syncToken?: string }) => {
        if (params.syncToken) throw expired;
        return {
          data: {
            connections: [
              { resourceName: "people/c1", names: [{ displayName: "Ada" }] },
            ],
            nextSyncToken: "fresh-token",
          },
        };
      });
      mockApi("people", { people: { connections: { list } } });

      const { events, cursor } = await run(
        { syncContacts: true },
        { contactsSyncToken: "week-old-token", contactsFields: PERSON_FIELDS },
      );
      expect(events.filter((e) => e.kind === "contact")).toHaveLength(1);
      expect(cursor).toMatchObject({ contactsSyncToken: "fresh-token" });
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("reports a person Google deleted, keeps one with an address but no name, and drops a token made for older fields", async () => {
      const list = mockPeople({
        connections: [
          { resourceName: "people/gone", metadata: { deleted: true } },
          {
            resourceName: "people/nameless",
            emailAddresses: [
              { value: "nameless@example.com" },
              { value: "nameless@work.example.com", type: "work" },
            ],
          },
        ],
        nextSyncToken: "t2",
      });
      const { events, cursor } = await run(
        { syncContacts: true },
        { contactsSyncToken: "t1", contactsFields: PERSON_FIELDS },
      );
      // Google flags a deleted person in `metadata`, which only comes back
      // when the request asks for it.
      expect(list.mock.calls[0][0]).toMatchObject({
        personFields: PERSON_FIELDS,
        syncToken: "t1",
      });
      expect(cursor).toMatchObject({
        contactsSyncToken: "t2",
        contactsFields: PERSON_FIELDS,
      });
      expect(events).toEqual([
        { kind: "contact_deleted", externalId: "people/gone" },
        expect.objectContaining({
          kind: "contact",
          externalId: "people/nameless",
          contact: expect.objectContaining({
            // In the field the repository reads, in Contrack's words.
            emails: [
              {
                email: "nameless@example.com",
                label: "personal",
                isPrimary: false,
              },
              {
                email: "nameless@work.example.com",
                label: "work",
                isPrimary: false,
              },
            ],
          }),
        }),
      ]);

      // A token made before the fields asked for `metadata` answers for the
      // old fields: it is dropped, and the run pulls everyone again.
      await run({ syncContacts: true }, { contactsSyncToken: "t1" });
      expect(list.mock.calls[1][0].syncToken).toBeUndefined();
    });

    it("maps a card's birthday, addresses, notes, links and labels, and sends Google's letter tile as a placeholder, not a photo", async () => {
      const tile = "https://lh3.googleusercontent.com/cm/ABC123=s100";
      const group = (id: string, name: string, system = true) => ({
        resourceName: `contactGroups/${id}`,
        name,
        formattedName: system ? name[0].toUpperCase() + name.slice(1) : name,
        groupType: system ? "SYSTEM_CONTACT_GROUP" : "USER_CONTACT_GROUP",
      });
      const groups = [
        group("friends", "friends"),
        group("starred", "starred"),
        group("1a2b3c", "Book club", false),
      ];
      mockPeople(
        {
          connections: [
            {
              resourceName: "people/c1",
              names: [{ displayName: "Ana Lee" }],
              photos: [{ url: tile, default: true }],
              birthdays: [{ date: { month: 5, day: 14 } }],
              addresses: [
                {
                  formattedValue: "1 Main St\nSpringfield, IL 62701\nUS",
                  type: "home",
                  metadata: { primary: true },
                },
              ],
              biographies: [{ value: "Met at the conference." }],
              urls: [
                { value: "https://analee.example" },
                {
                  value: "https://www.linkedin.com/in/analee",
                  type: "profile",
                },
              ],
              memberships: groups.map((g) => ({
                contactGroupMembership: {
                  contactGroupResourceName: g.resourceName,
                },
              })),
            },
          ],
        },
        vi.fn().mockResolvedValue({ data: { contactGroups: groups } }),
      );

      expect((await run({ syncContacts: true })).events).toEqual([
        {
          kind: "contact",
          externalId: "people/c1",
          defaultPhotoUrl: tile,
          contact: {
            name: "Ana Lee",
            emails: [],
            phones: [],
            birthday: "--05-14",
            about: "Met at the conference.",
            website: "https://analee.example",
            addresses: [
              {
                address: "1 Main St, Springfield, IL 62701, US",
                label: "home",
                isPrimary: true,
              },
            ],
            socialLinks: [
              { url: "https://analee.example" },
              { url: "https://www.linkedin.com/in/analee" },
            ],
            tags: ["Friends", "Book club"],
          },
        },
      ]);
    });

    it("reports a stage that failed while the others went on", async () => {
      mockPeople({
        connections: [
          { resourceName: "people/c1", names: [{ displayName: "Ada" }] },
        ],
        nextSyncToken: "t1",
      });
      mockGmail({
        list: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("Backend Error"), { status: 500 }),
          ),
      });
      const { events } = await run({ syncContacts: true, syncEmail: true });
      expect(events).toContainEqual({
        kind: "stage_failed",
        message: "Error syncing Gmail: Backend Error",
      });
      expect(events.some((e) => e.kind === "contact")).toBe(true);
    });

    // With the cap at 2, the second record is not taken, and the cursor
    // stays at the first, so the next run starts with m3. Before, the ids
    // past the cap were dropped and the cursor moved past them.
    it.each([
      [
        "stops the history walk at the cap, after whole records, and keeps the cursor at the last record taken",
        [
          { id: "h1", messagesAdded: added("m1", "m2") },
          { id: "h2", messagesAdded: added("m3") },
        ],
        ["m1", "m2"],
        "h1",
      ],
      [
        "takes a record larger than the cap whole, and the mailbox's history id when nothing is left",
        [{ id: "h1", messagesAdded: added("m1", "m2", "m3") }],
        ["m1", "m2", "m3"],
        "H2",
      ],
    ])("%s", async (_name, history, ids, historyId) => {
      mockGmail({
        history: vi
          .fn()
          .mockResolvedValue({ data: { historyId: "H2", history } }),
      });
      const { events, cursor } = await run(
        { syncEmail: true, maxMessagesPerRun: 2 },
        { gmailHistoryId: "H1" },
      );
      expect(emailIds(events)).toEqual(ids.map((id) => `${id}@example.com`));
      expect(cursor.gmailHistoryId).toBe(historyId);
    });

    it("pages a first sync across runs by date, and switches to history from the id it took at the start", async () => {
      // Run 1 takes the two newest mails and reaches the cap. It keeps where
      // it got to, and the mailbox's history id from before it listed. Run 2
      // lists older mails before that point. Before, run 1 jumped to the
      // profile's history id and the older mails were never fetched.
      const list1 = vi.fn().mockResolvedValue({
        data: { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" },
      });
      mockGmail({ list: list1 }).mockImplementation(({ id }) =>
        Promise.resolve(
          meta(id, {
            internalDate: id === "m1" ? "1771164000000" : "1771160400000",
          }),
        ),
      );
      const first = await run({ syncEmail: true, maxMessagesPerRun: 2 });
      expect(emailIds(first.events)).toEqual([
        "m1@example.com",
        "m2@example.com",
      ]);
      expect(first.cursor.gmailHistoryId).toBeUndefined();
      expect(list1.mock.calls[0][0]).toMatchObject({ q: "after:1769904000" });

      const list2 = vi.fn().mockResolvedValue({
        data: { messages: [{ id: "m3" }] },
      });
      mockGmail({
        list: list2,
        getProfile: vi
          .fn()
          .mockResolvedValue({ data: { historyId: "H-later" } }),
      });
      const second = await run(
        { syncEmail: true, maxMessagesPerRun: 2 },
        first.cursor,
      );
      expect(emailIds(second.events)).toEqual(["m3@example.com"]);
      // Older than m2 (1771160400 s), same second included, from the same start.
      expect(list2.mock.calls[0][0]).toMatchObject({
        q: "after:1769904000 before:1771160401",
      });
      expect(second.cursor.gmailHistoryId).toBe("H-now");
      expect(second.cursor.gmailBackfill).toBeUndefined();
    });

    it("lists without q when the token has only the metadata scope, and keeps the window by date", async () => {
      // A connector signed in with AI summaries off holds gmail.metadata, and
      // Google refuses `q` under it, so every first sync failed.
      const refused = Object.assign(
        new Error("Metadata scope does not support 'q' parameter"),
        { status: 403 },
      );
      const since = 1769904000 * 1000;
      const dates: Record<string, number> = {
        m1: since + 14 * DAY,
        m2: since + 10 * DAY,
        m3: since + 1 * DAY,
        m4: since - 1 * DAY,
      };
      const pages: Record<string, { ids: string[]; next?: string }> = {
        first: { ids: ["m1", "m2"], next: "p2" },
        p2: { ids: ["m3", "m4"], next: "p3" },
        p3: { ids: ["m5"] },
      };
      const list = vi.fn(async (params: { q?: string; pageToken?: string }) => {
        if (params.q) throw refused;
        const page = pages[params.pageToken ?? "first"];
        return {
          data: {
            messages: page.ids.map((id) => ({ id })),
            nextPageToken: page.next,
          },
        };
      });
      mockGmail({ list }).mockImplementation(({ id }) =>
        Promise.resolve(meta(id, { internalDate: String(dates[id]) })),
      );

      // The second page reaches past the window's start, so it is the last,
      // and the mail before the start is dropped.
      const first = await run({ syncEmail: true });
      expect(emailIds(first.events)).toEqual([
        "m1@example.com",
        "m2@example.com",
        "m3@example.com",
      ]);
      expect(list.mock.calls.map(([params]) => params.pageToken)).toEqual([
        undefined,
        undefined,
        "p2",
      ]);
      expect(first.cursor.gmailHistoryId).toBe("H-now");

      // A backfill after a run that took m1 and m2 starts from the second
      // after m2. It passes over the page that ends with m2: counting that
      // page again filled the cap with mail already taken.
      const backfill = await run(
        { syncEmail: true },
        {
          gmailBackfill: {
            since: 1769904000,
            before: Math.floor(dates.m2 / 1000) + 1,
            historyId: "H0",
          },
        },
      );
      expect(emailIds(backfill.events)).toEqual(["m3@example.com"]);
      expect(backfill.cursor.gmailHistoryId).toBe("H0");
    });

    it("moves a first sync's date bound back even when the cap is filled by mail from one second", async () => {
      // Two mails in the same second fill a cap of 2. The bound was that
      // second plus one, the bound the run started from, so the next run
      // listed the same two mails again, run after run.
      const second = 1771160400;
      mockGmail({
        list: vi.fn().mockResolvedValue({
          data: { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" },
        }),
      }).mockImplementation(({ id }) =>
        Promise.resolve(meta(id, { internalDate: String(second * 1000) })),
      );
      const { cursor } = await run(
        { syncEmail: true, maxMessagesPerRun: 2 },
        {
          gmailBackfill: {
            since: 1769904000,
            before: second + 1,
            historyId: "H0",
          },
        },
      );
      expect(cursor.gmailBackfill).toMatchObject({ before: second });
    });

    it("skips spam, trash and drafts, and dates a mail by the mailbox when its Date header is far off", async () => {
      mockGmail({
        history: vi.fn().mockResolvedValue({
          data: {
            historyId: "H2",
            history: [
              {
                id: "h1",
                messagesAdded: added("spam", "trash", "draft", "ok"),
              },
            ],
          },
        }),
      }).mockImplementation(({ id }) =>
        Promise.resolve(
          meta(id, {
            labelIds: id === "ok" ? ["INBOX"] : [id.toUpperCase(), "UNREAD"],
            date: "Fri, 01 Jan 2099 00:00:00 +0000",
          }),
        ),
      );
      const { events } = await run(
        { syncEmail: true },
        { gmailHistoryId: "H1" },
      );
      expect(emailIds(events)).toEqual(["ok@example.com"]);
      expect((events[0] as { date: string }).date).toBe(
        "2026-02-15T14:00:00.000Z",
      );
    });

    it.each([404, 410])(
      "lists messages again when the history id is gone (%s), without the ids of the history pages read before",
      async (code) => {
        const history = vi
          .fn()
          .mockResolvedValueOnce({
            data: {
              history: [{ id: "h1", messagesAdded: added("m1") }],
              nextPageToken: "p2",
            },
          })
          .mockRejectedValueOnce(Object.assign(new Error("gone"), { code }));
        mockGmail({
          history,
          list: vi
            .fn()
            .mockResolvedValue({ data: { messages: [{ id: "m9" }] } }),
        });
        const { events, cursor } = await run(
          { syncEmail: true },
          { gmailHistoryId: "old" },
        );
        expect(emailIds(events)).toEqual(["m9@example.com"]);
        expect(cursor.gmailHistoryId).toBe("H-now");
      },
    );

    it("stops the sync when Google refuses the token while it reads a message", async () => {
      // Each failed message was logged and skipped, so an expired token
      // skipped the whole mailbox and moved the history id past it.
      mockGmail({
        history: vi.fn().mockResolvedValue({
          data: {
            historyId: "H2",
            history: [{ id: "h1", messagesAdded: added("m1") }],
          },
        }),
      }).mockRejectedValue(
        Object.assign(new Error("invalid_grant"), { code: 400 }),
      );
      await expect(
        run({ syncEmail: true }, { gmailHistoryId: "H1" }),
      ).rejects.toBeInstanceOf(ConnectorAuthError);
    });

    it("logs a meeting that ended since the last window once, though its token returns nothing, and lists 60 days ahead", async () => {
      const listedAt = at(-2 * HOUR);
      const event = (id: string, start: number) => ({
        id,
        summary: id,
        start: { dateTime: at(start) },
        end: { dateTime: at(start + HOUR) },
        attendees: [{ email: "bob@example.com" }],
      });
      // The token returns a meeting added after it took place, and one that
      // changed and ended after the last window, which the window logs.
      type Query = { syncToken?: string; timeMin?: string; timeMax?: string };
      const list = vi.fn(async (params: Query) => ({
        data: params.syncToken
          ? {
              items: [
                event("added-late", -6 * HOUR),
                event("held", -1.5 * HOUR),
              ],
              nextSyncToken: "c2",
            }
          : { items: [event("held", -1.5 * HOUR), event("next", DAY)] },
      }));
      mockApi("calendar", { events: { list } });

      const { events, cursor } = await run(
        { syncCalendar: true },
        { calendarSyncToken: "c1", calendarListedAt: listedAt },
      );
      expect(
        events.map((e) => [e.kind, "externalId" in e ? e.externalId : null]),
      ).toEqual([
        ["interaction", "google:calendar:added-late"],
        ["interaction", "google:calendar:held"],
        ["upcoming", "google:calendar:next"],
        ["upcoming_listed", null],
      ]);
      const [token, window] = list.mock.calls.map(([params]) => params);
      expect(token).toMatchObject({ syncToken: "c1" });
      expect(token.timeMin).toBeUndefined();
      expect(window.syncToken).toBeUndefined();
      expect(window.timeMin).toBe(
        new Date(Date.parse(listedAt) - DAY).toISOString(),
      );
      expect(
        Date.parse(window.timeMax!) -
          Date.parse(cursor.calendarListedAt as string),
      ).toBe(60 * DAY);
      expect(cursor.calendarSyncToken).toBe("c2");
    });

    it("keeps no event of another type, of the owner alone, or the owner declined, no organizer that is a calendar or a robot, and no room or attendee who declined", async () => {
      const event = (id: string, start: number, extra: object) => ({
        id,
        summary: id,
        start: { dateTime: at(start) },
        end: { dateTime: at(start + HOUR) },
        ...extra,
      });
      const bob = { attendees: [{ email: "bob@example.com" }] };
      const withRoom = (self: string) => ({
        attendees: [
          { email: "me@example.com", self: true, responseStatus: self },
          { email: "bob@example.com", responseStatus: "accepted" },
          {
            email: "room-4@resource.calendar.google.com",
            resource: true,
            displayName: "Room 4",
          },
          { email: "carol@example.com", responseStatus: "declined" },
        ],
      });
      mockCalendar([
        event("birthday", DAY, { ...bob, eventType: "birthday" }),
        event("focus", DAY, { ...bob, eventType: "focusTime" }),
        event("reminder", DAY, {
          organizer: { email: "me@example.com", self: true },
        }),
        event("chore", DAY, {
          organizer: { email: "family@group.calendar.google.com" },
        }),
        event("imported", DAY, {
          ...bob,
          organizer: { email: "unknownorganizer@calendar.google.com" },
        }),
        event("booking", DAY, {
          ...bob,
          organizer: { email: "noreply@bookings.example.com" },
        }),
        event("review", DAY, {
          ...bob,
          organizer: { email: "carol@example.com" },
        }),
        event("past-ok", -3 * HOUR, withRoom("accepted")),
        event("past-declined", -5 * HOUR, withRoom("declined")),
        event("future-declined", DAY, withRoom("declined")),
      ]);

      const { events } = await run({ syncCalendar: true });
      expect(
        events.flatMap((e) =>
          e.kind === "upcoming" || e.kind === "interaction"
            ? [[e.kind, e.title, e.participants.map((p) => p.email)]]
            : [],
        ),
      ).toEqual([
        ["upcoming", "imported", ["bob@example.com"]],
        ["upcoming", "booking", ["bob@example.com"]],
        ["upcoming", "review", ["bob@example.com", "carol@example.com"]],
        ["interaction", "past-ok", ["me@example.com", "bob@example.com"]],
      ]);
    });

    it("starts a stage with no place of its own at the lookback date, and forgets the place of a stage that is off", async () => {
      const firstSince = "2025-11-03T00:00:00.000Z";
      const messages = vi.fn().mockResolvedValue({ data: {} });
      mockGmail({ list: messages });
      const events = mockCalendar([]);

      const { cursor } = await run(
        { syncEmail: true, syncCalendar: true },
        {
          lastSyncAt: "2026-02-01T00:00:00.000Z",
          contactsSyncToken: "p1",
          contactsFields: PERSON_FIELDS,
        },
        { firstSince },
      );
      expect(messages.mock.calls[0][0].q).toBe(
        `after:${Date.parse(firstSince) / 1000}`,
      );
      expect(events.mock.calls[0][0].timeMin).toBe(firstSince);
      expect(cursor.contactsSyncToken).toBeUndefined();
    });
  });
});
