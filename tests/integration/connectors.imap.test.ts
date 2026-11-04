/**
 * The Mailbox (IMAP) connector's answers to what a real server will not do
 * on request: refuse a login in a given way, or reset the connection. The
 * sync itself is proven against GreenMail in tests/lab/imap.lab.test.ts.
 */

import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { MessageStructureObject } from "imapflow";
import {
  imapAdapter,
  summaryPart,
} from "../../server/connectors/adapters/imap.ts";
import { ConnectorConfigError } from "../../server/connectors/errors.ts";

describe("IMAP connect errors", () => {
  /** A LOGIN refusal to send, or "reset" to reset the connection at the folder list. */
  let answer = "";
  let server: net.Server;
  let port: number;

  beforeAll(async () => {
    process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    server = net.createServer((socket) => {
      socket.write("* OK [CAPABILITY IMAP4rev1] Fake IMAP ready\r\n");
      socket.on("data", (data) => {
        for (const line of data.toString().split("\r\n").filter(Boolean)) {
          const [tag, command] = line.split(" ");
          // A reset comes once connected, at the folder list.
          if (answer === "reset" && line.endsWith('LIST "" "*"'))
            socket.resetAndDestroy();
          else if (answer !== "reset" && command.toUpperCase() === "LOGIN")
            socket.write(`${tag} NO ${answer}\r\n`);
          else socket.write(`${tag} OK done\r\n`);
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as net.AddressInfo).port;
  });

  afterAll(async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const connect = () =>
    imapAdapter.test(
      {
        host: "127.0.0.1",
        port,
        secure: false,
        username: "me@example.com",
        lookbackDays: 90,
        rollup: true,
        ghostThreshold: 3,
        maxMessagesPerFolder: 5000,
        aliases: [],
        summaries: false,
      },
      { password: "pw" },
    );

  it.each([
    [
      "[AUTHENTICATIONFAILED] Invalid credentials",
      "ConnectorAuthError",
      400,
      "IMAP authentication failed: Invalid credentials",
    ],
    [
      "[UNAVAILABLE] Temporary maintenance",
      "ConnectorUnavailableError",
      503,
      "IMAP server is unavailable for now: Temporary maintenance",
    ],
    [
      // Gmail's connection limit carries no RFC 5530 code.
      "[ALERT] Too many simultaneous connections. (Failure)",
      "ConnectorUnavailableError",
      503,
      "IMAP server is unavailable for now: Too many simultaneous connections. (Failure)",
    ],
    [
      "[ALERT] Application-specific password required",
      "ConnectorAuthError",
      400,
      "IMAP authentication failed: Application-specific password required",
    ],
  ])(
    "reads a LOGIN refusal of %s as %s",
    async (refusal, name, statusCode, message) => {
      answer = refusal;
      await expect(connect()).rejects.toMatchObject({
        name,
        statusCode,
        message,
      });
    },
  );

  it("fails, and does not crash the process, when the server resets the connection", async () => {
    // ImapFlow emits a reset as an `error` event. With no listener, Node
    // throws it, and the server's uncaughtException handler exits.
    answer = "reset";
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    try {
      await expect(connect()).rejects.toThrow("Connection not available");
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off("uncaughtException", uncaught);
    }
  });

  it("refuses a private host unless private hosts are allowed", async () => {
    delete process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS;
    try {
      await expect(connect()).rejects.toThrow(ConnectorConfigError);
    } finally {
      process.env.CONNECTORS_ALLOW_PRIVATE_HOSTS = "true";
    }
  });
});

describe("summaryPart", () => {
  it.each([
    [
      "plain text before HTML, never an attachment",
      {
        type: "multipart/mixed",
        childNodes: [
          { type: "text/plain", part: "1", disposition: "attachment" },
          {
            type: "multipart/alternative",
            part: "2",
            childNodes: [
              { type: "text/html", part: "2.1" },
              { type: "text/plain", part: "2.2" },
            ],
          },
        ],
      },
      { part: "2.2", html: false },
    ],
    [
      "HTML when there is no plain text",
      {
        type: "multipart/mixed",
        childNodes: [
          { type: "text/html", part: "1" },
          { type: "application/pdf", part: "2" },
        ],
      },
      { part: "1", html: true },
    ],
    ["nothing to read", { type: "image/png" }, null],
  ])("picks %s", (_name, structure, expected) => {
    expect(summaryPart(structure as MessageStructureObject)).toEqual(expected);
  });
});
