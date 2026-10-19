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

describe("oidcService", () => {
  it("builds a PKCE authorization URL and stores the flow", async () => {
    const before = Date.now();
    const url = new URL(
      await startOidc({ redirectUri: REDIRECT, linkUserId: null }),
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

  it("returns validated claims once, then refuses the replay", async () => {
    const { state } = idp.remember(
      await startOidc({ redirectUri: REDIRECT, linkUserId: null }),
    );
    idp.nextLogin({
      sub: "sub-1",
      email: "Ada@Example.com",
      email_verified: true,
    });
    const callback = `${REDIRECT}?code=abc&state=${state}`;
    vi.mocked(safeFetch).mockClear();
    await expect(finishOidc(callback)).resolves.toEqual({
      issuer: idp.issuer,
      subject: "sub-1",
      email: "ada@example.com",
      emailVerified: true,
      linkUserId: null,
    });
    // The token exchange went through safeFetch.
    expect(vi.mocked(safeFetch).mock.calls.map(([u]) => u)).toContain(
      `${idp.issuer}/token`,
    );
    await expect(finishOidc(callback)).rejects.toMatchObject({
      statusCode: 410,
      code: "OIDC_EXPIRED",
    });
  });

  it("refuses a token with the wrong nonce", async () => {
    const { state } = idp.remember(
      await startOidc({ redirectUri: REDIRECT, linkUserId: null }),
    );
    idp.nextLogin({ sub: "sub-1", nonce: "not-the-one" });
    await expect(
      finishOidc(`${REDIRECT}?code=abc&state=${state}`),
    ).rejects.toMatchObject({
      cause: { message: expect.stringContaining('"nonce"') },
    });
  });

  it("is 404 without a provider", async () => {
    setOidcConfig(null);
    await expect(
      startOidc({ redirectUri: REDIRECT, linkUserId: null }),
    ).rejects.toMatchObject({ statusCode: 404, code: "OIDC_NOT_CONFIGURED" });
  });
});
