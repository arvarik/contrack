// A minimal OpenID provider for tests: discovery, JWKS, and a token endpoint
// that signs an ID token for whatever the test queued with `nextLogin`.

import http from "node:http";
import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

export interface FakeLogin {
  sub: string;
  email?: string;
  email_verified?: boolean;
  nonce?: string; // defaults to the nonce from the last authorize URL
}

export async function startFakeProvider() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const idp = express.Router();
  idp.use(express.urlencoded({ extended: false }));
  let next: FakeLogin | null = null;
  let issuer = "";
  let clientId = "contrack";
  let lastNonce = "";

  idp.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic"],
    });
  });
  idp.get("/jwks", (_req, res) => {
    res.json({ keys: [jwk] });
  });
  idp.post("/token", async (_req, res) => {
    if (!next) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    const login = next;
    next = null;
    const idToken = await new SignJWT({
      email: login.email,
      email_verified: login.email_verified,
      nonce: login.nonce ?? lastNonce,
    })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(login.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
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
    /** Read state and nonce from an authorize URL Contrack produced. */
    remember(authorizeUrl: string) {
      const url = new URL(authorizeUrl);
      lastNonce = url.searchParams.get("nonce") ?? "";
      return { state: url.searchParams.get("state") ?? "" };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
