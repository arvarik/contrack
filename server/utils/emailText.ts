// The readable part of an uploaded .eml file, which the deep model summarizes.
// It goes through mailparser, as the IMAP connector's mail does:
//
//   - The raw bytes go in, and each MIME part is decoded with its own transfer
//     encoding and charset, so a Latin-1 or Windows-1252 message is not
//     corrupted by a UTF-8 read.
//   - A message with only an HTML part comes back as text converted from the
//     HTML, not markup.
//   - Subject, sender, recipients and date come first: the summary prompt asks
//     for the subject and the participants, which the body alone often does
//     not name.

import { simpleParser, type AddressObject } from "mailparser";

function addresses(
  value: AddressObject | AddressObject[] | undefined,
): string | undefined {
  if (!value) return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.map((a) => a.text).join(", ") || undefined;
}

/**
 * The headers a reader needs and the body as plain text.
 *
 * @param raw - the .eml file's bytes
 * @returns "Subject: …" lines, a blank line, then the body. A file that
 *   does not parse as mail comes back as its UTF-8 text.
 */
export async function emailText(raw: Buffer): Promise<string> {
  let parsed;
  try {
    parsed = await simpleParser(raw, {
      skipImageLinks: true,
      skipTextToHtml: true,
      skipTextLinks: true,
    });
  } catch {
    return raw.toString("utf8");
  }

  const headers = [
    ["Subject", parsed.subject],
    ["From", addresses(parsed.from)],
    ["To", addresses(parsed.to)],
    ["Cc", addresses(parsed.cc)],
    ["Date", parsed.date?.toISOString()],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`);

  const body =
    parsed.text?.trim() || (typeof parsed.html === "string" ? parsed.html : "");
  if (headers.length === 0 && !body) return raw.toString("utf8");
  return [...headers, "", body].join("\n").trim();
}
