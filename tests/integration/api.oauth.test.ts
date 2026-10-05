/**
 * tests/integration/api.oauth.test.ts — OAuth sign-in for MCP clients.
 *
 * Tests:
 * - the MCP SDK client finds the sign-in from a 401 alone, registers,
 *   is approved read only, and then sees only the read tools
 * - a client known by its metadata document shows its host, gets write
 *   access, and Account's revoke disconnects it
 * - refresh tokens rotate, and a reused one ends the grant
 * - every refusal: a bad client or redirect, PKCE, a code used twice, a
 *   foreign resource, a token on another route, a denial, OAuth off
 *
 * @module tests/integration/api.oauth.test
 */

import crypto from "crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import type http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  asUser,
  createActor,
  resetAccounts,
  type Actor,
} from "./tenancy/helpers.ts";
import { MCP_TOOLS } from "../../shared/mcpTools.ts";
import { __resetOAuthRateLimits } from "../../server/routes/oauth.ts";

/** The metadata document of a client that is known by its URL. */
const DOCUMENT_CLIENT = "https://client.test/oauth/metadata.json";
const DOCUMENT_REDIRECT = "https://client.test/callback";

vi.mock("../../server/utils/urlSafety.ts", async (original) => ({
  ...(await original<typeof import("../../server/utils/urlSafety.ts")>()),
  safeFetch: vi.fn(async (url: string) => {
    if (url !== DOCUMENT_CLIENT) throw new Error(`unexpected fetch ${url}`);
    const body = JSON.stringify({
      client_id: DOCUMENT_CLIENT,
      client_name: "Doc Assistant",
      // The second is on another host, which the document can list but
      // this server never sends an error to.
      redirect_uris: [DOCUMENT_REDIRECT, "https://elsewhere.test/cb"],
      token_endpoint_auth_method: "none",
    });
    return {
      response: new Response(body, {
        headers: { "cache-control": "max-age=300" },
      }),
      finalUrl: url,
    };
  }),
}));

const READ_TOOLS = MCP_TOOLS.filter((t) => t.effect === "read").map(
  (t) => t.name,
);

/** A PKCE pair. */
function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

