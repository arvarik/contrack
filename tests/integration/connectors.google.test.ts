/**
 * tests/integration/connectors.google.test.ts — Integration tests for Google Workspace adapter & OAuth.
 *
 * Covers:
 * - Admin integrations setting for Google OAuth (env overrides, clearing)
 * - OAuth start and callback routes with PKCE and state verification
 * - Google adapter test() and sync() with the Google API calls mocked
 * - People API contacts with syncToken, photo and metadata
 * - Gmail API messages with metadata headers and AI summaries for matched contacts
 * - Google Calendar API with past meetings and upcoming events
 * - invalid_grant mapping to ConnectorAuthError
 * - Ignore correspondent route and filtering
 */

import crypto from "node:crypto";
import http from "http";
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
import {
  listConnectors,
  listCorrespondents,
} from "../../server/connectors/service.ts";
import { ConnectorAuthError } from "../../server/connectors/errors.ts";
import * as secretBox from "../../server/utils/secretBox.ts";
import * as gateway from "../../server/ai/gateway.ts";
import type { SyncEvent } from "../../server/connectors/types.ts";

/** The People fields the adapter asks for. `metadata` carries `deleted`. */
const PERSON_FIELDS =
  "metadata,names,emailAddresses,phoneNumbers,organizations,photos,birthdays,addresses,biographies,urls,memberships";

