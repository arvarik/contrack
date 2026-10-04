// =============================================================================
// OAuth Service — sign-in for MCP clients
// =============================================================================
// An MCP client such as Claude, ChatGPT or an editor adds Contrack by its
// address. It finds this server's OAuth metadata, sends the person here to
// sign in and approve it, and then holds a token for /api/mcp alone.
//
// The flow, and where each step lives:
// 1. Discovery: the routes in server/routes/oauth.ts, from `oauthIssuer()`.
// 2. The client: a registered one (RFC 7591, `registerClient`) or one that
//    publishes a metadata document at an https URL (`resolveClient`).
// 3. `beginAuthorization` checks the request and stores it. The person
//    approves or denies it on the consent page (`describeRequest`,
//    `decideRequest`), which gives the client a one-time code.
// 4. `exchangeCode` turns the code into a grant, an access token and a
//    refresh token. `refreshGrant` rotates the refresh token.
// 5. `resolveAccessToken` is how attachPrincipal reads an access token.
//
// A grant is an api_tokens row with `kind = 'oauth'`, so the account's token
// list shows it and revoking it ends every token it issued. Every secret is
// stored as its SHA-256 only, as personal tokens are.
// =============================================================================

import crypto from "crypto";
import { z } from "zod";
import { sqlite } from "../db.ts";
import { log } from "../utils/logger.ts";
import { NotFoundError } from "../utils/AppError.ts";
import { validatePublicUrl } from "../utils/publicOrigin.ts";
import { readBytesCapped, safeFetch } from "../utils/urlSafety.ts";
import { auditService } from "./auditService.ts";
import { getUserById, type User } from "./authService.ts";

export const OAUTH_SCOPES = ["contrack:read", "contrack:write"] as const;

const ACCESS_PREFIX = "cto_";
const REFRESH_PREFIX = "ctr_";
const CLIENT_PREFIX = "ctc_";

/** How long each step lives, in SQLite's own `datetime` modifiers. */
const REQUEST_LIFE = "+15 minutes";
const CODE_LIFE = "+5 minutes";
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 30;

/** A metadata document is cached for its max-age, within these bounds. */
const MAX_DOCUMENT_SECONDS = 24 * 60 * 60;
const MAX_DOCUMENT_BYTES = 5 * 1024;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;
const MAX_CLIENT_NAME = 60;
/** Registered clients beyond this many lose their oldest unused ones. */
const MAX_REGISTERED_CLIENTS = 1000;

/** Schemes a native app may not claim as its redirect. */
const BLOCKED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "blob:",
  "about:",
  "ws:",
  "wss:",
  "ftp:",
]);

/**
 * A refusal in the OAuth error format (RFC 6749 §5.2). The routes answer it
 * as `{ error, error_description }`.
 */
export class OAuthError extends Error {
  readonly error: string;
  readonly description: string;
  readonly status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.description = description;
    this.status = status;
  }
}

// -----------------------------------------------------------------------------
// The issuer
// -----------------------------------------------------------------------------

