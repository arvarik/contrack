import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";

vi.mock("../../server/utils/urlSafety.ts", async (original) => {
  const mod =
    await original<typeof import("../../server/utils/urlSafety.ts")>();
  return { ...mod, safeFetch: vi.fn(mod.safeFetch) };
});

import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { safeFetch } from "../../server/utils/urlSafety.ts";
import { setOidcConfig } from "../../server/services/integrationSettings.ts";
import {
  startOidc,
  finishOidc,
  forgetOidcDiscovery,
  takeOidcFlow,
  safeReturnTo,
} from "../../server/services/oidcService.ts";
import { startFakeProvider } from "./oidcProvider.ts";

makeTestApp();
const REDIRECT = "https://crm.example.com/api/auth/oidc/callback";
let idp: Awaited<ReturnType<typeof startFakeProvider>>;

beforeAll(async () => {
  idp = await startFakeProvider();
});
afterAll(() => idp.close());
beforeEach(() => {
  sqlite.exec("DELETE FROM auth_challenges WHERE kind = 'oidc'");
  forgetOidcDiscovery();
  vi.mocked(safeFetch).mockClear();
  setOidcConfig({
    issuer: idp.issuer,
    clientId: "contrack",
    clientSecret: "secret",
    name: "Test IdP",
    matchByEmail: true,
  });
});

type Started = Awaited<ReturnType<typeof startOidc>>;

/** Start a flow, and let the fake provider read its authorization URL. */
async function start(
  input: { remember?: boolean; returnTo?: string } = {},
): Promise<Started> {
  const started = await startOidc({
    redirectUri: REDIRECT,
    linkUserId: null,
    ...input,
  });
  idp.remember(started.url);
  return started;
}

/** Consume a flow and finish it, as the callback does. */
function finish({ state, binding }: Started) {
  const flow = takeOidcFlow(state, binding);
  expect(flow).not.toBeNull();
  return finishOidc(new URL(`${REDIRECT}?code=abc&state=${state}`), flow!);
}

