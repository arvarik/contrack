// vCard 3.0, reading and writing. One module for the server's export and the
// browser's import, so a .vcf this app writes reads back with nothing lost.
//
// 3.0, not 4.0: Apple Contacts, Google Contacts and Outlook all export and
// read 3.0, and almost nothing imports 4.0.
//
// The format is not plain key-value pairs. The parser handles four things:
//   1. Folding: a line over 75 octets continues on the next, which begins
//      with one space or tab.
//   2. Escaping: a comma, semicolon, backslash or newline in a value is
//      backslash-escaped, so "Smith\; Jr." is one value.
//   3. Parameters: `TEL;TYPE=WORK,VOICE:`, `TEL;WORK;VOICE:` (the 2.1
//      shorthand phones still write) and `TEL;TYPE="WORK,VOICE":` are one
//      property written three ways.
//   4. Encoding: `ENCODING=QUOTED-PRINTABLE`, common in older Android and
//      Outlook exports.

import { vcardBirthdayLine } from "./birthday.ts";

// The shape a parsed card takes

/** One property line, after unfolding, parameter parsing and decoding. */
export interface VCardProperty {
  /** Apple groups related lines with `item1.`, `item2.` and so on. */
  group: string | null;
  /** Upper-cased: `FN`, `TEL`, `X-SOCIALPROFILE`. */
  name: string;
  /**
   * Parameters, upper-cased keys, values as given. A repeated parameter
   * (`TYPE=WORK;TYPE=VOICE`) and a list (`TYPE=WORK,VOICE`) both flatten into
   * one array.
   */
  params: Record<string, string[]>;
  /** The value, unescaped and decoded. Structured values keep their `;`. */
  value: string;
}

/** One BEGIN:VCARD … END:VCARD block. */
export interface ParsedVCard {
  properties: VCardProperty[];
}

// Escaping

/** Escape one component of a value: `\`, `;`, `,` and newlines. */
export function escapeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** The inverse. `\N` is as legal as `\n` and some exporters use it. */
export function unescapeValue(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = value[++i];
    if (next === undefined) {
      // A trailing backslash. Keep it rather than losing a character.
      out += "\\";
    } else if (next === "n" || next === "N") {
      out += "\n";
    } else {
      // `\,` `\;` `\\` and anything else an exporter escaped needlessly.
      out += next;
    }
  }
  return out;
}

/**
 * Splits a structured value (`N`, `ADR`, `ORG`) on unescaped semicolons, so
 * an escaped one inside a component stays.
 */
export function splitComponents(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      current += ch + (value[++i] ?? "");
    } else if (ch === ";") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(unescapeValue);
}

// Folding

/** The line length RFC 2426 asks for, not counting the CRLF. */
const FOLD_AT = 75;

/**
 * Folds one content line. Counted in UTF-16 code units, not the spec's
 * octets, and never inside a surrogate pair: readers accept a shorter line,
 * and a split emoji is not valid UTF-8.
 */
export function foldLine(line: string): string {
  if (line.length <= FOLD_AT) return line;
  const parts: string[] = [];
  let index = 0;
  let limit = FOLD_AT;
  while (index < line.length) {
    let end = Math.min(index + limit, line.length);
    // Never between a high and a low surrogate.
    if (end < line.length) {
      const code = line.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    parts.push(line.slice(index, end));
    index = end;
    // Continuation lines carry a leading space, which counts toward the limit.
    limit = FOLD_AT - 1;
  }
  return parts.join("\r\n ");
}

/** Undo folding: a line beginning with a space or a tab continues the one above. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

// Quoted-printable

/**
 * Decodes `ENCODING=QUOTED-PRINTABLE` as UTF-8. The bytes are decoded
 * together: `=C3=A9` is one character, and decoding each `=XX` alone turns
 * "José" into "JosÃ©".
 */
function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  const text = value.replace(/=\r?\n/g, "");
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Everything outside an escape is ASCII by definition of the encoding.
      for (const byte of new TextEncoder().encode(text[i])) bytes.push(byte);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return value;
  }
}

// Parsing