function isLoopbackName(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

/**
 * The issuer and the base of every OAuth URL: the origin of `PUBLIC_URL`
 * when it is https, or http on a loopback name for a local client. Never the
 * request's Host, so a forged header cannot move it. Null turns OAuth off.
 */
export function oauthIssuer(): string | null {
  let origin: string | null;
  try {
    origin = validatePublicUrl(process.env.PUBLIC_URL);
  } catch {
    return null;
  }
  if (!origin) return null;
  const url = new URL(origin);
  if (url.protocol === "https:") return origin;
  return isLoopbackName(url.hostname) ? origin : null;
}

/** The one resource every token is for. */
export function mcpResource(issuer: string): string {
  return `${issuer}/api/mcp`;
}

export function resourceMetadataUrl(issuer: string): string {
  return `${issuer}/.well-known/oauth-protected-resource/api/mcp`;
}

/** A `resource` the client may name: the MCP endpoint, or the issuer. */
function checkResource(issuer: string, resource: string | undefined): void {
  if (resource === undefined || resource === "") return;
  const named = resource.replace(/\/+$/, "");
  if (named !== mcpResource(issuer) && named !== issuer) {
    throw new OAuthError(
      "invalid_target",
      `This server issues tokens only for ${mcpResource(issuer)}.`,
    );
  }
}

// -----------------------------------------------------------------------------
// Secrets
// -----------------------------------------------------------------------------

const sha256 = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");

const randomSecret = (prefix = "") =>
  `${prefix}${crypto.randomBytes(32).toString("base64url")}`;

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// -----------------------------------------------------------------------------
// Clients
// -----------------------------------------------------------------------------

interface Client {
  id: string;
  source: "registered" | "document";
  name: string;
  redirectUris: string[];
}

interface ClientRow {
  id: string;
  source: "registered" | "document";
  name: string;
  redirectUris: string;
  fresh: number;
}

/**
 * Control and format characters out, which includes the direction marks a
 * name could use to read backwards, and a length a page can show.
 */
function cleanName(raw: unknown, fallback: string): string {
  const name =
    typeof raw === "string" ? raw.replace(/[\p{Cc}\p{Cf}]/gu, "").trim() : "";
  return (name || fallback).slice(0, MAX_CLIENT_NAME);
}

/**
 * True for a redirect URI a client may register: https, http on a loopback
 * name (RFC 8252 §7.3), or an app's own scheme such as `cursor://`. Never a
 * fragment, and never a scheme a browser runs as script.
 */
function isValidRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > MAX_REDIRECT_URI_LENGTH) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopbackName(url.hostname);
  return (
    /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !BLOCKED_SCHEMES.has(url.protocol)
  );
}

/**
 * Whether `asked` is one of the client's redirect URIs. Exact, except that a
 * loopback http URI matches on any port, because a command-line client picks
 * a free port each time (RFC 8252 §7.3).
 */
function redirectMatches(client: Client, asked: string): boolean {
  if (client.redirectUris.includes(asked)) return true;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || !isLoopbackName(url.hostname)) return false;
  const portless = (value: URL) => {
    const copy = new URL(value);
    copy.port = "";
    return copy.toString();
  };
  return client.redirectUris.some((registered) => {
    try {
      return portless(new URL(registered)) === portless(url);
    } catch {
      return false;
    }
  });
}

const documentSchema = z.object({
  client_id: z.string(),
  client_name: z.string().optional(),
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  token_endpoint_auth_method: z.string().optional(),
  token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
});

