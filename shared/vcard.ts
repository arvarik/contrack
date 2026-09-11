// =============================================================================
// vCard 3.0 — reading and writing
// =============================================================================
// One module, shared by the server's export and the browser's import, because
// the promise being made is a round trip: a .vcf this app writes has to be a
// .vcf this app reads back with nothing lost. Two implementations could not
// hold that promise, and the round-trip test would be testing a coincidence.
//
// ── Why 3.0 and not 4.0 ────────────────────────────────────────────────────
// RFC 6350 (vCard 4.0) is the current standard and almost nothing imports it.
// Apple Contacts, Google Contacts and Outlook all export 3.0 and all read 3.0.
// An export nobody can open is not an escape hatch, so the version here is the
// one the destinations accept.
//
// ── What makes a vCard parser hard ─────────────────────────────────────────
// The format looks like key-value pairs and is not. Four things bite, and each
// was a real failure of the regular expressions this replaces:
//
//   1. FOLDING. A line longer than 75 octets is continued on the next line,
//      which begins with one space or tab. `^FN:(.*)$` reads half a name.
//   2. ESCAPING. A comma, a semicolon, a backslash or a newline inside a value
//      is backslash-escaped. Splitting on a raw `;` cuts "Smith\; Jr." in two.
//   3. PARAMETERS. `TEL;TYPE=WORK,VOICE:...`, `TEL;WORK;VOICE:...` (the 2.1
//      shorthand, still emitted by phones), and `TEL;TYPE="WORK,VOICE":...`
//      are the same property written three ways.
//   4. ENCODING. `ENCODING=QUOTED-PRINTABLE` appears throughout exports from
//      older Android and Outlook builds, and reads as mojibake without it.
//
// So this parses properly: unfold, split the content line, decode, and hand
// back a structure. Nothing above the parser has to know about any of it.
// =============================================================================

// ---------------------------------------------------------------------------
// The shape a parsed card takes
// ---------------------------------------------------------------------------

/** One property line, after unfolding, parameter parsing and decoding. */
export interface VCardProperty {
  /** Apple groups related lines with `item1.`, `item2.` and so on. */
  group: string | null;
  /** Upper-cased: `FN`, `TEL`, `X-SOCIALPROFILE`. */
  name: string;
  /**
   * Parameters, upper-cased keys, values as given.
   *
   * A parameter can repeat (`TYPE=WORK;TYPE=VOICE`) and can carry a
   * comma-separated list (`TYPE=WORK,VOICE`). Both flatten into one array, so
   * a caller asking "is this a work number" never has to care which form the
   * exporter chose.
   */
  params: Record<string, string[]>;
  /** The value, unescaped and decoded. Structured values keep their `;`. */
  value: string;
}

/** One BEGIN:VCARD … END:VCARD block. */
export interface ParsedVCard {
  properties: VCardProperty[];
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

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
 * Split a structured value (`N`, `ADR`, `ORG`) on unescaped semicolons.
 *
 * Splitting on `/;/` instead cuts inside any component that contains one, and
 * a surname of "Smith; Jr." is exactly the kind of value that is escaped for a
 * reason.
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

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/** The line length RFC 2426 asks for, not counting the CRLF. */
const FOLD_AT = 75;

/**
 * Fold one content line.
 *
 * Counted in UTF-16 code units rather than octets, and never inside a
 * surrogate pair. The specification counts octets, but every reader in
 * practice accepts a shorter line, and splitting an emoji in half produces a
 * file that is not valid UTF-8 at all.
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

// ---------------------------------------------------------------------------
// Quoted-printable
// ---------------------------------------------------------------------------

/**
 * Decode `ENCODING=QUOTED-PRINTABLE`, UTF-8 aware.
 *
 * `=C3=A9` is two octets of one character, so the bytes are gathered and
 * decoded together rather than one at a time — decoding each `=XX` on its own
 * turns "José" into "JosÃ©", which is the classic symptom of an address book
 * imported from an older phone.
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

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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
 * Every card in a file.
 *
 * A `.vcf` holding a thousand contacts is one file of a thousand cards, which
 * is how every address book exports. Anything outside a BEGIN/END pair is
 * ignored rather than treated as an error: files gain stray blank lines and
 * byte-order marks in transit, and refusing a whole import over one is not a
 * migration path.
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
 * The first value of one property, unescaped. Null when there is none.
 *
 * For SIMPLE values only — `FN`, `TITLE`, `NOTE`, `BDAY`. A structured value
 * (`N`, `ORG`, `ADR`) or a list (`CATEGORIES`) must be split BEFORE it is
 * unescaped, or an escaped separator inside a component becomes a real one and
 * the value is cut in two. Use {@link firstRaw} with {@link splitComponents}
 * or {@link splitList} for those.
 *
 * That ordering is not a style preference. `N:Smith\; Jr.;Robert;;;` is one
 * surname and one given name; unescaping first turns it into a surname of
 * "Smith" and a given name of " Jr.".
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
 * Split a comma-separated list (`CATEGORIES`, `NICKNAME`) and unescape each.
 *
 * Same rule as {@link splitComponents}, one separator along: a tag containing
 * a comma was escaped for a reason.
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

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

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
 * Generational and honorific suffixes that belong in N's fifth component.
 *
 * Without this "Martin Luther King Jr." exports with a family name of "Jr.",
 * which is how a contact ends up filed under J in a phone.
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
export interface SplitName {
  given: string;
  family: string;
  suffix: string;
}

/**
 * Guess `N` from a display name.
 *
 * Only used when the contact has neither a first nor a last name of its own,
 * which is the common case for somebody added by hand: the app asks for one
 * name field. `N` is required by vCard 3.0 and many address books sort and
 * group by it, so exporting `N:;;;;` files every contact under nothing.
 *
 * Deliberately conservative. Two shapes are recognised — "Family, Given" and
 * "Given … Family" — and anything with a semicolon in it is left alone,
 * because a name that already contains the format's own separator is one this
 * cannot be confident about. A wrong guess is worse than an empty N: an empty
 * one falls back to FN, a wrong one files somebody under the wrong letter.
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
 * A timestamp `REV` can carry.
 *
 * SQLite writes `2026-09-11 19:35:49` and the app writes ISO, so the column
 * holds both. RFC 2426 wants ISO 8601, and a space where the `T` belongs is
 * not a date-time any reader has to accept.
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

/**
 * `PREF` marks the primary value.
 *
 * vCard 3.0 spells it as another TYPE rather than as 4.0's `PREF=1`, and
 * readers that ignore it lose only the ordering.
 */
function prefParam(isPrimary: boolean | undefined): string {
  return isPrimary ? ";TYPE=PREF" : "";
}

/**
 * One contact as one vCard.
 *
 * The property set is chosen for what survives a round trip through other
 * address books, not for completeness. Interactions, relationship scores and
 * AI briefings are not contact-card fields and belong in the JSON export,
 * which is the one that loses nothing.
 */
export function serializeVCard(contact: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const push = (line: string) => lines.push(foldLine(line));

  // N is structured: family;given;additional;prefix;suffix. Required by 3.0,
  // and a reader that only understands N shows nothing without it.
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
  if (contact.birthday) push(`BDAY:${escapeValue(contact.birthday)}`);
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
    // Contrack keeps one free-text address rather than seven components, so it
    // goes in the street slot. Every reader shows the joined value, and a
    // round trip through this module gets the same string back.
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