/** Split a content line into its name, its parameters and its value. */
function parseContentLine(line: string): VCardProperty | null {
  // The value starts at the first colon that is not inside a quoted parameter.
  let colon = -1;
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);

  // Parameters are separated by semicolons that are not inside quotes.
  const segments: string[] = [];
  let current = "";
  quoted = false;
  for (const ch of head) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (ch === ";" && !quoted) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);

  const nameSegment = segments.shift() ?? "";
  const dot = nameSegment.indexOf(".");
  const group = dot > 0 ? nameSegment.slice(0, dot) : null;
  const name = (dot > 0 ? nameSegment.slice(dot + 1) : nameSegment)
    .trim()
    .toUpperCase();
  if (!name) return null;

  const params: Record<string, string[]> = {};
  const add = (key: string, values: string[]) => {
    const slot = (params[key] ??= []);
    for (const v of values) if (v) slot.push(v);
  };

  for (const segment of segments) {
    const eq = segment.indexOf("=");
    if (eq === -1) {
      // vCard 2.1 shorthand: `TEL;WORK;VOICE:`. Every reader treats a bare
      // parameter as a TYPE, and phones still write them.
      add("TYPE", [segment.trim()]);
      continue;
    }
    const key = segment.slice(0, eq).trim().toUpperCase();
    const raw = segment.slice(eq + 1).trim();
    const unquoted =
      raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    add(
      key,
      unquoted.split(",").map((v) => v.trim()),
    );
  }

  if (params.ENCODING?.some((e) => /QUOTED-PRINTABLE/i.test(e))) {
    value = decodeQuotedPrintable(value);
  }

  return { group, name, params, value };
}

/**
 * Every card in a file. Anything outside a BEGIN/END pair is ignored, not an
 * error: files gain stray blank lines and byte-order marks in transit.
 */
export function parseVCards(text: string): ParsedVCard[] {
  const cards: ParsedVCard[] = [];
  let current: ParsedVCard | null = null;

  for (const line of unfold(text.replace(/^\uFEFF/, ""))) {
    if (!line.trim()) continue;
    if (/^BEGIN:VCARD$/i.test(line.trim())) {
      current = { properties: [] };
      continue;
    }
    if (/^END:VCARD$/i.test(line.trim())) {
      // A card with nothing in it is not a contact.
      if (current && current.properties.length > 0) cards.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const property = parseContentLine(line);
    if (property) current.properties.push(property);
  }

  return cards;
}

/** Every value of one property, in order. */
export function valuesOf(card: ParsedVCard, name: string): VCardProperty[] {
  return card.properties.filter((p) => p.name === name.toUpperCase());
}

/**
 * The first value of one property, unescaped, or null. For simple values
 * only (`FN`, `TITLE`, `NOTE`, `BDAY`). A structured value or a list must be
 * split before it is unescaped, or `N:Smith\; Jr.;Robert;;;` loses its
 * surname. Use {@link firstRaw} with {@link splitComponents} or
 * {@link splitList} for those.
 */
export function firstValue(card: ParsedVCard, name: string): string | null {
  const raw = firstRaw(card, name);
  return raw === null ? null : unescapeValue(raw);
}

/** The first value of one property, exactly as written. */
export function firstRaw(card: ParsedVCard, name: string): string | null {
  const found = valuesOf(card, name)[0];
  return found ? found.value : null;
}

/**
 * Splits a comma-separated list (`CATEGORIES`, `NICKNAME`) on unescaped
 * commas and unescapes each item.
 */
export function splitList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\") {
      current += ch + (value[++i] ?? "");
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(unescapeValue);
}

/**
 * The label Apple attaches to a grouped property.
 *
 * `item1.TEL:...` plus `item1.X-ABLabel:_$!<Home>!$_` is how Apple carries a
 * custom label. The `_$!<` wrapper marks one of its built-in names.
 */
export function groupLabel(
  card: ParsedVCard,
  group: string | null,
): string | null {
  if (!group) return null;
  const found = card.properties.find(
    (p) => p.group === group && p.name === "X-ABLABEL",
  );
  if (!found) return null;
  const label = unescapeValue(found.value)
    .replace(/_\$!<|>!\$_/g, "")
    .trim();
  return label || null;
}

// Writing

/** What a card is built from. Every field is optional except the name. */
export interface VCardInput {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  role?: string | null;
  birthday?: string | null;
  about?: string | null;
  website?: string | null;
  emails?: { email: string; label?: string | null; isPrimary?: boolean }[];
  phones?: { phone: string; label?: string | null; isPrimary?: boolean }[];
  addresses?: { address: string; label?: string | null; isPrimary?: boolean }[];
  socialLinks?: { platform: string; url: string }[];
  tags?: string[];
  updatedAt?: string | null;
}

/**
 * Suffixes that belong in N's fifth component, so "Rowan Vale Jr." is not
 * filed under J.
 */
const NAME_SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
  "v",
  "phd",
  "ph.d.",
  "md",
  "m.d.",
  "esq",
  "esq.",
]);

/** The structured name, when the contact has only a display name. */
interface SplitName {
  given: string;
  family: string;
  suffix: string;
}

