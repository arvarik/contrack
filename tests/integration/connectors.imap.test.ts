/**
 * tests/integration/connectors.imap.test.ts — Integration tests for IMAP connector adapter.
 *
 * Uses an in-process fake IMAP server to verify:
 * - Connection testing (test)
 * - Auth failure detection (ConnectorAuthError)
 * - Message syncing and cursor management (uidValidity, lastUid)
 * - End-to-end sync with createConnector + runNow
 * - Email body download & AI summary generation for matched contacts
 */

import net from "node:net";
import crypto from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { imapAdapter } from "../../server/connectors/adapters/imap.ts";
import {
  ConnectorAuthError,
  ConnectorConfigError,
} from "../../server/connectors/errors.ts";
import { createConnector, runNow } from "../../server/connectors/service.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId, type Scope } from "../../server/tenancy/scope.ts";
import * as gateway from "../../server/ai/gateway.ts";
import type { SyncEvent } from "../../server/connectors/types.ts";

describe("IMAP Adapter Integration", () => {
  let server: net.Server;
  let serverPort: number;
  let authFail = false;
  let folderUidValidity = 12345;

  const rawMessageRfc822 = [
    'From: "Alice Wonderland" <alice@example.com>',
    'To: "Me" <me@example.com>',
    "Subject: Important Project Discussion",
    "Date: Sun, 15 Feb 2026 10:00:00 +0000",
    "Message-ID: <msg-001@example.com>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hi, please find the latest project update attached. Let me know what you think.",
  ].join("\r\n");

  beforeAll(async () => {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";

    server = net.createServer((socket) => {
      socket.write("* OK [CAPABILITY IMAP4rev1] Fake IMAP Server Ready\r\n");

      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString();
        while (buffer.includes("\r\n")) {
          const idx = buffer.indexOf("\r\n");
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          if (!line.trim()) continue;

          const parts = line.split(" ");
          const tag = parts[0];
          const cmd = (parts[1] || "").toUpperCase();
          const rest = parts.slice(2).join(" ");

          if (cmd === "LOGIN") {
            if (authFail || rest.includes("badpassword")) {
              socket.write(
                `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`,
              );
            } else {
              socket.write(`${tag} OK [CAPABILITY IMAP4rev1] Logged in\r\n`);
            }
          } else if (cmd === "CAPABILITY") {
            socket.write(
              `* CAPABILITY IMAP4rev1\r\n${tag} OK CAPABILITY completed\r\n`,
            );
          } else if (cmd === "LIST" || cmd === "LSUB") {
            if (rest.includes("INBOX") || rest.includes("Sent")) {
              socket.write(`${tag} OK ${cmd} done\r\n`);
            } else {
              socket.write(`* ${cmd} (\\HasNoChildren) "/" "INBOX"\r\n`);
              socket.write(`* ${cmd} (\\HasNoChildren \\Sent) "/" "Sent"\r\n`);
              socket.write(`${tag} OK ${cmd} completed\r\n`);
            }
          } else if (cmd === "SELECT" || cmd === "EXAMINE") {
            socket.write(
              `* 2 EXISTS\r\n* OK [UIDVALIDITY ${folderUidValidity}] UIDs valid\r\n* OK [UIDNEXT 200] Next UID\r\n${tag} OK [READ-WRITE] Select completed\r\n`,
            );
          } else if (cmd === "UID") {
            const subCmd = (parts[2] || "").toUpperCase();
            console.log("UID command:", line);
            if (subCmd === "SEARCH") {
              if (line.includes("102:*") || line.includes("200:*")) {
                socket.write(`* SEARCH\r\n${tag} OK SEARCH completed\r\n`);
              } else {
                socket.write(`* SEARCH 101\r\n${tag} OK SEARCH completed\r\n`);
              }
            } else if (subCmd === "FETCH") {
              if (line.includes("BODY.PEEK") || line.includes("BODY[]")) {
                const len = Buffer.byteLength(rawMessageRfc822);
                socket.write(
                  `* 1 FETCH (UID 101 RFC822.SIZE ${len} BODY[]<0> {${len}}\r\n${rawMessageRfc822})\r\n${tag} OK FETCH completed\r\n`,
                );
              } else {
                socket.write(
                  `* 1 FETCH (UID 101 INTERNALDATE "15-Feb-2026 10:00:00 +0000" ENVELOPE ("Sun, 15 Feb 2026 10:00:00 +0000" "Important Project Discussion" (( "Alice Wonderland" NIL "alice" "example.com")) (( "Alice Wonderland" NIL "alice" "example.com")) (( "Alice Wonderland" NIL "alice" "example.com")) ((NIL NIL "me" "example.com")) NIL NIL NIL "<msg-001@example.com>") BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" ${rawMessageRfc822.length} 9))\r\n${tag} OK FETCH completed\r\n`,
                );
              }
            } else {
              socket.write(`${tag} OK UID completed\r\n`);
            }
          } else if (cmd === "LOGOUT") {
            socket.write(`* BYE Logging out\r\n${tag} OK LOGOUT completed\r\n`);
            socket.end();
          } else if (cmd === "CLOSE") {
            socket.write(`${tag} OK CLOSE completed\r\n`);
          } else {
            socket.write(`${tag} OK Completed\r\n`);
          }
        }
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as net.AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const ownerId = "imap-test-" + crypto.randomUUID().slice(0, 8);
  const scope: Scope = scopeForOwnerId(ownerId);

  beforeEach(() => {
    authFail = false;
    folderUidValidity = 12345;
  });

  it("test() succeeds with valid credentials", async () => {
    const result = await imapAdapter.test(
      {
        host: "127.0.0.1",
        port: serverPort,
        secure: false,
        username: "me@example.com",
        lookbackDays: 90,
        rollup: true,
        ghostThreshold: 3,
        maxMessagesPerFolder: 5000,
        aliases: [],
        summaries: false,
      },
      { password: "goodpassword" },
    );

    expect(result.ok).toBe(true);
    expect(result.detail).toContain("Connected successfully");
  });

  it("test() throws ConnectorAuthError with invalid credentials", async () => {
    authFail = true;
    await expect(
      imapAdapter.test(
        {
          host: "127.0.0.1",
          port: serverPort,
          secure: false,
          username: "me@example.com",
          lookbackDays: 90,
          rollup: true,
          ghostThreshold: 3,
          maxMessagesPerFolder: 5000,
          aliases: [],
          summaries: false,
        },
        { password: "badpassword" },
      ),
    ).rejects.toThrow(ConnectorAuthError);
  });

  it("asserts safe host when private hosts not allowed", async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    try {
      await expect(
        imapAdapter.test(
          {
            host: "127.0.0.1",
            port: serverPort,
            secure: false,
            username: "me@example.com",
            lookbackDays: 90,
            rollup: true,
            ghostThreshold: 3,
            maxMessagesPerFolder: 5000,
            aliases: [],
            summaries: false,
          },
          { password: "test" },
        ),
      ).rejects.toThrow(ConnectorConfigError);
    } finally {
      process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    }
  });

  it("syncs messages, tracks cursor, and handles AI summaries", async () => {
    // Mock AI gateway for summary
    vi.spyOn(gateway, "isAnyProviderConfigured").mockReturnValue(true);
    vi.spyOn(gateway, "generateFor").mockResolvedValue({
      text: "Alice sent the latest project update for review.",
      model: "test-llm",
      tokenCount: 25,
      latencyMs: 50,
    } as gateway.AIGenerateResult);

    const isContactParticipant = (p: { email?: string }) =>
      p.email === "alice@example.com";

    const ctx = {
      config: {
        host: "127.0.0.1",
        port: serverPort,
        secure: false,
        username: "me@example.com",
        folders: ["INBOX"],
        summaries: true,
        lookbackDays: 90,
        rollup: true,
        ghostThreshold: 3,
        maxMessagesPerFolder: 100,
        aliases: [],
      },
      secret: { password: "password" },
      cursor: null,
      since: "2026-01-01T00:00:00.000Z",
      selfAddresses: { emails: ["me@example.com"], phones: [] },
      signal: new AbortController().signal,
      log: console.log,
      isContactParticipant,
    };

    const events: SyncEvent[] = [];
    const gen = imapAdapter.sync(ctx);
    let step = await gen.next();
    while (!step.done) {
      events.push(step.value);
      step = await gen.next();
    }

    const cursor = step.value as { folders: Record<string, unknown> };
    expect(cursor).toBeDefined();
    expect(cursor.folders.INBOX).toEqual({
      uidValidity: 12345,
      lastUid: 101,
    });

    const interactions = events.filter((e) => e.kind === "interaction");
    expect(interactions).toHaveLength(1);
    const int = interactions[0] as Extract<SyncEvent, { kind: "interaction" }>;
    expect(int.title).toBe("Important Project Discussion");
    expect(int.direction).toBe("in");
    expect(int.content).toBe(
      "Alice sent the latest project update for review.",
    );
  });

  it("integrates end-to-end with createConnector and runNow", async () => {
    // Seed user
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')`,
      )
      .run(ownerId, `${ownerId}@example.com`, ownerId);

    // Seed contact for alice
    const contactId = crypto.randomUUID();
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, addedAt, updatedAt) VALUES (?, ?, 'Alice Wonderland', datetime('now'), datetime('now'))`,
      )
      .run(contactId, ownerId);
    sqlite
      .prepare(
        `INSERT INTO contact_emails (id, contactId, email, isPrimary) VALUES (?, ?, 'alice@example.com', 1)`,
      )
      .run(crypto.randomUUID(), contactId);

    const connector = await createConnector(scope, {
      kind: "imap",
      name: "My Work Email",
      config: {
        host: "127.0.0.1",
        port: serverPort,
        secure: false,
        username: "me@example.com",
        folders: ["INBOX"],
        summaries: false,
      },
      secret: { password: "testpassword" },
      intervalMinutes: 15,
    });

    expect(connector.id).toBeDefined();
    expect(connector.kind).toBe("imap");
    expect(connector.status).toBe("active");

    // Run sync
    const runResult = await runNow(scope, connector.id);
    expect(runResult.status).toBe("ok");
    expect(runResult.stats.interactions).toBe(1);

    // Check interaction was saved
    const rows = sqlite
      .prepare("SELECT * FROM interactions WHERE ownerId = ? AND contactId = ?")
      .all(ownerId, contactId) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("imap");
    expect(rows[0].title).toBe("Important Project Discussion");

    // Clean up
    sqlite.prepare("DELETE FROM interactions WHERE ownerId = ?").run(ownerId);
    sqlite
      .prepare("DELETE FROM connector_links WHERE ownerId = ?")
      .run(ownerId);
    sqlite.prepare("DELETE FROM connector_runs WHERE ownerId = ?").run(ownerId);
    sqlite.prepare("DELETE FROM connectors WHERE ownerId = ?").run(ownerId);
    sqlite
      .prepare("DELETE FROM contact_emails WHERE contactId = ?")
      .run(contactId);
    sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(contactId);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run(ownerId);
  });
});