describe("Google Workspace Connector & OAuth Integration", () => {
  let server: http.Server;
  let adminActor: Actor;
  let memberActor: Actor;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    process.env.DISABLE_BACKGROUND_JOBS = "true";

    const app = makeTestApp();
    server = app.listen(0);

    resetAccounts();
    adminActor = await createActor(server, {
      username: "adminuser",
      email: "adminuser@example.com",
    });
    sqlite
      .prepare("UPDATE users SET role = 'admin' WHERE id = ?")
      .run(adminActor.user.id);
    (adminActor.user as { role?: string }).role = "admin";
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

  describe("Admin Integrations Setting for Google OAuth", () => {
    it("respects GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET env overrides", async () => {
      process.env.GOOGLE_OAUTH_CLIENT_ID =
        "env-client-id.apps.googleusercontent.com";
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "env-secret-value-8888";

      const res = await request(server)
        .get("/api/admin/integrations")
        .set("Cookie", adminActor.cookie);

      expect(res.status).toBe(200);
      expect(res.body.googleOAuth).toEqual({
        configured: true,
        source: "env",
        clientId: "env-client-id.apps.googleusercontent.com",
        clientSecretPreview: "••••8888",
        redirectUri: expect.stringMatching(
          /\/api\/connectors\/google\/callback$/,
        ),
      });

      // Trying to update via PUT throws 409 SET_BY_ENVIRONMENT
      const putRes = await request(server)
        .put("/api/admin/integrations")
        .set("Cookie", adminActor.cookie)
        .send({
          googleOAuth: {
            clientId: "ignored",
            clientSecret: "ignored",
          },
        });

      expect(putRes.status).toBe(409);
      expect(putRes.body.error.code).toBe("SET_BY_ENVIRONMENT");
    });

    it("clears Google OAuth credentials when null is sent", async () => {
      const res = await request(server)
        .put("/api/admin/integrations")
        .set("Cookie", adminActor.cookie)
        .send({ googleOAuth: null });

      expect(res.status).toBe(200);
      expect(res.body.googleOAuth).toEqual({
        configured: false,
        source: "none",
        clientId: null,
        clientSecretPreview: null,
        redirectUri: expect.stringMatching(
          /\/api\/connectors\/google\/callback$/,
        ),
      });

      expect(getGoogleOAuthCredentials()).toBeNull();
    });
  });

  describe("Google OAuth Routes (start & callback)", () => {
    it("GET /api/connectors/google/start initiates OAuth with PKCE and stores state", async () => {
      const res = await request(server)
        .get("/api/connectors/google/start?summaries=true")
        .set("Cookie", memberActor.cookie);

      expect(res.status).toBe(302);
      const location = res.headers.location;
      expect(location).toContain("accounts.google.com");
      expect(location).toContain("response_type=code");
      expect(location).toContain("access_type=offline");
      expect(location).toContain("prompt=consent");
      expect(location).toContain("code_challenge=");
      expect(location).toContain("code_challenge_method=S256");

      // Verify oauth_states row
      const url = new URL(location);
      const state = url.searchParams.get("state")!;
      expect(state).toBeDefined();

      const row = sqlite
        .prepare("SELECT * FROM oauth_states WHERE state = ?")
        .get(state) as
        { ownerId: string; kind: string; codeVerifier: string } | undefined;
      expect(row).toBeDefined();
      expect(row?.ownerId).toBe(memberActor.user.id);
      expect(row?.kind).toBe("google");
      expect(row?.codeVerifier).toBeDefined();
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
              expiry_date: Date.now() + 3600 * 1000,
              scope,
            },
          });
          setCredentials = vi.fn();
        } as unknown as typeof google.auth.OAuth2,
      );
      vi.spyOn(google, "oauth2").mockReturnValue({
        userinfo: { get: vi.fn().mockResolvedValue({ data: { email } }) },
      } as unknown as ReturnType<typeof google.oauth2>);
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
      return res;
    }

    /** Everything the connect button asks for, with summaries on. */
    const FULL_SCOPE = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/calendar.events.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ].join(" ");

    /** Removes a test's Google connector, so later tests see only their own. */
    const dropGoogleConnector = (email: string) =>
      sqlite
        .prepare("DELETE FROM connectors WHERE ownerId = ? AND name = ?")
        .run(memberActor.user.id, `Google (${email})`);

    it("connects on a server east of UTC, and turns off a stage whose scope was not granted", async () => {
      // SQLite stores the state's time in UTC. Read as local time in Berlin,
      // a state made a second ago was an hour old, and every sign-in expired.
      const tz = process.env.TZ;
      process.env.TZ = "Europe/Berlin";
      try {
        const res = await signInWithGoogle(
          "east-of-utc@example.com",
          "east-refresh",
          "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.metadata",
        );
        expect(res.headers.location).toBe(
          "/settings/connectors?connected=google",
        );
      } finally {
        process.env.TZ = tz;
      }
      const conn = listConnectors(memberActor.scope).find(
        (c) => c.name === "Google (east-of-utc@example.com)",
      );
      expect(conn?.config).toMatchObject({
        syncContacts: false,
        syncEmail: true,
        syncCalendar: false,
        summaries: false,
        mailBodies: false,
        accountEmail: "east-of-utc@example.com",
      });
      dropGoogleConnector("east-of-utc@example.com");
    });

    it("signs a connector whose secret the key no longer opens in again, in place", async () => {
      await signInWithGoogle("lost-key@example.com", "old-refresh");
      sqlite
        .prepare(
          "UPDATE connectors SET secret = 'not-a-sealed-secret' WHERE ownerId = ? AND name = ?",
        )
        .run(memberActor.user.id, "Google (lost-key@example.com)");
      await signInWithGoogle("lost-key@example.com", "new-refresh");
      expect(
        listConnectors(memberActor.scope).filter(
          (c) => c.name === "Google (lost-key@example.com)",
        ),
      ).toHaveLength(1);
      expect(googleAccounts()["lost-key@example.com"]).toBe("new-refresh");
      dropGoogleConnector("lost-key@example.com");
    });

    it("gives up the access at Google when the connector is removed", async () => {
      await signInWithGoogle("removed@example.com", "removed-refresh");
      const conn = listConnectors(memberActor.scope).find(
        (c) => c.name === "Google (removed@example.com)",
      )!;
      const revoke = vi
        .spyOn(googleAdapter, "revoke")
        .mockRejectedValue(new Error("network down"));
      const res = await request(server)
        .delete(`/api/connectors/${conn.id}`)
        .set("Cookie", memberActor.cookie);
      // A failed revoke does not keep the connector.
      expect(res.status).toBe(204);
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: "removed-refresh" }),
      );
    });

    /** Each Google connector's account and refresh token, by address. */
    const googleAccounts = () =>
      Object.fromEntries(
        (
          sqlite
            .prepare(
              "SELECT secret FROM connectors WHERE ownerId = ? AND kind = 'google'",
            )
            .all(memberActor.user.id) as { secret: string }[]
        ).map(({ secret }) => {
          const opened = JSON.parse(secretBox.open(secret));
          return [opened.email, opened.refreshToken];
        }),
      );

    it("GET /api/connectors/google/callback exchanges code and creates Google connector", async () => {
      const res = await signInWithGoogle(
        "alice@example.com",
        "mock-refresh-token-123",
      );
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(
        "/settings/connectors?connected=google",
      );

      const googleConn = listConnectors(memberActor.scope).find(
        (c) => c.kind === "google",
      );
      expect(googleConn?.name).toBe("Google (alice@example.com)");
      expect(googleConn?.status).toBe("active");
      expect(googleConn?.secretPresent).toBe(true);
      expect(googleConn?.config).toMatchObject({ summaries: true });
    });

    it("sends a first consent that brought no refresh token back to Connectors with a reason", async () => {
      // Without a refresh token the connector cannot sync. Before, the secret
      // schema refused it inside createConnector, and the browser landed on
      // a JSON 400 instead of the Connectors page.
      const res = await signInWithGoogle("carol@example.com", undefined);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/settings/connectors?error=failed");
      expect(
        listConnectors(memberActor.scope).map((c) => c.name),
      ).not.toContain("Google (carol@example.com)");
    });

    // A second account wrote its tokens over the first one's connector.
    it("keeps a second Google account on its own connector, and a returning one on its own", async () => {
      await signInWithGoogle("alice@example.com", "alice-refresh");
      await signInWithGoogle("bob@example.com", "bob-refresh");
      expect(googleAccounts()).toEqual({
        "alice@example.com": "alice-refresh",
        "bob@example.com": "bob-refresh",
      });

      // Alice again, with no new refresh token: her connector keeps hers.
      await signInWithGoogle("Alice@Example.com");
      expect(googleAccounts()).toEqual({
        "Alice@Example.com": "alice-refresh",
        "bob@example.com": "bob-refresh",
      });
    });

    // The browser opens the callback as a page: never raw JSON.
    it("sends a failed callback back to Connectors with a reason", async () => {
      const res = await request(server)
        .get(
          "/api/connectors/google/callback?code=bad-code&state=non-existent-state",
        )
        .set("Cookie", memberActor.cookie);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/settings/connectors?error=expired");

      const denied = await request(server)
        .get("/api/connectors/google/callback?error=access_denied")
        .set("Cookie", memberActor.cookie);
      expect(denied.headers.location).toBe("/settings/connectors?error=denied");
    });
  });

  describe("Google Adapter test() and sync()", () => {
    it("test() succeeds with valid credentials and throws ConnectorAuthError on invalid_grant", async () => {
      // Mock OAuth2 and userinfo
      vi.spyOn(google, "oauth2").mockReturnValue({
        userinfo: {
          get: vi.fn().mockResolvedValue({
            data: { email: "user@workspace.com" },
          }),
        },
      } as unknown as ReturnType<typeof google.oauth2>);

      const okResult = await googleAdapter.test(
        {
          syncContacts: true,
          syncEmail: true,
          syncCalendar: true,
          summaries: false,
          lookbackDays: 90,
          rollup: true,
          ghostThreshold: 3,
          maxMessagesPerRun: 5000,
          aliases: [],
        },
        { refreshToken: "valid-token" },
      );

      expect(okResult.ok).toBe(true);
      expect(okResult.detail).toContain("user@workspace.com");

      // Mock invalid_grant error
      vi.spyOn(google, "oauth2").mockReturnValue({
        userinfo: {
          get: vi
            .fn()
            .mockRejectedValue(new Error("invalid_grant: Bad Request")),
        },
      } as unknown as ReturnType<typeof google.oauth2>);

      await expect(
        googleAdapter.test(
          {
            syncContacts: true,
            syncEmail: true,
            syncCalendar: true,
            summaries: false,
            lookbackDays: 90,
            rollup: true,
            ghostThreshold: 3,
            maxMessagesPerRun: 5000,
            aliases: [],
          },
          { refreshToken: "expired-token" },
        ),
      ).rejects.toThrow(ConnectorAuthError);
    });

    it("sync() pulls People contacts, Gmail messages with AI summary, and Calendar events", async () => {
      // 1. Mock People API
      vi.spyOn(google, "people").mockReturnValue({
        people: {
          connections: {
            list: vi.fn().mockResolvedValue({
              data: {
                connections: [
                  {
                    resourceName: "people/c123456",
                    names: [
                      {
                        displayName: "Bob Builder",
                        metadata: { primary: true },
                      },
                    ],
                    emailAddresses: [
                      { value: "bob@builder.com", metadata: { primary: true } },
                    ],
                    phoneNumbers: [
                      { value: "+14155550199", metadata: { primary: true } },
                    ],
                    organizations: [
                      { name: "Builder Corp", title: "Contractor" },
                    ],
                    photos: [{ url: "https://photos.google.com/bob.jpg" }],
                  },
                ],
                nextSyncToken: "contacts-sync-token-v1",
              },
            }),
          },
        },
      } as unknown as ReturnType<typeof google.people>);

      // 2. Mock Gmail API
      vi.spyOn(google, "gmail").mockReturnValue({
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({
              data: {
                messages: [{ id: "msg-101" }],
              },
            }),
            get: vi
              .fn()
              .mockImplementation(
                ({
                  id: _id,
                  format,
                }: {
                  id?: string | null;
                  format?: string | null;
                }) => {
                  if (format === "full") {
                    return Promise.resolve({
                      data: {
                        id: "msg-101",
                        payload: {
                          headers: [
                            {
                              name: "From",
                              value: "Bob Builder <bob@builder.com>",
                            },
                            { name: "To", value: "Me <me@example.com>" },
                            {
                              name: "Subject",
                              value: "Project Blueprint Update",
                            },
                            {
                              name: "Date",
                              value: "Sun, 15 Feb 2026 14:00:00 +0000",
                            },
                            {
                              name: "Message-ID",
                              value: "<msg-101@builder.com>",
                            },
                          ],
                          parts: [
                            {
                              mimeType: "text/plain",
                              body: {
                                data: Buffer.from(
                                  "Here is the updated construction blueprint for review.",
                                ).toString("base64url"),
                              },
                            },
                          ],
                        },
                      },
                    });
                  }
                  // metadata
                  return Promise.resolve({
                    data: {
                      id: "msg-101",
                      payload: {
                        headers: [
                          {
                            name: "From",
                            value: "Bob Builder <bob@builder.com>",
                          },
                          { name: "To", value: "Me <me@example.com>" },
                          {
                            name: "Subject",
                            value: "Project Blueprint Update",
                          },
                          {
                            name: "Date",
                            value: "Sun, 15 Feb 2026 14:00:00 +0000",
                          },
                          {
                            name: "Message-ID",
                            value: "<msg-101@builder.com>",
                          },
                        ],
                      },
                    },
                  });
                },
              ),
          },
          getProfile: vi.fn().mockResolvedValue({
            data: { historyId: "history-9999" },
          }),
        },
      } as unknown as ReturnType<typeof google.gmail>);

      // 3. Mock Calendar API
      const now = new Date();
      const pastStart = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();
      const pastEnd = new Date(now.getTime() - 1 * 3600 * 1000).toISOString();
      const futureStart = new Date(
        now.getTime() + 24 * 3600 * 1000,
      ).toISOString();
      const futureEnd = new Date(
        now.getTime() + 25 * 3600 * 1000,
      ).toISOString();
      const day = (days: number) =>
        new Date(now.getTime() + days * 24 * 3600 * 1000)
          .toISOString()
          .slice(0, 10);

      vi.spyOn(google, "calendar").mockReturnValue({
        events: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  id: "cal-past-event-1",
                  summary: "Past Blueprint Sync",
                  start: { dateTime: pastStart },
                  end: { dateTime: pastEnd },
                  attendees: [
                    { email: "bob@builder.com", displayName: "Bob Builder" },
                  ],
                },
                {
                  id: "cal-future-event-2",
                  summary: "Future Site Inspection",
                  start: { dateTime: futureStart },
                  end: { dateTime: futureEnd },
                  attendees: [
                    { email: "bob@builder.com", displayName: "Bob Builder" },
                  ],
                },
                {
                  id: "cal-all-day-3",
                  summary: "Site Holiday",
                  start: { date: day(3) },
                  end: { date: day(4) },
                  attendees: [{ email: "bob@builder.com" }],
                },
              ],
              nextSyncToken: "calendar-sync-token-v1",
            },
          }),
        },
      } as unknown as ReturnType<typeof google.calendar>);

      // 4. Mock AI Gateway for summary
      vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
      vi.spyOn(gateway, "generateFor").mockResolvedValue({
        text: "Bob sent the updated construction blueprint for review.",
        model: "test-model",
        tokenCount: 20,
        latencyMs: 40,
      } as gateway.AIGenerateResult);

      const isContactParticipant = (p: { email?: string }) =>
        p.email === "bob@builder.com";

      const ctx = {
        config: {
          syncContacts: true,
          syncEmail: true,
          syncCalendar: true,
          summaries: true,
          lookbackDays: 90,
          rollup: true,
          ghostThreshold: 3,
          maxMessagesPerRun: 5000,
          aliases: [],
        },
        secret: { refreshToken: "good-token", email: "me@example.com" },
        cursor: null,
        since: "2026-01-01T00:00:00.000Z",
        selfAddresses: { emails: ["me@example.com"], phones: [] },
        signal: new AbortController().signal,
        log: () => {},
        // The sync service always names the connector's owner
        // (scope.ownerId). A summary is checked against that owner's AI
        // switch, and is refused when no owner is named.
        accountId: "google-summary-owner",
        isContactParticipant,
      };

      const events: SyncEvent[] = [];
      const gen = googleAdapter.sync(ctx);
      let step = await gen.next();
      while (!step.done) {
        events.push(step.value);
        step = await gen.next();
      }

      const cursor = step.value as {
        contactsSyncToken: string;
        calendarSyncToken: string;
        gmailHistoryId: string;
        lastSyncAt: string;
      };
      expect(cursor).toEqual({
        contactsSyncToken: "contacts-sync-token-v1",
        contactsFields: PERSON_FIELDS,
        calendarSyncToken: "calendar-sync-token-v1",
        calendarListedAt: expect.any(String),
        gmailHistoryId: "history-9999",
        lastSyncAt: expect.any(String),
      });

      // Assert contact event
      const contacts = events.filter((e) => e.kind === "contact");
      expect(contacts).toHaveLength(1);
      expect(contacts[0].contact.name).toBe("Bob Builder");
      expect(contacts[0].contact.company).toBe("Builder Corp");

      // Assert interaction (email with AI summary)
      const interactions = events.filter((e) => e.kind === "interaction");
      const emailInt = interactions.find((i) => i.type === "email");
      expect(emailInt).toBeDefined();
      expect(emailInt!.title).toBe("Project Blueprint Update");
      expect(emailInt!.content).toBe(
        "Bob sent the updated construction blueprint for review.",
      );

      // Assert meeting interaction (past)
      const meetingInt = interactions.find((i) => i.type === "meeting");
      expect(meetingInt).toBeDefined();
      expect(meetingInt!.title).toBe("Past Blueprint Sync");

      // Assert upcoming event (future)
      const upcoming = events.filter((e) => e.kind === "upcoming");
      expect(upcoming).toHaveLength(2);
      expect(upcoming[0].title).toBe("Future Site Inspection");
      // An all-day event is its day, not midnight UTC, so it never shows on
      // the evening before west of UTC.
      expect(upcoming[1]).toMatchObject({
        startsAt: day(3),
        endsAt: day(4),
      });

      // Every call carries a timeout and the sync's signal. With neither, a
      // half-open connection held the sync and its slots until a restart.
      const options = (fn: unknown) =>
        (fn as Mock).mock.calls.map((call: unknown[]) => call[1]);
      const sent = [
        ...options(google.people(null!).people.connections.list),
        ...options(google.gmail(null!).users.messages.list),
        ...options(google.gmail(null!).users.messages.get),
        ...options(google.calendar(null!).events.list),
      ];
      expect(sent).toHaveLength(6);
      for (const option of sent) {
        expect(option).toEqual({
          timeout: GOOGLE_CALL_TIMEOUT_MS,
          signal: ctx.signal,
        });
      }
    });
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

  describe("Expired sync tokens", () => {
    it("runs a full People sync when the saved token has expired", async () => {
      // People answers an expired token with 400 EXPIRED_SYNC_TOKEN, not 410.
      const expired = Object.assign(new Error("Sync token is expired."), {
        status: 400,
        response: {
          status: 400,
          data: {
            error: { details: [{ reason: "EXPIRED_SYNC_TOKEN" }] },
          },
        },
      });
      const list = vi.fn(async (params: { syncToken?: string }) => {
        if (params.syncToken) throw expired;
        return {
          data: {
            connections: [
              {
                resourceName: "people/c1",
                names: [{ displayName: "Ada Lovelace" }],
              },
            ],
            nextSyncToken: "fresh-token",
          },
        };
      });
      vi.spyOn(google, "people").mockReturnValue({
        people: { connections: { list } },
      } as unknown as ReturnType<typeof google.people>);

      const gen = googleAdapter.sync({
        config: {
          syncContacts: true,
          syncEmail: false,
          syncCalendar: false,
          summaries: false,
          lookbackDays: 90,
          rollup: true,
          ghostThreshold: 3,
          maxMessagesPerRun: 5000,
          aliases: [],
        },
        secret: { refreshToken: "good-token" },
        cursor: {
          contactsSyncToken: "week-old-token",
          contactsFields: PERSON_FIELDS,
        },
        since: "2026-01-01T00:00:00.000Z",
        selfAddresses: { emails: [], phones: [] },
        signal: new AbortController().signal,
        log: () => {},
      });
      const events: SyncEvent[] = [];
      let step = await gen.next();
      while (!step.done) {
        events.push(step.value);
        step = await gen.next();
      }

      expect(events.filter((e) => e.kind === "contact")).toHaveLength(1);
      expect(step.value).toMatchObject({ contactsSyncToken: "fresh-token" });
      expect(list).toHaveBeenCalledTimes(2);
    });
  });

  describe("Correspondents Ignore", () => {
    it("POST /api/connectors/correspondents/ignore sets ignoredAt and filters from listCorrespondents", async () => {
      // Seed a connector and correspondent link
      const connId = crypto.randomUUID();
      sqlite
        .prepare(
          `INSERT INTO connectors (id, ownerId, kind, name, status, config, intervalMinutes, attempts, createdAt, updatedAt)
           VALUES (?, ?, 'google', 'Test Google Conn', 'active', '{}', 30, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .run(connId, memberActor.user.id);

      const targetEmail =
        "stranger-" + crypto.randomUUID().slice(0, 6) + "@example.com";
      sqlite
        .prepare(
          `INSERT INTO connector_links (connectorId, ownerId, kind, externalId, localId, seenCount, lastSeenAt)
           VALUES (?, ?, 'correspondent', ?, NULL, 2, CURRENT_TIMESTAMP)`,
        )
        .run(connId, memberActor.user.id, targetEmail);

      // Verify visible in listCorrespondents
      const beforeList = listCorrespondents(memberActor.scope);
      expect(beforeList.some((c) => c.email === targetEmail)).toBe(true);

      // Call ignore endpoint
      const res = await request(server)
        .post("/api/connectors/correspondents/ignore")
        .set("Cookie", memberActor.cookie)
        .send({
          connectorId: connId,
          externalId: targetEmail,
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.updated).toBe(true);

      // Verify hidden in listCorrespondents
      const afterList = listCorrespondents(memberActor.scope);
      expect(afterList.some((c) => c.email === targetEmail)).toBe(false);
    });
  });

  describe("Gmail cursor and filters, People deletions, Calendar attendees", () => {
    type GmailUsers = {
      history?: { list: Mock };
      messages?: { list?: Mock; get?: Mock };
      getProfile?: Mock;
    };

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

    function mockGmail(users: GmailUsers) {
      const get = vi.fn(({ id }: { id: string }) => Promise.resolve(meta(id)));
      vi.spyOn(google, "gmail").mockReturnValue({
        users: {
          history: users.history ?? { list: vi.fn() },
          messages: { list: vi.fn(), get, ...users.messages },
          getProfile:
            users.getProfile ??
            vi.fn().mockResolvedValue({ data: { historyId: "H-now" } }),
        },
      } as unknown as ReturnType<typeof google.gmail>);
      return get;
    }

    /** One sync of the stage(s) in `config`, from `cursor`. */
    async function run(
      config: Partial<Parameters<typeof googleAdapter.sync>[0]["config"]>,
      cursor: unknown = null,
      firstSince?: string,
    ) {
      const events: SyncEvent[] = [];
      const gen = googleAdapter.sync({
        config: {
          syncContacts: false,
          syncEmail: false,
          syncCalendar: false,
          summaries: false,
          lookbackDays: 90,
          rollup: true,
          ghostThreshold: 3,
          maxMessagesPerRun: 5000,
          aliases: [],
          ...config,
        },
        secret: { refreshToken: "good-token", email: "me@example.com" },
        cursor,
        since: "2026-02-01T00:00:00.000Z",
        firstSince,
        selfAddresses: { emails: ["me@example.com"], phones: [] },
        signal: new AbortController().signal,
        log: () => {},
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

    const emailIds = (events: SyncEvent[]) =>
      events.flatMap((e) =>
        e.kind === "interaction"
          ? [e.externalId.replace("google:gmail:", "").replace(/^<|>$/g, "")]
          : [],
      );

    const added = (...ids: string[]) => ids.map((id) => ({ message: { id } }));

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
        history: {
          list: vi
            .fn()
            .mockResolvedValue({ data: { historyId: "H2", history } }),
        },
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
      const get1 = mockGmail({ messages: { list: list1 } });
      get1.mockImplementation(({ id }: { id: string }) =>
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
        messages: { list: list2 },
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
      const day = 86_400_000;
      const since = 1769904000 * 1000;
      const dates: Record<string, number> = {
        m1: since + 14 * day,
        m2: since + 10 * day,
        m3: since + 1 * day,
        m4: since - 1 * day,
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
      const get = mockGmail({ messages: { list } });
      get.mockImplementation(({ id }: { id: string }) =>
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
      list.mockClear();
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

    it("reports a stage that failed while the others went on", async () => {
      vi.spyOn(google, "people").mockReturnValue({
        people: {
          connections: {
            list: vi.fn().mockResolvedValue({
              data: {
                connections: [
                  {
                    resourceName: "people/c1",
                    names: [{ displayName: "Ada Lovelace" }],
                  },
                ],
                nextSyncToken: "t1",
              },
            }),
          },
        },
      } as unknown as ReturnType<typeof google.people>);
      mockGmail({
        messages: {
          list: vi
            .fn()
            .mockRejectedValue(
              Object.assign(new Error("Backend Error"), { status: 500 }),
            ),
        },
      });
      const { events } = await run({ syncContacts: true, syncEmail: true });
      expect(events).toContainEqual({
        kind: "stage_failed",
        message: "Error syncing Gmail: Backend Error",
      });
      expect(events.some((e) => e.kind === "contact")).toBe(true);
    });

    it("skips spam, trash and drafts, and dates a mail by the mailbox when its Date header is far off", async () => {
      const get = mockGmail({
        history: {
          list: vi.fn().mockResolvedValue({
            data: {
              historyId: "H2",
              history: [
                {
                  id: "h1",
                  messagesAdded: [
                    { message: { id: "spam" } },
                    { message: { id: "trash" } },
                    { message: { id: "draft" } },
                    { message: { id: "ok" } },
                  ],
                },
              ],
            },
          }),
        },
      });
      get.mockImplementation(({ id }: { id: string }) =>
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

    it("lists messages again when the history id is gone (404 or 410)", async () => {
      for (const code of [404, 410]) {
        const list = vi
          .fn()
          .mockResolvedValue({ data: { messages: [{ id: "m1" }] } });
        mockGmail({
          history: {
            list: vi
              .fn()
              .mockRejectedValue(Object.assign(new Error("gone"), { code })),
          },
          messages: { list },
        });
        const { events, cursor } = await run(
          { syncEmail: true },
          { gmailHistoryId: "old" },
        );
        expect(emailIds(events)).toEqual(["m1@example.com"]);
        expect(cursor.gmailHistoryId).toBe("H-now");
      }
    });

    it("moves a first sync's date bound back even when the cap is filled by mail from one second", async () => {
      // Two mails in the same second fill a cap of 2. The bound was that
      // second plus one, the bound the run started from, so the next run
      // listed the same two mails again, run after run.
      const second = 1771160400;
      const get = mockGmail({
        messages: {
          list: vi.fn().mockResolvedValue({
            data: {
              messages: [{ id: "m1" }, { id: "m2" }],
              nextPageToken: "p2",
            },
          }),
        },
      });
      get.mockImplementation(({ id }: { id: string }) =>
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

    it("drops the ids of history pages read before the history id turned out to be gone", async () => {
      const list = vi.fn().mockResolvedValue({
        data: { messages: [{ id: "m9" }] },
      });
      mockGmail({
        history: {
          list: vi
            .fn()
            .mockResolvedValueOnce({
              data: {
                history: [
                  { id: "h1", messagesAdded: [{ message: { id: "m1" } }] },
                ],
                nextPageToken: "p2",
              },
            })
            .mockRejectedValueOnce(
              Object.assign(new Error("gone"), { code: 404 }),
            ),
        },
        messages: { list },
      });
      const { events } = await run(
        { syncEmail: true },
        { gmailHistoryId: "H1" },
      );
      expect(emailIds(events)).toEqual(["m9@example.com"]);
    });

    it("stops the sync when Google refuses the token while it reads a message", async () => {
      // Each failed message was logged and skipped, so an expired token
      // skipped the whole mailbox and moved the history id past it.
      const get = mockGmail({
        history: {
          list: vi.fn().mockResolvedValue({
            data: {
              historyId: "H2",
              history: [
                { id: "h1", messagesAdded: [{ message: { id: "m1" } }] },
              ],
            },
          }),
        },
      });
      get.mockRejectedValue(
        Object.assign(new Error("invalid_grant"), { code: 400 }),
      );
      await expect(
        run({ syncEmail: true }, { gmailHistoryId: "H1" }),
      ).rejects.toBeInstanceOf(ConnectorAuthError);
    });

    it("reports a person Google deleted, and keeps a person who has an address but no name", async () => {
      const list = vi.fn().mockResolvedValue({
        data: {
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
        },
      });
      vi.spyOn(google, "people").mockReturnValue({
        people: { connections: { list } },
      } as unknown as ReturnType<typeof google.people>);
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

      // A token made before the fields asked for `metadata` answers for the
      // old fields: it is dropped, and the run pulls everyone again.
      await run({ syncContacts: true }, { contactsSyncToken: "t1" });
      expect(list.mock.calls[1][0].syncToken).toBeUndefined();
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
    });

    it("maps a card's birthday, addresses, notes, links and labels to the contact", async () => {
      const list = vi.fn().mockResolvedValue({
        data: {
          connections: [
            {
              resourceName: "people/c1",
              names: [{ displayName: "Ana Lee" }],
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
              memberships: [
                {
                  contactGroupMembership: {
                    contactGroupResourceName: "contactGroups/friends",
                  },
                },
                {
                  contactGroupMembership: {
                    contactGroupResourceName: "contactGroups/starred",
                  },
                },
                {
                  contactGroupMembership: {
                    contactGroupResourceName: "contactGroups/1a2b3c",
                  },
                },
              ],
            },
          ],
        },
      });
      const groups = vi.fn().mockResolvedValue({
        data: {
          contactGroups: [
            {
              resourceName: "contactGroups/friends",
              name: "friends",
              formattedName: "Friends",
              groupType: "SYSTEM_CONTACT_GROUP",
            },
            {
              resourceName: "contactGroups/starred",
              name: "starred",
              formattedName: "Starred",
              groupType: "SYSTEM_CONTACT_GROUP",
            },
            {
              resourceName: "contactGroups/1a2b3c",
              name: "Book club",
              formattedName: "Book club",
              groupType: "USER_CONTACT_GROUP",
            },
          ],
        },
      });
      vi.spyOn(google, "people").mockReturnValue({
        people: { connections: { list } },
        contactGroups: { list: groups },
      } as unknown as ReturnType<typeof google.people>);

      const { events } = await run({ syncContacts: true });

      expect(events).toEqual([
        {
          kind: "contact",
          externalId: "people/c1",
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

    it("sends Google's letter tile as the card's placeholder, not as its photo", async () => {
      const tile = "https://lh3.googleusercontent.com/cm/ABC123=s100";
      vi.spyOn(google, "people").mockReturnValue({
        people: {
          connections: {
            list: vi.fn().mockResolvedValue({
              data: {
                connections: [
                  {
                    resourceName: "people/c1",
                    names: [{ displayName: "Ana Lee" }],
                    photos: [{ url: tile, default: true }],
                  },
                ],
              },
            }),
          },
        },
      } as unknown as ReturnType<typeof google.people>);

      const { events } = await run({ syncContacts: true });

      expect(events[0]).toMatchObject({ defaultPhotoUrl: tile });
      expect(events[0]).not.toHaveProperty("photoUrl", tile);
    });

    it("logs a meeting that ended since the last window once, though its token returns nothing, and lists 60 days ahead", async () => {
      const hour = 3600_000;
      const day = 24 * hour;
      const at = (offsetMs: number) =>
        new Date(Date.now() + offsetMs).toISOString();
      const listedAt = at(-2 * hour);
      const event = (id: string, start: number) => ({
        id,
        summary: id,
        start: { dateTime: at(start) },
        end: { dateTime: at(start + hour) },
        attendees: [{ email: "bob@example.com" }],
      });
      // The token returns a meeting added after it took place, and one that
      // changed and ended after the last window, which the window logs.
      type Query = { syncToken?: string; timeMin?: string; timeMax?: string };
      const list = vi.fn(async (params: Query) => ({
        data: params.syncToken
          ? {
              items: [
                event("added-late", -6 * hour),
                event("held", -90 * 60_000),
              ],
              nextSyncToken: "c2",
            }
          : { items: [event("held", -90 * 60_000), event("next", day)] },
      }));
      vi.spyOn(google, "calendar").mockReturnValue({
        events: { list },
      } as unknown as ReturnType<typeof google.calendar>);

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
        new Date(Date.parse(listedAt) - day).toISOString(),
      );
      expect(
        Date.parse(window.timeMax!) -
          Date.parse(cursor.calendarListedAt as string),
      ).toBe(60 * day);
      expect(cursor.calendarSyncToken).toBe("c2");
    });

    it("keeps no event of another type or of the owner alone, and no organizer that is a calendar or a robot", async () => {
      const at = (offsetMs: number) =>
        new Date(Date.now() + offsetMs).toISOString();
      const event = (id: string, extra: object) => ({
        id,
        summary: id,
        start: { dateTime: at(24 * 3600_000) },
        end: { dateTime: at(25 * 3600_000) },
        ...extra,
      });
      const bob = { attendees: [{ email: "bob@example.com" }] };
      vi.spyOn(google, "calendar").mockReturnValue({
        events: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                event("birthday", { ...bob, eventType: "birthday" }),
                event("focus", { ...bob, eventType: "focusTime" }),
                event("reminder", {
                  organizer: { email: "me@example.com", self: true },
                }),
                event("chore", {
                  organizer: { email: "family@group.calendar.google.com" },
                }),
                event("imported", {
                  ...bob,
                  organizer: { email: "unknownorganizer@calendar.google.com" },
                }),
                event("booking", {
                  ...bob,
                  organizer: { email: "noreply@bookings.example.com" },
                }),
                event("review", {
                  ...bob,
                  organizer: { email: "carol@example.com" },
                }),
              ],
              nextSyncToken: "c1",
            },
          }),
        },
      } as unknown as ReturnType<typeof google.calendar>);

      const { events } = await run({ syncCalendar: true });
      expect(
        events.flatMap((e) =>
          e.kind === "upcoming"
            ? [[e.title, e.participants.map((p) => p.email)]]
            : [],
        ),
      ).toEqual([
        ["imported", ["bob@example.com"]],
        ["booking", ["bob@example.com"]],
        ["review", ["bob@example.com", "carol@example.com"]],
      ]);
    });

    it("starts a stage with no place of its own at the lookback date, and forgets the place of a stage that is off", async () => {
      const firstSince = "2025-11-03T00:00:00.000Z";
      const messages = vi.fn().mockResolvedValue({ data: {} });
      mockGmail({ messages: { list: messages } });
      const events = vi
        .fn()
        .mockResolvedValue({ data: { nextSyncToken: "c1" } });
      vi.spyOn(google, "calendar").mockReturnValue({
        events: { list: events },
      } as unknown as ReturnType<typeof google.calendar>);

      const { cursor } = await run(
        { syncEmail: true, syncCalendar: true },
        {
          lastSyncAt: "2026-02-01T00:00:00.000Z",
          contactsSyncToken: "p1",
          contactsFields: PERSON_FIELDS,
        },
        firstSince,
      );
      expect(messages.mock.calls[0][0].q).toBe(
        `after:${Date.parse(firstSince) / 1000}`,
      );
      expect(events.mock.calls[0][0].timeMin).toBe(firstSince);
      expect(cursor.contactsSyncToken).toBeUndefined();
    });

    it("drops rooms and attendees who declined, and any meeting the owner declined", async () => {
      const hour = 3600_000;
      const at = (offsetMs: number) =>
        new Date(Date.now() + offsetMs).toISOString();
      const event = (id: string, start: number, selfStatus: string) => ({
        id,
        summary: id,
        start: { dateTime: at(start) },
        end: { dateTime: at(start + hour) },
        attendees: [
          { email: "me@example.com", self: true, responseStatus: selfStatus },
          { email: "bob@example.com", responseStatus: "accepted" },
          {
            email: "room-4@resource.calendar.google.com",
            resource: true,
            displayName: "Room 4",
          },
          { email: "carol@example.com", responseStatus: "declined" },
        ],
      });
      vi.spyOn(google, "calendar").mockReturnValue({
        events: {
          list: vi.fn().mockResolvedValue({
            data: {
              items: [
                event("past-ok", -3 * hour, "accepted"),
                event("past-declined", -5 * hour, "declined"),
                event("future-declined", 24 * hour, "declined"),
              ],
              nextSyncToken: "c2",
            },
          }),
        },
      } as unknown as ReturnType<typeof google.calendar>);

      const { events } = await run({ syncCalendar: true });
      expect(events).toEqual([
        expect.objectContaining({
          kind: "interaction",
          externalId: "google:calendar:past-ok",
          participants: [
            { email: "me@example.com", name: undefined },
            { email: "bob@example.com", name: undefined },
          ],
        }),
        { kind: "upcoming_listed" },
      ]);
    });
  });
});