/**
 * Guesses `N` from a display name, for a contact with no first or last name.
 * `N` is required, and address books sort by it.
 *
 * Conservative: only "Family, Given" and "Given … Family", and nothing with a
 * semicolon. A wrong guess files somebody under the wrong letter, and an
 * empty N falls back to FN.
 */
export function splitDisplayName(name: string): SplitName {
  const empty = { given: "", family: "", suffix: "" };
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes(";")) return empty;

  // "Lovelace, Ada" — the other way round, and unambiguous.
  const commas = trimmed.split(",");
  if (commas.length === 2) {
    const family = commas[0].trim();
    const given = commas[1].trim();
    if (family && given && !given.includes(" "))
      return { given, family, suffix: "" };
    return empty;
  }
  if (commas.length > 2) return empty;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return empty;

  let suffix = "";
  if (NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    suffix = parts.pop()!;
  }
  if (parts.length < 2) return empty;

  const family = parts.pop()!;
  return { given: parts.join(" "), family, suffix };
}

/**
 * A timestamp `REV` can carry. The column holds SQLite's
 * `2026-09-11 19:35:49` and ISO, and RFC 2426 wants ISO 8601.
 */
function isoTimestamp(value: string): string | null {
  const parsed = new Date(
    value.includes("T") ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** A label a vCard reader will understand, or null to write none. */
function typeParam(label: string | null | undefined): string {
  const cleaned = (label ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  return cleaned ? `;TYPE=${cleaned}` : "";
}

/** `PREF` marks the primary value: in 3.0 another TYPE, not 4.0's `PREF=1`. */
function prefParam(isPrimary: boolean | undefined): string {
  return isPrimary ? ";TYPE=PREF" : "";
}

/**
 * One contact as one vCard, with the properties other address books keep.
 * Interactions, scores and briefings belong in the JSON export.
 */
export function serializeVCard(contact: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const push = (line: string) => lines.push(foldLine(line));

  // N is family;given;additional;prefix;suffix, and required by 3.0.
  const guessed =
    contact.firstName || contact.lastName
      ? {
          given: contact.firstName ?? "",
          family: contact.lastName ?? "",
          suffix: "",
        }
      : splitDisplayName(contact.name);
  push(
    `N:${escapeValue(guessed.family)};${escapeValue(guessed.given)};;;${escapeValue(guessed.suffix)}`,
  );
  push(`FN:${escapeValue(contact.name)}`);

  if (contact.company) push(`ORG:${escapeValue(contact.company)}`);
  if (contact.role) push(`TITLE:${escapeValue(contact.role)}`);
  // Apple's form for a day with no year, and nothing for text that is no
  // date: "BDAY:05-14" or "BDAY:sometime in May" is no vCard date.
  const birthday = contact.birthday && vcardBirthdayLine(contact.birthday);
  if (birthday) push(birthday);
  if (contact.about) push(`NOTE:${escapeValue(contact.about)}`);

  for (const email of contact.emails ?? []) {
    if (!email.email) continue;
    push(
      `EMAIL;TYPE=INTERNET${typeParam(email.label)}${prefParam(email.isPrimary)}:${escapeValue(email.email)}`,
    );
  }

  for (const phone of contact.phones ?? []) {
    if (!phone.phone) continue;
    push(
      `TEL${typeParam(phone.label) || ";TYPE=VOICE"}${prefParam(phone.isPrimary)}:${escapeValue(phone.phone)}`,
    );
  }

  for (const address of contact.addresses ?? []) {
    if (!address.address) continue;
    // One free-text address goes in the street slot. Readers show the joined
    // value, and a round trip returns the same string.
    push(
      `ADR${typeParam(address.label)}${prefParam(address.isPrimary)}:;;${escapeValue(address.address)};;;;`,
    );
  }

  if (contact.website) push(`URL:${escapeValue(contact.website)}`);

  for (const link of contact.socialLinks ?? []) {
    if (!link.url) continue;
    // Apple's own property, and the one Apple reads back.
    push(
      `X-SOCIALPROFILE;TYPE=${escapeValue(link.platform || "other")}:${escapeValue(link.url)}`,
    );
  }

  const tags = (contact.tags ?? []).filter(Boolean);
  if (tags.length > 0) {
    // CATEGORIES is a comma-separated list, so each tag is escaped and the
    // separator is a literal comma.
    push(`CATEGORIES:${tags.map(escapeValue).join(",")}`);
  }

  const rev = contact.updatedAt ? isoTimestamp(contact.updatedAt) : null;
  if (rev) push(`REV:${rev}`);

  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** A whole address book. */
export function serializeVCards(contacts: VCardInput[]): string {
  return contacts.map(serializeVCard).join("");
}
