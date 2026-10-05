// =============================================================================
// Migration 0004_oauth
// =============================================================================
// OAuth sign-in for MCP clients, so a person can add Contrack to Claude,
// ChatGPT or an editor by its address and approve it in the browser.
//
// - oauth_clients: the apps that may ask. A registered client has a `ctc_` id
//   (RFC 7591). A client that publishes a metadata document has that
//   document's https URL as its id, and the row caches what it said.
// - oauth_requests: one sign-in in progress, from the authorize link to the
//   code exchange. The code is stored as its SHA-256 only.
// - A grant is an api_tokens row with `kind = 'oauth'`. The token list shows
//   it, and revoking it ends every token it issued.
// - oauth_requests.ip: the address that opened the request. Each address
//   keeps only its newest few open requests for a client.
// - oauth_tokens: the access and refresh tokens of a grant, as SHA-256.
//   `usedAt` marks a refresh token once it is rotated, so a second use is
//   seen.
// =============================================================================

import type Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE oauth_clients (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('registered', 'document')),
      name TEXT NOT NULL,
      redirectUris TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastUsedAt TEXT,
      staleAt TEXT
    );

    CREATE TABLE oauth_requests (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
      redirectUri TEXT NOT NULL,
      state TEXT,
      codeChallenge TEXT NOT NULL,
      wantsWrite INTEGER NOT NULL,
      ip TEXT,
      userId TEXT REFERENCES users(id) ON DELETE CASCADE,
      readOnly INTEGER,
      codeHash TEXT UNIQUE,
      grantId TEXT,
      usedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      expiresAt TEXT NOT NULL
    );
    CREATE INDEX idx_oauth_requests_expires ON oauth_requests(expiresAt);

    ALTER TABLE api_tokens ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal';
    ALTER TABLE api_tokens ADD COLUMN clientId TEXT;

    CREATE TABLE oauth_tokens (
      tokenHash TEXT PRIMARY KEY,
      grantId TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX idx_oauth_tokens_grant ON oauth_tokens(grantId);
  `);
}