/** An MCP client's OAuth state, held in memory as a real client would. */
class TestProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  authUrl?: URL;
  readonly redirectUrl = "http://127.0.0.1:43123/callback";
  get clientMetadata() {
    return {
      client_name: "Test Assistant",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation = () => this.info;
  saveClientInformation = (info: OAuthClientInformationMixed) => {
    this.info = info;
  };
  tokens = () => this.saved;
  saveTokens = (tokens: OAuthTokens) => {
    this.saved = tokens;
  };
  redirectToAuthorization = (url: URL) => {
    this.authUrl = url;
  };
  saveCodeVerifier = (verifier: string) => {
    this.verifier = verifier;
  };
  codeVerifier = () => this.verifier;
}

describe("OAuth for MCP clients", () => {
  let server: http.Server;
  let origin: string;
  let actor: Actor;

  const mcp = (bearer?: string) => {
    const req = request(server)
      .post("/api/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    return bearer ? req.set("Authorization", `Bearer ${bearer}`) : req;
  };

  const tokenCall = (form: Record<string, string>) =>
    request(server).post("/oauth/token").type("form").send(form);

  /** Open an authorize URL, approve it as the actor, return the callback. */
  async function approve(
    authorizeUrl: string,
    access: "read" | "write",
  ): Promise<URL> {
    const start = await request(server).get(authorizeUrl);
    expect(start.status).toBe(303);
    const id = new URL(start.headers.location, origin).searchParams.get(
      "request",
    )!;
    const decided = await asUser(actor)(
      request(server)
        .post(`/api/auth/oauth/requests/${id}`)
        .send({ decision: "allow", access }),
    );
    expect(decided.status).toBe(200);
    return new URL(decided.body.redirectTo);
  }

  /** Authorize a document client by hand. */
  function documentAuthorize(challenge: string, extra = "") {
    return (
      `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(DOCUMENT_CLIENT)}` +
      `&redirect_uri=${encodeURIComponent(DOCUMENT_REDIRECT)}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&state=s1${extra}`
    );
  }

  async function documentTokens(access: "read" | "write") {
    const { verifier, challenge } = pkce();
    const back = await approve(documentAuthorize(challenge), access);
    const code = back.searchParams.get("code")!;
    const res = await tokenCall({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: DOCUMENT_REDIRECT,
      client_id: DOCUMENT_CLIENT,
    });
    return { res, code, verifier, back };
  }

  beforeAll(async () => {
    resetAccounts();
    process.env.AUTH_REQUIRED = "true";
    server = makeTestApp();
    if (!server.listening) {
      await new Promise((resolve) => server.once("listening", resolve));
    }
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.PUBLIC_URL = origin;
    actor = await createActor(server, { username: "olivia" });
  });

  beforeEach(() => __resetOAuthRateLimits());

  afterAll(() => {
    delete process.env.PUBLIC_URL;
    process.env.AUTH_REQUIRED = "";
    resetAccounts();
  });

  it("the SDK client finds the sign-in from a 401, and a read-only grant sees only the read tools", async () => {
    const provider = new TestProvider();
    const endpoint = new URL(`${origin}/api/mcp`);
    const first = new StreamableHTTPClientTransport(endpoint, {
      authProvider: provider,
    });
    await expect(
      new Client({ name: "t", version: "1" }).connect(first),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.authUrl?.searchParams.get("resource")).toBe(
      `${origin}/api/mcp`,
    );

    const back = await approve(
      provider.authUrl!.pathname + provider.authUrl!.search,
      "read",
    );
    expect(back.searchParams.get("iss")).toBe(origin);
    await first.finishAuth(back.searchParams.get("code")!);

    const client = new Client({ name: "t", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, { authProvider: provider }),
    );
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names.sort()).toEqual([...READ_TOOLS].sort());
    await client.close();

    const list = await asUser(actor)(request(server).get("/api/auth/tokens"));
    expect(list.body.tokens).toContainEqual(
      expect.objectContaining({
        kind: "oauth",
        name: "Test Assistant",
        readOnly: true,
        // A registered client is shown by where it sends the browser back.
        tokenPrefix: "this computer",
      }),
    );
    // An access token reaches the MCP endpoint and nothing else.
    const elsewhere = await request(server)
      .get("/api/contacts")
      .set("Authorization", `Bearer ${provider.saved!.access_token}`);
    expect(elsewhere.status).toBe(401);
  });

  it("a document client shows its host, writes, rotates its refresh token, and a reuse ends it", async () => {
    const { verifier, challenge } = pkce();
    const start = await request(server).get(documentAuthorize(challenge));
    const id = new URL(start.headers.location, origin).searchParams.get(
      "request",
    )!;
    const shown = await asUser(actor)(
      request(server).get(`/api/auth/oauth/requests/${id}`),
    );
    expect(shown.body).toMatchObject({
      client: { name: "Doc Assistant", host: "client.test", verified: true },
      redirect: { host: "client.test", kind: "web" },
      canWrite: true,
    });
    const decided = await asUser(actor)(
      request(server)
        .post(`/api/auth/oauth/requests/${id}`)
        .send({ decision: "allow", access: "write" }),
    );
    const back = new URL(decided.body.redirectTo);
    expect(back.searchParams.get("state")).toBe("s1");
    const first = await tokenCall({
      grant_type: "authorization_code",
      code: back.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: DOCUMENT_REDIRECT,
      client_id: DOCUMENT_CLIENT,
    });
    expect(first.body.scope).toBe("contrack:read contrack:write");
    const all = await mcp(first.body.access_token);
    expect(all.text).toContain("create_contact");

    // Rotate, use the new pair, then send the first refresh token again.
    const rotated = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: DOCUMENT_CLIENT,
      // A scheme and a host match in any case.
      resource: `${origin.toUpperCase()}/api/mcp/`,
    });
    expect(rotated.status).toBe(200);
    expect((await mcp(rotated.body.access_token)).status).toBe(200);
    // A second process with the same login, within a minute: a fresh pair.
    const twin = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: DOCUMENT_CLIENT,
    });
    expect(twin.status).toBe(200);
    // Later, the old token is someone else's, and the grant ends.
    sqlite
      .prepare(
        `UPDATE oauth_tokens SET usedAt = datetime('now', '-2 minutes')
          WHERE usedAt IS NOT NULL AND kind = 'refresh'`,
      )
      .run();
    const reused = await tokenCall({
      grant_type: "refresh_token",
      refresh_token: first.body.refresh_token,
      client_id: DOCUMENT_CLIENT,
    });
    expect(reused.body.error).toBe("invalid_grant");
    expect((await mcp(rotated.body.access_token)).status).toBe(401);

    // A fresh grant, disconnected from the token list.
    const again = await documentTokens("write");
    const rows = await asUser(actor)(request(server).get("/api/auth/tokens"));
    const grant = rows.body.tokens.find(
      (t: { kind: string; revokedAt: string | null; tokenPrefix: string }) =>
        t.kind === "oauth" && !t.revokedAt && t.tokenPrefix === "client.test",
    );
    await asUser(actor)(request(server).delete(`/api/auth/tokens/${grant.id}`));
    const after = await mcp(again.res.body.access_token);
    expect(after.status).toBe(401);
    expect(after.headers["www-authenticate"]).toContain(
      `resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
    );
  });

  it("publishes its metadata, and refuses every request it cannot trust", async () => {
    const meta = await request(server).get(
      "/.well-known/oauth-authorization-server",
    );
    expect(meta.body).toMatchObject({
      issuer: origin,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(meta.headers["access-control-allow-origin"]).toBe("*");
    const prm = await request(server).get(
      "/.well-known/oauth-protected-resource/api/mcp",
    );
    expect(prm.body.resource).toBe(`${origin}/api/mcp`);

    const { challenge } = pkce();
    // Nothing redirects to a client or an address that is not known good.
    for (const [query, problem] of [
      [
        documentAuthorize(challenge).replace(
          encodeURIComponent(DOCUMENT_REDIRECT),
          encodeURIComponent("https://evil.test/cb"),
        ),
        "bad_redirect",
      ],
      [
        "/oauth/authorize?client_id=ctc_nobody&redirect_uri=x",
        "unknown_client",
      ],
      [
        documentAuthorize(challenge).replace(
          "state=s1",
          `state=${"s".repeat(600)}`,
        ),
        "bad_request",
      ],
    ]) {
      const res = await request(server).get(query);
      expect(res.headers.location).toBe(`/oauth/consent?error=${problem}`);
    }
    // A bad parameter for an address off the document's host stays here.
    const offHost = await request(server).get(
      documentAuthorize(challenge)
        .replace("S256", "plain")
        .replace(
          encodeURIComponent(DOCUMENT_REDIRECT),
          encodeURIComponent("https://elsewhere.test/cb"),
        ),
    );
    expect(offHost.headers.location).toBe("/oauth/consent?error=bad_request");
    // The document's own host hears about it, with the issuer.
    const plain = await request(server).get(
      documentAuthorize(challenge).replace("S256", "plain"),
    );
    expect(plain.headers.location).toMatch(
      /^https:\/\/client\.test\/callback\?error=invalid_request/,
    );
    expect(new URL(plain.headers.location).searchParams.get("iss")).toBe(
      origin,
    );

    // A denial goes back as access_denied.
    const started = await request(server).get(documentAuthorize(challenge));
    const id = new URL(started.headers.location, origin).searchParams.get(
      "request",
    );
    const denied = await asUser(actor)(
      request(server)
        .post(`/api/auth/oauth/requests/${id}`)
        .send({ decision: "deny" }),
    );
    expect(denied.body.redirectTo).toContain("error=access_denied");

    // A wrong verifier, a code used twice, a foreign resource.
    const good = await documentTokens("read");
    expect(good.res.status).toBe(200);
    const twice = await tokenCall({
      grant_type: "authorization_code",
      code: good.code,
      code_verifier: good.verifier,
      redirect_uri: DOCUMENT_REDIRECT,
      client_id: DOCUMENT_CLIENT,
    });
    expect(twice.body.error).toBe("invalid_grant");
    // The code came back, so the grant it made is gone.
    expect((await mcp(good.res.body.access_token)).status).toBe(401);
    const { verifier: other, challenge: c2 } = pkce();
    const back = await approve(documentAuthorize(c2), "read");
    for (const [form, error] of [
      [{ code_verifier: pkce().verifier }, "invalid_grant"],
      [
        { code_verifier: other, resource: "https://elsewhere.test/mcp" },
        "invalid_target",
      ],
    ] as const) {
      const res = await tokenCall({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        redirect_uri: DOCUMENT_REDIRECT,
        client_id: DOCUMENT_CLIENT,
        ...form,
      });
      expect(res.body.error).toBe(error);
    }

    // Registration takes only redirects that cannot be hijacked, and a
    // loopback redirect matches on any port.
    const evil = await request(server)
      .post("/oauth/register")
      .send({ redirect_uris: ["http://evil.test/cb"] });
    expect(evil.body.error).toBe("invalid_redirect_uri");
    const cli = await request(server)
      .post("/oauth/register")
      .send({ client_name: "CLI", redirect_uris: ["http://localhost/cb"] });
    const loopback = await request(server).get(
      `/oauth/authorize?response_type=code&client_id=${cli.body.client_id}` +
        `&redirect_uri=${encodeURIComponent("http://localhost:51234/cb")}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    expect(loopback.headers.location).toMatch(/^\/oauth\/consent\?request=/);
    // A registered client's bad request stays here: it could be anyone's, and
    // an error redirect would send the browser wherever it registered.
    const wrongType = await request(server).get(
      `/oauth/authorize?response_type=token&client_id=${cli.body.client_id}` +
        `&redirect_uri=${encodeURIComponent("http://localhost:51234/cb")}` +
        `&code_challenge=${challenge}&code_challenge_method=S256`,
    );
    expect(wrongType.headers.location).toBe("/oauth/consent?error=bad_request");

    // Off without PUBLIC_URL: 404s, and a 401 with no metadata to follow.
    delete process.env.PUBLIC_URL;
    try {
      const off = await request(server).get(
        "/.well-known/oauth-authorization-server",
      );
      expect(off.status).toBe(404);
      expect(off.body.error).toBe("not_found");
      expect((await mcp()).headers["www-authenticate"]).toBe(
        'Bearer realm="contrack"',
      );
    } finally {
      process.env.PUBLIC_URL = origin;
    }
  });
});