describe("oidcService", () => {
  it("builds a PKCE authorization URL and stores the flow", async () => {
    const before = Date.now();
    const url = new URL(
      (await startOidc({ redirectUri: REDIRECT, linkUserId: null })).url,
    );
    expect(url.origin + url.pathname).toBe(`${idp.issuer}/authorize`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    const rows = sqlite
      .prepare("SELECT * FROM auth_challenges WHERE kind = 'oidc'")
      .all() as { id: string; expiresAt: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(url.searchParams.get("state"));
    const ttl = new Date(rows[0].expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(10 * 60 * 1000);
    expect(ttl).toBeLessThan(10 * 60 * 1000 + 5_000);
    expect(vi.mocked(safeFetch)).toHaveBeenCalledWith(
      `${idp.issuer}/.well-known/openid-configuration`,
      expect.objectContaining({ allowPrivate: true }),
    );
  });

  it("asks the provider again once its discovery is an hour old", async () => {
    const discoveries = () =>
      vi
        .mocked(safeFetch)
        .mock.calls.filter(([u]) =>
          String(u).endsWith("/.well-known/openid-configuration"),
        ).length;
    const start = () => startOidc({ redirectUri: REDIRECT, linkUserId: null });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await start();
      vi.setSystemTime(Date.now() + 59 * 60 * 1000);
      await start();
      expect(discoveries()).toBe(1);
      vi.setSystemTime(Date.now() + 2 * 60 * 1000);
      await start();
      expect(discoveries()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns validated claims once, then refuses the replay", async () => {
    const flow = await start();
    idp.nextLogin({
      sub: "sub-1",
      email: "Ada@Example.com",
      email_verified: true,
    });
    vi.mocked(safeFetch).mockClear();
    await expect(finish(flow)).resolves.toEqual({
      issuer: idp.issuer,
      subject: "sub-1",
      email: "Ada@Example.com",
      emailVerified: true,
    });
    // The token exchange went through safeFetch, with the secret in HTTP
    // Basic (client_secret_basic), not in the body.
    const [, token] = vi
      .mocked(safeFetch)
      .mock.calls.find(([u]) => u === `${idp.issuer}/token`)!;
    expect(token?.headers?.authorization).toBe(
      `Basic ${Buffer.from("contrack:secret").toString("base64")}`,
    );
    expect(token?.body).not.toContain("client_secret");
    expect(takeOidcFlow(flow.state, flow.binding)).toBeNull();
  });

  it("keeps the remember choice and only a same-origin return path in the flow", async () => {
    const take = async (input: { remember?: boolean; returnTo?: string }) => {
      const { state, binding } = await start(input);
      return takeOidcFlow(state, binding);
    };
    expect(await take({})).toMatchObject({
      remember: true,
      returnTo: null,
      userId: null,
      expired: false,
    });
    expect(
      await take({ remember: false, returnTo: "/contacts/abc?x=1" }),
    ).toMatchObject({ remember: false, returnTo: "/contacts/abc?x=1" });
    expect(await take({ returnTo: "//evil.com" })).toMatchObject({
      returnTo: null,
    });
  });

  it("marks a flow past its ten minutes expired", async () => {
    const flow = await start();
    sqlite
      .prepare("UPDATE auth_challenges SET expiresAt = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), flow.state);
    expect(takeOidcFlow(flow.state, flow.binding)?.expired).toBe(true);
  });

  it("accepts only a path on this origin as the return path", () => {
    expect(safeReturnTo("/contacts/abc?x=1")).toBe("/contacts/abc?x=1");
    expect(safeReturnTo("/")).toBe("/");
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "/contacts\nLocation: x",
      "/a\u0000b",
      "contacts",
      "",
      `/${"a".repeat(2048)}`,
      42,
      null,
    ]) {
      expect(safeReturnTo(bad), String(bad)).toBeNull();
    }
  });

  it("refuses a token with the wrong nonce", async () => {
    const flow = await start();
    idp.nextLogin({ sub: "sub-1", nonce: "not-the-one" });
    await expect(finish(flow)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('"nonce"') },
    });
  });

  it("does not follow a redirect from the token endpoint", async () => {
    const flow = await start();
    idp.nextLogin({ sub: "sub-1" });
    const stolen = `${idp.issuer}/stolen-token`;
    idp.redirectNextToken(stolen);
    await expect(finish(flow)).rejects.toBeInstanceOf(Error);
    expect(idp.requests).toContain("/token");
    expect(idp.requests).not.toContain("/stolen-token");
    expect(vi.mocked(safeFetch).mock.calls.map(([u]) => u)).not.toContain(
      stolen,
    );
  });

  it("refuses an ID token signed with a key the provider does not publish", async () => {
    const flow = await start();
    idp.nextLogin({ sub: "sub-1" });
    idp.signNextWithUnpublishedKey();
    vi.mocked(safeFetch).mockClear();
    await expect(finish(flow)).rejects.toMatchObject({
      cause: { message: "JWT signature verification failed" },
    });
    // The keys came through safeFetch, which followed no redirect.
    expect(vi.mocked(safeFetch)).toHaveBeenCalledWith(
      `${idp.issuer}/jwks`,
      expect.objectContaining({ redirect: "manual", allowPrivate: true }),
    );
  });

  it("stores an email of only spaces as no email", async () => {
    const flow = await start();
    idp.nextLogin({ sub: "sub-1", email: "   ", email_verified: true });
    await expect(finish(flow)).resolves.toMatchObject({ email: null });
  });

  it("reads the email from userinfo when the ID token has none", async () => {
    const flow = await start();
    idp.nextLogin({
      sub: "sub-1",
      userinfo: { email: "Ada@Example.com", email_verified: true },
    });
    vi.mocked(safeFetch).mockClear();
    await expect(finish(flow)).resolves.toMatchObject({
      email: "Ada@Example.com",
      emailVerified: true,
    });
    expect(vi.mocked(safeFetch)).toHaveBeenCalledWith(
      `${idp.issuer}/userinfo`,
      expect.objectContaining({ allowPrivate: true }),
    );
  });

  it("is 404 without a provider", async () => {
    setOidcConfig(null);
    await expect(
      startOidc({ redirectUri: REDIRECT, linkUserId: null }),
    ).rejects.toMatchObject({ statusCode: 404, code: "OIDC_NOT_CONFIGURED" });
  });
});
