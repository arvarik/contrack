/**
 * tests/integration/connectors.google.test.ts — Integration tests for Google Workspace adapter & OAuth.
 *
 * Covers:
 * - Admin integrations setting for Google OAuth (env overrides, clearing)
 * - OAuth start and callback routes with PKCE and state verification
 * - Google adapter test() and sync() with mocked googleapis boundary
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
    async function signInWithGoogle(email: string, refreshToken?: string) {
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
              scope: "https://www.googleapis.com/auth/gmail.readonly",
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
                  start: { date: "2099-01-05" },
                  end: { date: "2099-01-06" },
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
        calendarSyncToken: "calendar-sync-token-v1",
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
        startsAt: "2099-01-05",
        endsAt: "2099-01-06",
      });

      // Every call carries a timeout and the sync's signal. With neither, a
      // half-open connection held the sync and its slots until a restart.
      const options = (fn: unknown) =>
        (fn as Mock).mock.calls.map((call: unknown[]) => call[1]);
      const sent = [
        ...options(google.people("v1").people.connections.list),
        ...options(google.gmail("v1").users.messages.list),
        ...options(google.gmail("v1").users.messages.get),
        ...options(google.calendar("v3").events.list),
      ];
      expect(sent).toHaveLength(5);
      for (const option of sent) {
        expect(option).toEqual({
          timeout: GOOGLE_CALL_TIMEOUT_MS,
          signal: ctx.signal,
        });
      }
    });
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
        cursor: { contactsSyncToken: "week-old-token" },
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
});
