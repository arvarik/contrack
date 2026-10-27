// A minimal OpenID provider for tests: discovery, an authorize endpoint that
// sends a browser straight back, JWKS, a token endpoint that signs an ID token
// for whatever the test queued with `nextLogin`, and a userinfo endpoint. The
// token endpoint takes only the method it advertises, client_secret_basic.
// It can also fail userinfo once, or stall a token answer once.

import http from "node:http";
import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

/** The error description in a failed userinfo answer, which no log may carry. */
export const USERINFO_FAILURE = "the userinfo store is down";

export interface FakeLogin {
  sub: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string; // defaults to the nonce from the last authorize URL
  /** Served from /userinfo only. The ID token then carries no email. */
  userinfo?: { email: string; email_verified: boolean };
}

export async function startFakeProvider() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  // Never published: an ID token signed with it must be refused.
  const rogue = await generateKeyPair("RS256");
  let signWithRogueKey = false;
  const idp = express.Router();
  idp.use(express.urlencoded({ extended: false }));
  let next: FakeLogin | null = null;
  let issuer = "";
  let clientId = "contrack";
  let lastNonce = "";
  let signedIn: FakeLogin | null = null;
  let tokenRedirect: string | null = null;
  const requests: string[] = [];
  let tokenRedirectUri: string | null = null;
  let denyNext = false;
  let failUserinfo = false;
  let stallToken = false;
  idp.use((req, _res, proceed) => {
    requests.push(req.path);
    proceed();
  });

  idp.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      userinfo_endpoint: `${issuer}/userinfo`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
  });
  // Signs nobody in by itself: it returns a code at once, or the refusal
  // `denyNextAuthorize` queued.
  idp.get("/authorize", (req, res) => {
    const back = new URL(String(req.query.redirect_uri));
    back.searchParams.set("state", String(req.query.state ?? ""));
    back.searchParams.set(
      denyNext ? "error" : "code",
      denyNext ? "access_denied" : "code",
    );
    lastNonce = String(req.query.nonce ?? "");
    denyNext = false;
    res.redirect(back.href);
  });
  idp.get("/jwks", (_req, res) => {
    res.json({ keys: [jwk] });
  });
  idp.get("/userinfo", (_req, res) => {
    if (failUserinfo) {
      failUserinfo = false;
      res
        .status(500)
        .json({ error: "server_error", error_description: USERINFO_FAILURE });
      return;
    }
    res.json({ sub: signedIn?.sub, ...signedIn?.userinfo });
  });
  idp.post("/token", async (req, res) => {
    const basic = req.headers.authorization?.startsWith("Basic ");
    if (!basic || req.body?.client_secret !== undefined) {
      res.status(401).json({
        error: "invalid_client",
        error_description: "Only client_secret_basic is supported",
      });
      return;
    }
    tokenRedirectUri = req.body?.redirect_uri ?? null;
    if (stallToken) {
      // The headers at once, then a body that never ends.
      stallToken = false;
      res.writeHead(200, { "content-type": "application/json" });
      res.write("{");
      return;
    }
    if (tokenRedirect) {
      res.redirect(307, tokenRedirect);
      tokenRedirect = null;
      return;
    }
    if (!next) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    const login = next;
    next = null;
    signedIn = login;
    const idToken = await new SignJWT({
      ...(!login.userinfo && {
        email: login.email,
        email_verified: login.email_verified,
      }),
      nonce: login.nonce ?? lastNonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(login.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(signWithRogueKey ? rogue.privateKey : privateKey);
    signWithRogueKey = false;
    res.json({
      access_token: "at",
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken,
    });
  });

  const app = express();
  app.use(idp);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  issuer = `http://127.0.0.1:${port}`;

  return {
    issuer,
    setClientId(id: string) {
      clientId = id;
    },
    /** Queue the account the next code exchange signs in. */
    nextLogin(login: FakeLogin) {
      next = login;
    },
    /** Answer the next authorize request with error=access_denied. */
    denyNextAuthorize() {
      denyNext = true;
    },
    /** Sign the next ID token with a key the JWKS does not publish. */
    signNextWithUnpublishedKey() {
      signWithRogueKey = true;
    },
    /** Answer the next userinfo request with a 500 whose body says USERINFO_FAILURE. */
    failNextUserinfo() {
      failUserinfo = true;
    },
    /** Answer the next token request with headers and a body that never ends. */
    stallNextToken() {
      stallToken = true;
    },
    /** Answer the next token request with a 307 to `location`. */
    redirectNextToken(location: string) {
      tokenRedirect = location;
    },
    /** The redirect_uri of the last token request. */
    tokenRedirectUri: () => tokenRedirectUri,
    /** Paths the provider was asked for, in order. */
    requests,
    /** Read state and nonce from an authorize URL Contrack produced. */
    remember(authorizeUrl: string) {
      const url = new URL(authorizeUrl);
      lastNonce = url.searchParams.get("nonce") ?? "";
      return { state: url.searchParams.get("state") ?? "" };
    },
    close: () =>
      new Promise<void>((resolve) => {
        // A stalled answer keeps its socket open.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