/** The client id rules of a metadata document URL (CIMD draft 02). */
function isDocumentUrl(clientId: string): boolean {
  try {
    const url = new URL(clientId);
    return (
      url.protocol === "https:" &&
      url.pathname.length > 1 &&
      !url.hash &&
      !url.username &&
      !url.password &&
      !/\/\.\.?(\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** Seconds to cache a document, from its Cache-Control. */
function documentMaxAge(cacheControl: string | null): number {
  if (!cacheControl || /no-store|no-cache/i.test(cacheControl)) return 0;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  return match ? Math.min(Number(match[1]), MAX_DOCUMENT_SECONDS) : 3600;
}

/**
 * Read a client's metadata document. It goes through `safeFetch`, which
 * refuses a private address on every hop, and here no redirect at all. The
 * document must name itself, list its redirect URIs, and be a public client.
 */
async function fetchClientDocument(clientId: string): Promise<Client> {
  const unavailable = (why: string) =>
    new OAuthError(
      "invalid_client",
      `The app's details could not be read: ${why}.`,
    );
  let response: globalThis.Response;
  try {
    ({ response } = await safeFetch(clientId, {
      maxRedirects: 0,
      timeoutMs: 5000,
    }));
  } catch {
    throw unavailable("the address did not answer");
  }
  if (response.status !== 200) {
    void response.body?.cancel().catch(() => undefined);
    throw unavailable(`it answered ${response.status}`);
  }
  let parsed: z.infer<typeof documentSchema>;
  try {
    const body = await readBytesCapped(response, MAX_DOCUMENT_BYTES);
    parsed = documentSchema.parse(JSON.parse(body.toString("utf8")));
  } catch {
    throw unavailable("it is not a client metadata document");
  }
  if (parsed.client_id !== clientId) {
    throw unavailable("it names another client_id");
  }
  // A public client sends no secret. ChatGPT's document names a key method
  // first and lists "none" among the methods it supports, which is enough.
  const method = parsed.token_endpoint_auth_method ?? "none";
  if (
    method !== "none" &&
    !parsed.token_endpoint_auth_methods_supported?.includes("none")
  ) {
    throw unavailable(
      "it asks for a client secret, which this server does not issue",
    );
  }
  if (!parsed.redirect_uris.every(isValidRedirectUri)) {
    throw unavailable("it lists a redirect URI this server does not accept");
  }

  const client: Client = {
    id: clientId,
    source: "document",
    name: cleanName(parsed.client_name, new URL(clientId).host),
    redirectUris: parsed.redirect_uris,
  };
  const maxAge = documentMaxAge(response.headers.get("cache-control"));
  sqlite
    .prepare(
      `INSERT INTO oauth_clients (id, source, name, redirectUris, staleAt)
       VALUES (?, 'document', ?, ?, datetime('now', ?))
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,
         redirectUris = excluded.redirectUris, staleAt = excluded.staleAt`,
    )
    .run(
      client.id,
      client.name,
      JSON.stringify(client.redirectUris),
      `+${maxAge} seconds`,
    );
  return client;
}

/**
 * A client by its id. A registered client is a row. A document client is
 * the cached row while it is fresh, and the document read again after that.
 * `cachedOnly` is for the token step, which must not wait on a fetch.
 */
async function resolveClient(
  clientId: string,
  cachedOnly = false,
): Promise<Client | null> {
  const row = sqlite
    .prepare(
      `SELECT id, source, name, redirectUris,
              (staleAt IS NOT NULL AND staleAt > datetime('now')) AS fresh
         FROM oauth_clients WHERE id = ?`,
    )
    .get(clientId) as ClientRow | undefined;
  const asClient = (r: ClientRow): Client => ({
    id: r.id,
    source: r.source,
    name: r.name,
    redirectUris: JSON.parse(r.redirectUris) as string[],
  });
  if (row?.source === "registered") return asClient(row);
  if (!isDocumentUrl(clientId)) return null;
  if (row && (row.fresh === 1 || cachedOnly)) return asClient(row);
  if (cachedOnly) return null;
  return fetchClientDocument(clientId);
}

/** The answer to a registration, in RFC 7591's words. */
export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

/**
 * Register a client (RFC 7591). Every client is public: it gets no secret,
 * whatever it asked for, which §3.2.1 lets a server decide. An unused
 * registration goes after a day (`sweepOAuth`).
 */
export function registerClient(body: unknown): RegisteredClient {
  const input = (body ?? {}) as Record<string, unknown>;
  const uris = input.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every(isValidRedirectUri)
  ) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris must list 1 to 10 https URIs, loopback http URIs, or an app's own scheme.",
    );
  }
  const id = randomSecret(CLIENT_PREFIX);
  const name = cleanName(input.client_name, "An unnamed app");
  sqlite
    .prepare(
      `INSERT INTO oauth_clients (id, source, name, redirectUris)
       VALUES (?, 'registered', ?, ?)`,
    )
    .run(id, name, JSON.stringify(uris));
  // A flood of registrations cannot grow the table without bound.
  sqlite
    .prepare(
      `DELETE FROM oauth_clients WHERE id IN (
         SELECT id FROM oauth_clients
          WHERE source = 'registered' AND lastUsedAt IS NULL
          ORDER BY createdAt DESC LIMIT -1 OFFSET ?)`,
    )
    .run(MAX_REGISTERED_CLIENTS);
  return {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

// -----------------------------------------------------------------------------
// Authorization requests
// -----------------------------------------------------------------------------

/** Where `GET /oauth/authorize` sends the browser next. */
export type AuthorizeOutcome =
  /** To the consent page, with the stored request. */
  | { consent: string }
  /** Back to the client, with an error it can read. */
  | { redirect: string }
  /** To the consent page's error view: the client or its redirect is wrong. */
  | { problem: "unknown_client" | "bad_redirect" | "client_unavailable" };

/** The redirect URI with these parameters added, and the issuer (RFC 9207). */
function callback(
  redirectUri: string,
  issuer: string,
  params: Record<string, string | null | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set("iss", issuer);
  return url.toString();
}

/**
 * Check an authorization request and store it for the consent page.
 *
 * The client and the redirect URI come first: until both are known good,
 * nothing redirects anywhere, so this cannot be used to send a browser to an
 * address of an attacker's choice. After that, a bad parameter goes back to
 * the client as an error. This step never reads the session: the cookie is
 * SameSite=Strict, and a link from claude.ai does not carry it.
 */
export async function beginAuthorization(
  issuer: string,
  query: Record<string, unknown>,
): Promise<AuthorizeOutcome> {
  const text = (key: string) =>
    typeof query[key] === "string" ? (query[key] as string) : undefined;
  const clientId = text("client_id");
  const redirectUri = text("redirect_uri");
  if (!clientId) return { problem: "unknown_client" };

  let client: Client | null;
  try {
    client = await resolveClient(clientId);
  } catch (err) {
    log.warn(
      "OAuth",
      `Client ${clientId} unavailable: ${(err as Error).message}`,
    );
    return { problem: "client_unavailable" };
  }
  if (!client) return { problem: "unknown_client" };
  if (!redirectUri || !redirectMatches(client, redirectUri)) {
    return { problem: "bad_redirect" };
  }

  const state = text("state");
  const refuse = (error: string, description: string) => ({
    redirect: callback(redirectUri, issuer, {
      error,
      error_description: description,
      state,
    }),
  });
  if (text("response_type") !== "code") {
    return refuse("unsupported_response_type", "Use response_type=code.");
  }
  const challenge = text("code_challenge");
  if (
    text("code_challenge_method") !== "S256" ||
    !challenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  ) {
    return refuse("invalid_request", "PKCE with S256 is required.");
  }
  try {
    checkResource(issuer, text("resource"));
  } catch (err) {
    return refuse("invalid_target", (err as OAuthError).description);
  }
  // No scope asks for everything, and the person may still choose read only.
  const scope = text("scope");
  const wantsWrite = !scope || scope.split(/\s+/).includes("contrack:write");

  const id = randomSecret();
  sqlite
    .prepare(
      `INSERT INTO oauth_requests
         (id, clientId, redirectUri, state, codeChallenge, wantsWrite, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?))`,
    )
    .run(
      id,
      client.id,
      redirectUri,
      state ?? null,
      challenge,
      wantsWrite ? 1 : 0,
      REQUEST_LIFE,
    );
  sqlite
    .prepare(
      `UPDATE oauth_clients SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(client.id);
  return { consent: `/oauth/consent?request=${encodeURIComponent(id)}` };
}

interface RequestRow {
  id: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  wantsWrite: number;
  expiresAt: string;
  clientName: string;
  clientSource: "registered" | "document";
}

/** A request still waiting for the person's answer. */
function openRequest(id: string): RequestRow {
  const row = sqlite
    .prepare(
      `SELECT r.id, r.clientId, r.redirectUri, r.state, r.codeChallenge,
              r.wantsWrite, r.expiresAt, c.name AS clientName,
              c.source AS clientSource
         FROM oauth_requests r JOIN oauth_clients c ON c.id = r.clientId
        WHERE r.id = ? AND r.codeHash IS NULL AND r.usedAt IS NULL
          AND r.expiresAt > datetime('now')`,
    )
    .get(id) as RequestRow | undefined;
  if (!row) throw new NotFoundError("Sign-in request");
  return row;
}

/** Where a redirect URI goes, for the person to read. */
function describeRedirect(uri: string): {
  host: string;
  kind: "web" | "loopback" | "app";
} {
  const url = new URL(uri);
  if (url.protocol === "https:") return { host: url.host, kind: "web" };
  if (url.protocol === "http:") return { host: url.host, kind: "loopback" };
  return { host: url.protocol.replace(/:$/, ""), kind: "app" };
}

/** What the consent page shows. */
export interface ConsentRequest {
  id: string;
  client: { name: string; host: string | null; verified: boolean };
  redirect: { host: string; kind: "web" | "loopback" | "app" };
  canWrite: boolean;
  expiresAt: string;
}

export function describeRequest(id: string): ConsentRequest {
  const row = openRequest(id);
  const verified = row.clientSource === "document";
  return {
    id: row.id,
    client: {
      name: row.clientName,
      // A document client is known by the host that serves its document,
      // which a name cannot fake. A registered client has only its own word.
      host: verified ? new URL(row.clientId).host : null,
      verified,
    },
    redirect: describeRedirect(row.redirectUri),
    canWrite: row.wantsWrite === 1,
    expiresAt: row.expiresAt,
  };
}

/**
 * The person's answer. Allow binds the request to them and makes a code that
 * lives five minutes. Deny ends the request. Either way the answer is the
 * address the browser goes to next, back at the client.
 */
export function decideRequest(
  issuer: string,
  user: User,
  id: string,
  decision: { allow: boolean; readOnly: boolean },
  ip: string | null,
): { redirectTo: string } {
  const row = openRequest(id);
  if (!decision.allow) {
    sqlite
      .prepare(
        `UPDATE oauth_requests SET usedAt = CURRENT_TIMESTAMP, userId = ?
          WHERE id = ? AND codeHash IS NULL AND usedAt IS NULL`,
      )
      .run(user.id, id);
    auditService.record({
      actorUserId: user.id,
      action: "auth.oauth.denied",
      details: { client: row.clientName },
      ip,
    });
    return {
      redirectTo: callback(row.redirectUri, issuer, {
        error: "access_denied",
        error_description: "The person did not allow access.",
        state: row.state,
      }),
    };
  }

  const readOnly = decision.readOnly || row.wantsWrite === 0;
  const code = randomSecret();
  const changed = sqlite
    .prepare(
      `UPDATE oauth_requests
          SET userId = ?, readOnly = ?, codeHash = ?, expiresAt = datetime('now', ?)
        WHERE id = ? AND codeHash IS NULL AND usedAt IS NULL
          AND expiresAt > datetime('now')`,
    )
    .run(user.id, readOnly ? 1 : 0, sha256(code), CODE_LIFE, id).changes;
  if (changed === 0) throw new NotFoundError("Sign-in request");
  auditService.record({
    actorUserId: user.id,
    action: "auth.oauth.granted",
    details: { client: row.clientName, readOnly },
    ip,
  });
  return {
    redirectTo: callback(row.redirectUri, issuer, { code, state: row.state }),
  };
}

// -----------------------------------------------------------------------------
// Tokens
// -----------------------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

const scopeOf = (readOnly: boolean) =>
  readOnly ? "contrack:read" : "contrack:read contrack:write";

/** A new access and refresh token for a grant, and the grant's new expiry. */
function issueTokens(
  grantId: string,
  readOnly: boolean,
  parentHash: string | null,
): TokenResponse {
  const access = randomSecret(ACCESS_PREFIX);
  const refresh = randomSecret(REFRESH_PREFIX);
  const insert = sqlite.prepare(
    `INSERT INTO oauth_tokens (tokenHash, grantId, kind, parentHash, expiresAt)
     VALUES (?, ?, ?, ?, datetime('now', ?))`,
  );
  insert.run(
    sha256(access),
    grantId,
    "access",
    parentHash,
    `+${ACCESS_SECONDS} seconds`,
  );
  insert.run(
    sha256(refresh),
    grantId,
    "refresh",
    parentHash,
    `+${REFRESH_DAYS} days`,
  );
  // The token list shows when the grant ends: when its refresh token does.
  sqlite
    .prepare(
      `UPDATE api_tokens SET expiresAt = datetime('now', ?), lastUsedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(`+${REFRESH_DAYS} days`, grantId);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: refresh,
    scope: scopeOf(readOnly),
  };
}

function revokeGrant(grantId: string): void {
  sqlite
    .prepare(
      `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND kind = 'oauth' AND revokedAt IS NULL`,
    )
    .run(grantId);
}

const badGrant = () =>
  new OAuthError(
    "invalid_grant",
    "The code or token is not valid. Sign in again.",
  );

/** True when the PKCE verifier answers the challenge (RFC 7636, S256). */
function verifierMatches(verifier: unknown, challenge: string): boolean {
  if (
    typeof verifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
  ) {
    return false;
  }
  const computed = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return sameText(computed, challenge);
}

/**
 * Trade a code for a grant and its first tokens. A code works once. A code
 * that comes back after it was used means somebody else has it, so the grant
 * it made is revoked (OAuth 2.1 §4.1.3).
 */
export function exchangeCode(
  issuer: string,
  body: Record<string, unknown>,
): TokenResponse {
  if (typeof body.code !== "string" || typeof body.client_id !== "string") {
    throw new OAuthError(
      "invalid_request",
      "Send code, code_verifier, redirect_uri and client_id.",
    );
  }
  checkResource(
    issuer,
    typeof body.resource === "string" ? body.resource : undefined,
  );
  const row = sqlite
    .prepare(
      `SELECT r.id, r.clientId, r.redirectUri, r.codeChallenge, r.userId,
              r.readOnly, r.grantId, r.usedAt,
              (r.expiresAt > datetime('now')) AS live, c.name AS clientName
         FROM oauth_requests r JOIN oauth_clients c ON c.id = r.clientId
        WHERE r.codeHash = ?`,
    )
    .get(sha256(body.code)) as
    | {
        id: string;
        clientId: string;
        redirectUri: string;
        codeChallenge: string;
        userId: string;
        readOnly: number;
        grantId: string | null;
        usedAt: string | null;
        live: number;
        clientName: string;
      }
    | undefined;
  if (!row) throw badGrant();
  if (row.usedAt) {
    if (row.grantId) revokeGrant(row.grantId);
    throw badGrant();
  }
  if (
    row.live !== 1 ||
    row.clientId !== body.client_id ||
    row.redirectUri !== body.redirect_uri ||
    !verifierMatches(body.code_verifier, row.codeChallenge)
  ) {
    throw badGrant();
  }
  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") throw badGrant();

  return sqlite.transaction(() => {
    const claimed = sqlite
      .prepare(
        `UPDATE oauth_requests SET usedAt = CURRENT_TIMESTAMP
          WHERE id = ? AND usedAt IS NULL`,
      )
      .run(row.id).changes;
    if (claimed === 0) throw badGrant();
    const grantId = crypto.randomUUID();
    const host = isDocumentUrl(row.clientId)
      ? new URL(row.clientId).host
      : "app";
    sqlite
      .prepare(
        `INSERT INTO api_tokens
           (id, userId, name, tokenHash, tokenPrefix, readOnly, kind, clientId)
         VALUES (?, ?, ?, ?, ?, ?, 'oauth', ?)`,
      )
      // The grant's own hash is of a value nobody holds, so the row can never
      // be presented as a personal token.
      .run(
        grantId,
        user.id,
        row.clientName,
        sha256(randomSecret()),
        host,
        row.readOnly,
        row.clientId,
      );
    sqlite
      .prepare(`UPDATE oauth_requests SET grantId = ? WHERE id = ?`)
      .run(grantId, row.id);
    log.info("OAuth", `"${row.clientName}" connected to "${user.username}"`);
    return issueTokens(grantId, row.readOnly === 1, null);
  })();
}

/**
 * Rotate a refresh token: the old one stops, and a new pair replaces it.
 *
 * A refresh token that comes back after it was used is either a lost answer
 * (the client never got its new pair, which nobody has used yet) or a stolen
 * token. A lost answer gets a fresh pair. Anything else revokes the grant.
 */
export function refreshGrant(
  issuer: string,
  body: Record<string, unknown>,
  ip: string | null,
): TokenResponse {
  if (
    typeof body.refresh_token !== "string" ||
    typeof body.client_id !== "string"
  ) {
    throw new OAuthError(
      "invalid_request",
      "Send refresh_token and client_id.",
    );
  }
  checkResource(
    issuer,
    typeof body.resource === "string" ? body.resource : undefined,
  );
  const hash = sha256(body.refresh_token);
  const row = sqlite
    .prepare(
      `SELECT t.grantId, t.usedAt, (t.expiresAt > datetime('now')) AS live,
              g.readOnly, g.clientId, g.userId
         FROM oauth_tokens t JOIN api_tokens g ON g.id = t.grantId
        WHERE t.tokenHash = ? AND t.kind = 'refresh'
          AND g.kind = 'oauth' AND g.revokedAt IS NULL`,
    )
    .get(hash) as
    | {
        grantId: string;
        usedAt: string | null;
        live: number;
        readOnly: number;
        clientId: string;
        userId: string;
      }
    | undefined;
  if (!row || row.live !== 1 || row.clientId !== body.client_id)
    throw badGrant();
  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") throw badGrant();
  if (
    typeof body.scope === "string" &&
    row.readOnly === 1 &&
    body.scope.split(/\s+/).includes("contrack:write")
  ) {
    throw new OAuthError("invalid_scope", "This grant may only read.");
  }

  // The reuse path revokes and refuses. It answers null rather than throwing,
  // because a throw would roll the revoke back with the transaction.
  const issued = sqlite.transaction((): TokenResponse | null => {
    if (row.usedAt) {
      // The pair this token issued. Unused, the answer was lost on its way
      // to the client. Used, two parties hold this grant.
      const children = sqlite
        .prepare(
          `SELECT COUNT(*) AS issued, COALESCE(SUM(usedAt IS NOT NULL), 0) AS used
             FROM oauth_tokens WHERE parentHash = ?`,
        )
        .get(hash) as { issued: number; used: number };
      if (children.issued === 0 || children.used > 0) {
        revokeGrant(row.grantId);
        auditService.record({
          actorUserId: row.userId,
          action: "auth.oauth.refresh_reused",
          targetType: "token",
          targetId: row.grantId,
          ip,
        });
        return null;
      }
      sqlite.prepare(`DELETE FROM oauth_tokens WHERE parentHash = ?`).run(hash);
    } else {
      sqlite
        .prepare(
          `UPDATE oauth_tokens SET usedAt = CURRENT_TIMESTAMP WHERE tokenHash = ?`,
        )
        .run(hash);
    }
    return issueTokens(row.grantId, row.readOnly === 1, hash);
  })();
  if (!issued) throw badGrant();
  return issued;
}

/** RFC 7009: a token a client gives back ends its whole grant. */
export function revokeOAuthToken(token: unknown): void {
  if (typeof token !== "string") return;
  const row = sqlite
    .prepare(`SELECT grantId FROM oauth_tokens WHERE tokenHash = ?`)
    .get(sha256(token)) as { grantId: string } | undefined;
  if (row) revokeGrant(row.grantId);
}

/** True for a value that has the shape of an OAuth access token. */
export function isAccessToken(presented: string): boolean {
  return presented.startsWith(ACCESS_PREFIX);
}

/**
 * The account behind an access token, for attachPrincipal. A revoked grant,
 * an expired token and a disabled account all answer null. `lastUsedAt` is
 * stamped at most once an hour, as for personal tokens.
 */
export function resolveAccessToken(
  presented: string,
): { user: User; grantId: string; readOnly: boolean } | null {
  const row = sqlite
    .prepare(
      `SELECT g.id, g.userId, g.readOnly
         FROM oauth_tokens t JOIN api_tokens g ON g.id = t.grantId
        WHERE t.tokenHash = ? AND t.kind = 'access'
          AND t.expiresAt > datetime('now')
          AND g.kind = 'oauth' AND g.revokedAt IS NULL`,
    )
    .get(sha256(presented)) as
    { id: string; userId: string; readOnly: number } | undefined;
  if (!row) return null;
  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") return null;
  // The first use only: it tells a lost refresh answer from a stolen token.
  sqlite
    .prepare(
      `UPDATE oauth_tokens SET usedAt = CURRENT_TIMESTAMP
        WHERE tokenHash = ? AND usedAt IS NULL`,
    )
    .run(sha256(presented));
  sqlite
    .prepare(
      `UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND (lastUsedAt IS NULL OR lastUsedAt < datetime('now', '-1 hour'))`,
    )
    .run(row.id);
  return { user, grantId: row.id, readOnly: row.readOnly === 1 };
}

/**
 * The hourly sweep: requests and tokens past their life, registrations that
 * were never used within a day, and documents no live grant uses.
 */
export function sweepOAuth(): void {
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `DELETE FROM oauth_requests WHERE expiresAt < datetime('now', '-1 day')`,
      )
      .run();
    sqlite
      .prepare(`DELETE FROM oauth_tokens WHERE expiresAt < datetime('now')`)
      .run();
    sqlite
      .prepare(
        `DELETE FROM oauth_clients
          WHERE source = 'registered' AND lastUsedAt IS NULL
            AND createdAt < datetime('now', '-1 day')`,
      )
      .run();
    sqlite
      .prepare(
        `DELETE FROM oauth_clients
          WHERE source = 'document'
            AND COALESCE(lastUsedAt, createdAt) < datetime('now', '-30 days')
            AND id NOT IN (SELECT clientId FROM api_tokens
                            WHERE kind = 'oauth' AND revokedAt IS NULL
                              AND clientId IS NOT NULL)`,
      )
      .run();
  })();
}

/** For the token step: the client must still be one this server knows. */
export async function assertClientKnown(clientId: unknown): Promise<void> {
  if (typeof clientId !== "string" || !(await resolveClient(clientId, true))) {
    throw new OAuthError(
      "invalid_client",
      "This client is not known here.",
      401,
    );
  }
}
