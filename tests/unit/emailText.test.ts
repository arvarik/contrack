// =============================================================================
// Unit: emailText — the readable part of an uploaded .eml file
// =============================================================================

import { describe, it, expect } from "vitest";
import { emailText } from "../../server/utils/emailText.ts";

const crlf = (lines: string[]) => Buffer.from(lines.join("\r\n"), "latin1");

describe("emailText", () => {
  it("decodes quoted-printable text and puts the headers first", async () => {
    const eml = crlf([
      "From: Ada Lovelace <ada@example.com>",
      "To: Charles Babbage <charles@example.com>",
      "Cc: Mary Somerville <mary@example.com>",
      "Subject: Engine notes",
      "Date: Tue, 22 Sep 2026 10:00:00 +0000",
      "MIME-Version: 1.0",
      'Content-Type: multipart/alternative; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Let=E2=80=99s meet on Thursday to go over the=",
      " Bernoulli table.",
      "--b1",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Let&rsquo;s meet on Thursday</p>",
      "--b1--",
      "",
    ]);

    const text = await emailText(eml);

    expect(text).toContain("Subject: Engine notes");
    // mailparser quotes the display name.
    expect(text).toContain('From: "Ada Lovelace" <ada@example.com>');
    expect(text).toContain('To: "Charles Babbage" <charles@example.com>');
    expect(text).toContain('Cc: "Mary Somerville" <mary@example.com>');
    expect(text).toContain("Date: 2026-09-22T10:00:00.000Z");
    // The soft line break is joined and the UTF-8 apostrophe decoded.
    expect(text).toContain(
      "Let’s meet on Thursday to go over the Bernoulli table.",
    );
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("=E2");
  });

  it("converts an HTML-only message to text", async () => {
    const html = Buffer.from(
      "<html><body><h1>Offer</h1><p>We would like <b>you</b> to join.</p></body></html>",
    ).toString("base64");
    const eml = crlf([
      "From: hr@example.com",
      "Subject: Welcome",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      html,
      "",
    ]);

    const text = await emailText(eml);

    expect(text).toMatch(/OFFER|Offer/);
    expect(text).toContain("We would like you to join.");
    expect(text).not.toMatch(/<\/?(p|b|h1|html|body)>/);
  });

  it("decodes a Latin-1 body that a UTF-8 read would corrupt", async () => {
    // A header is 7-bit and names its charset (RFC 2047). The body is raw
    // 8-bit Latin-1, where é is the single byte 0xE9.
    const eml = crlf([
      "From: jose@example.com",
      "Subject: =?iso-8859-1?Q?Caf=E9?=",
      "Content-Type: text/plain; charset=iso-8859-1",
      "Content-Transfer-Encoding: 8bit",
      "",
      "Nos vemos en el café a las ocho.",
      "",
    ]);

    const text = await emailText(eml);

    expect(text).toContain("Subject: Café");
    expect(text).toContain("Nos vemos en el café a las ocho.");
    expect(text).not.toContain("�");
  });

  it("returns a file that is not mail as it is", async () => {
    const raw = Buffer.from("just some notes, no headers at all");
    expect(await emailText(raw)).toContain(
      "just some notes, no headers at all",
    );
  });
});
