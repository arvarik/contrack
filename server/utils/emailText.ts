// =============================================================================
// Email text — the readable part of an uploaded .eml file
// =============================================================================
// An .eml upload is summarized by the deep model. It used to be parsed with
// eml-format, a package last published in 2022, from the file read as UTF-8.
// It now goes through mailparser, which the IMAP connector already uses:
//
//   - The raw bytes go in. Each MIME part is decoded with its own transfer
//     encoding and charset, so a Latin-1 or Windows-1252 message is no longer
//     corrupted by the UTF-8 read before it is parsed.
//   - A message with only an HTML part comes back as text converted from the
//     HTML, not as markup for the model to read around.
//   - Subject, sender, recipients and date come first. The summary prompt
//     asks for the subject and the participants, and the body alone often
//     names neither.
// =============================================================================

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
