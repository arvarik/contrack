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

import { birthdayValue, parseBirthday, vcardBirthdayLine } from "./birthday.ts";

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

/**
 * Undo folding: a line beginning with a space or a tab continues the one above.
 * A line ends with LF, CRLF or a lone CR, and every CR before an LF belongs to
 * that one line end. Apple Contacts can export each line with CR CR LF: read
 * as a line end and an empty line, the second CR took the continuation, and
 * every folded value, a photo above all, was cut after its first line.
 */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r*\n|\r/)) {
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
 * split before it is unescaped, or `N:Smith\; Jr.;Robert;;;` is cut into the
 * surname "Smith" and the given name " Jr.". Use {@link firstRaw} with
 * {@link splitComponents} or {@link splitList} for those.
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
  // Indexed once per card: a search per property was quadratic.
  let labels = groupLabels.get(card);
  if (!labels) {
    labels = new Map();
    for (const p of card.properties) {
      if (p.group && p.name === "X-ABLABEL" && !labels.has(p.group)) {
        labels.set(p.group, p.value);
      }
    }
    groupLabels.set(card, labels);
  }
  const found = labels.get(group);
  if (found === undefined) return null;
  const label = unescapeValue(found)
    .replace(/_\$!<|>!\$_/g, "")
    .trim();
  return label || null;
}

const groupLabels = new WeakMap<ParsedVCard, Map<string, string>>();

// Writing

/** What a card is built from. Every field is optional except the name. */
export interface VCardInput {
  uid?: string | null;
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
 * semicolon, the format's own separator, which makes a name with one unsafe to
 * guess. A wrong guess files somebody under the wrong letter, and an empty N
 * falls back to FN.
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

/** `PREF` marks the primary value: in 3.0 another TYPE, in 4.0 `PREF=1`. */
function prefParam(isPrimary: boolean | undefined, v4 = false): string {
  if (!isPrimary) return "";
  return v4 ? ";PREF=1" : ";TYPE=PREF";
}

/**
 * Writes an email, phone or address line with its label. A label TYPE cannot
 * carry, such as "old work", goes in Apple's `itemN.X-ABLabel`, which Apple,
 * Nextcloud and DAVx5 read. `item` is the last group number the card uses.
 */
function labeledWriter(push: (line: string) => void, item = 0) {
  return (
    prefix: string,
    label: string | null | undefined,
    fallback: string,
    pref: string,
    value: string,
  ) => {
    const text = (label ?? "").trim();
    if (!text || /^[A-Za-z0-9-]+$/.test(text)) {
      push(`${prefix}${typeParam(text) || fallback}${pref}:${value}`);
      return;
    }
    const group = `item${++item}`;
    push(`${group}.${prefix}${fallback}${pref}:${value}`);
    push(`${group}.X-ABLabel:${escapeValue(text)}`);
  };
}

/**
 * One contact as one vCard, with the properties other address books keep.
 * Interactions, scores and briefings belong in the JSON export.
 */
export function serializeVCard(contact: VCardInput): string {
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];
  const push = (line: string) => lines.push(foldLine(line));

  if (contact.uid) push(`UID:${escapeValue(contact.uid)}`);

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

  const write = labeledWriter(push);
  for (const email of contact.emails ?? []) {
    if (!email.email) continue;
    write(
      "EMAIL;TYPE=INTERNET",
      email.label,
      "",
      prefParam(email.isPrimary),
      escapeValue(email.email),
    );
  }

  for (const phone of contact.phones ?? []) {
    if (!phone.phone) continue;
    write(
      "TEL",
      phone.label,
      ";TYPE=VOICE",
      prefParam(phone.isPrimary),
      escapeValue(phone.phone),
    );
  }

  for (const address of contact.addresses ?? []) {
    if (!address.address) continue;
    // One free-text address goes in the street slot. Readers show the joined
    // value, and a round trip returns the same string.
    write(
      "ADR",
      address.label,
      "",
      prefParam(address.isPrimary),
      `;;${escapeValue(address.address)};;;;`,
    );
  }

  const emittedWebsite = contact.website?.trim().toLowerCase() ?? null;
  if (contact.website) push(`URL:${escapeValue(contact.website)}`);

  for (const link of contact.socialLinks ?? []) {
    if (!link.url) continue;
    const normUrl = link.url.trim().toLowerCase();
    const platform = (link.platform || "other").toLowerCase();
    if (
      (platform === "website" || platform === "homepage") &&
      emittedWebsite === normUrl
    ) {
      continue;
    }
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

// Contact extraction from parsed vCards

/** Profile URL templates, for a handle stored without its URL. */
const SOCIAL_PLATFORM_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/in/{handle}",
  twitter: "https://twitter.com/{handle}",
  github: "https://github.com/{handle}",
  facebook: "https://www.facebook.com/{handle}",
  instagram: "https://www.instagram.com/{handle}",
  youtube: "https://www.youtube.com/@{handle}",
  tiktok: "https://www.tiktok.com/@{handle}",
  mastodon: "https://mastodon.social/@{handle}",
  threads: "https://www.threads.net/@{handle}",
};

/**
 * A social profile's URL and handle. Apple Contacts stores a profile as a
 * full URL, as "x-apple:rowanvale", or as a bare handle.
 */
export function resolveSocialProfile(
  platform: string,
  rawUrl: string,
): { url: string; handle: string | null } {
  const platformKey = platform.toLowerCase();
  let url = rawUrl.trim();
  let handle: string | null = null;

  if (url.startsWith("x-apple:")) {
    url = url.replace("x-apple:", "");
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      // The last path part: /in/rowanvale is rowanvale.
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      handle = pathParts[pathParts.length - 1] || null;
    } catch {
      /* not a valid URL, treat as handle */
    }
    return { url, handle };
  }

  handle = url;
  const template = SOCIAL_PLATFORM_URLS[platformKey];
  if (template) {
    url = template.replace("{handle}", handle);
  } else {
    // An unknown platform keeps the bare handle.
    url = handle;
  }

  return { url, handle };
}

/** Parameters that describe the transport rather than the label. */
const NOISE_TYPES = new Set(["internet", "pref", "voice", "other", "x-apple"]);

/**
 * Names for the same label, folded onto one. Apple writes IPHONE and CELL,
 * Android CELL and Outlook MOBILE, and the app says "mobile" for all of them.
 */
const TYPE_ALIASES: Record<string, string> = {
  cell: "mobile",
  iphone: "mobile",
  main: "work",
  homepage: "website",
};

function labelFor(
  card: ParsedVCard,
  property: VCardProperty,
  fallback: string,
): string {
  const custom = groupLabel(card, property.group);
  if (custom && custom.toLowerCase() !== "other") return custom.toLowerCase();

  const types = (property.params.TYPE ?? []).map((t) => t.toLowerCase());
  const meaningful = types.find((t) => t && !NOISE_TYPES.has(t));
  if (!meaningful) return fallback;
  return TYPE_ALIASES[meaningful] ?? meaningful;
}

/** True when a property carries `TYPE=PREF` (3.0) or `PREF=1` (4.0). */
function isPreferred(property: VCardProperty): boolean {
  return (
    (property.params.TYPE ?? []).some((t) => /^pref$/i.test(t)) ||
    (property.params.PREF ?? []).includes("1")
  );
}

function joinAddress(value: string): string {
  const [, , street, city, region, postal, country] = splitComponents(value);
  return [
    (street ?? "").replace(/\n/g, ", ").trim(),
    (city ?? "").trim(),
    [(region ?? "").trim(), (postal ?? "").trim()].filter(Boolean).join(" "),
    (country ?? "").trim(),
  ]
    .filter(Boolean)
    .join(", ");
}

/** The properties of each contact field, for a patch of some fields. */
export const VCARD_FIELDS = {
  name: ["N", "FN"],
  company: ["ORG"],
  role: ["TITLE"],
  birthday: ["BDAY"],
  about: ["NOTE"],
  emails: ["EMAIL"],
  phones: ["TEL"],
  addresses: ["ADR"],
  web: ["URL", "X-SOCIALPROFILE"],
  tags: ["CATEGORIES"],
} as const;

export type VCardField = keyof typeof VCARD_FIELDS;

const MANAGED_VCARD_NAMES = new Set<string>([
  "BEGIN",
  "END",
  "VERSION",
  "UID",
  "REV",
  ...Object.values(VCARD_FIELDS).flat(),
]);

/** A TEL value without 4.0's `tel:` scheme. */
function telValue(property: VCardProperty): string {
  return unescapeValue(property.value).trim().replace(/^tel:/i, "");
}

/** One primary value: the first marked PREF, or else the first. */
function onePrimary<T extends { isPrimary?: boolean }>(items: T[]): T[] {
  const primary = Math.max(
    0,
    items.findIndex((item) => item.isPrimary),
  );
  items.forEach((item, index) => (item.isPrimary = index === primary));
  return items;
}

/** The same birthday: the same text, or the same day read from both. */
function sameBirthday(a: string, b: string): boolean {
  if (a.trim() === b.trim()) return true;
  const x = parseBirthday(a);
  const y = parseBirthday(b);
  return Boolean(
    x && y && x.year === y.year && x.month === y.month && x.day === y.day,
  );
}

/**
 * Update an existing vCard with the fields Contrack manages while keeping
 * properties Contrack does not own (`PHOTO`, `NICKNAME`, structured `ADR`
 * components, Apple `itemN.X-ABLabel` labels, `UID`, and every `X-*` property).
 * The card keeps its version, and a value that did not change keeps its own
 * line. With `fields`, only those fields are written, and the card keeps the
 * others as they are.
 */
export function patchVCard(
  existingVCard: string,
  contact: VCardInput,
  fields?: ReadonlySet<VCardField>,
): string {
  const existingCard = parseVCards(existingVCard)[0];
  if (!existingCard) return serializeVCard(contact);

  const entries: Array<{ rawLine: string; prop: VCardProperty }> = [];
  let inCard = false;
  for (const line of unfold(existingVCard.replace(/^\uFEFF/, ""))) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      inCard = true;
      continue;
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      break;
    }
    const prop = inCard ? parseContentLine(line) : null;
    if (prop) entries.push({ rawLine: line, prop });
  }

  if (entries.length === 0) return serializeVCard(contact);

  const writes = (field: VCardField) => !fields || fields.has(field);
  const v4 = (firstValue(existingCard, "VERSION") ?? "").trim() === "4.0";
  const pref = (isPrimary: boolean | undefined) => prefParam(isPrimary, v4);

  const groupLabelLines = new Map<string, string>();
  const managedGroups = new Set<string>();
  let lastItem = 0;
  /** The card's lines by property and a key of their value, in card order. */
  const byKey = new Map<string, number[]>();
  /** The line of each property that extraction reads as the primary one. */
  const primaryLine = new Map<string, number>();
  const keyOf = (prop: VCardProperty): string | null => {
    switch (prop.name) {
      case "EMAIL":
      case "URL":
        return unescapeValue(prop.value).trim().toLowerCase();
      case "TEL":
        return telValue(prop);
      case "ADR":
        return joinAddress(prop.value);
      case "X-SOCIALPROFILE": {
        const platform = (prop.params.TYPE?.[0] ?? "other").toLowerCase();
        const { url } = resolveSocialProfile(
          platform,
          unescapeValue(prop.value).trim(),
        );
        return `${platform}\0${url.trim().toLowerCase()}`;
      }
      default:
        return null;
    }
  };
  const firstPref = new Map<string, number>();
  entries.forEach(({ rawLine, prop }, index) => {
    if (prop.name === "X-ABLABEL" && prop.group) {
      groupLabelLines.set(prop.group, rawLine);
    } else if (prop.group && MANAGED_VCARD_NAMES.has(prop.name)) {
      managedGroups.add(prop.group);
    }
    const item = /^item(\d+)$/i.exec(prop.group ?? "");
    if (item) lastItem = Math.max(lastItem, Number(item[1]));
    const key = keyOf(prop);
    if (!key) return;
    const slot = `${prop.name}\0${key}`;
    const list = byKey.get(slot);
    if (list) list.push(index);
    else byKey.set(slot, [index]);
    if (!primaryLine.has(prop.name)) primaryLine.set(prop.name, index);
    if (isPreferred(prop) && !firstPref.has(prop.name)) {
      firstPref.set(prop.name, index);
    }
  });
  for (const [name, index] of firstPref) primaryLine.set(name, index);

  const lines: string[] = ["BEGIN:VCARD", `VERSION:${v4 ? "4.0" : "3.0"}`];
  const push = (line: string) => lines.push(foldLine(line));
  const write = labeledWriter(push, lastItem);
  const pushGroupLabel = (group: string | null) => {
    if (group && groupLabelLines.has(group)) {
      push(groupLabelLines.get(group)!);
    }
  };
  /** The card's own line, with its Apple label. */
  const keep = (index: number) => {
    push(entries[index]!.rawLine);
    pushGroupLabel(entries[index]!.prop.group);
  };
  /** Every line of a field Contrack does not write, as the card has it. */
  const keepField = (field: VCardField) => {
    const names: readonly string[] = VCARD_FIELDS[field];
    entries.forEach(({ prop }, index) => {
      if (names.includes(prop.name)) keep(index);
    });
  };
  /** The next line of `name` whose value has this key, or -1. */
  const take = (name: string, key: string): number => {
    return byKey.get(`${name}\0${key}`)?.shift() ?? -1;
  };

  // Preserve the server card's existing UID if present
  const existingUidEntry = entries.find(
    (e) => e.prop.name === "UID" && unescapeValue(e.prop.value).trim(),
  );
  if (existingUidEntry) {
    push(existingUidEntry.rawLine);
  } else if (contact.uid) {
    push(`UID:${escapeValue(contact.uid)}`);
  }

  if (writes("name")) {
    // N: preserve middle name, prefix, and suffix from the existing card
    const guessed =
      contact.firstName || contact.lastName
        ? {
            given: contact.firstName ?? "",
            family: contact.lastName ?? "",
            suffix: "",
          }
        : splitDisplayName(contact.name);
    const existingNRaw = firstRaw(existingCard, "N");
    const nParts = existingNRaw !== null ? splitComponents(existingNRaw) : [];
    const additional = nParts[2] ?? "";
    const prefix = nParts[3] ?? "";
    const suffix = guessed.suffix || (nParts[4] ?? "");
    push(
      `N:${escapeValue(guessed.family)};${escapeValue(guessed.given)};${escapeValue(additional)};${escapeValue(prefix)};${escapeValue(suffix)}`,
    );
    push(`FN:${escapeValue(contact.name)}`);
  } else {
    keepField("name");
  }

  if (!writes("company")) {
    keepField("company");
  } else if (contact.company) {
    const existingOrgRaw = firstRaw(existingCard, "ORG");
    const orgParts =
      existingOrgRaw !== null ? splitComponents(existingOrgRaw) : [];
    if (
      existingOrgRaw !== null &&
      (orgParts[0] ?? "").trim() === contact.company.trim()
    ) {
      push(`ORG:${existingOrgRaw}`);
    } else {
      push(`ORG:${escapeValue(contact.company)}`);
    }
  }
  if (!writes("role")) keepField("role");
  else if (contact.role) push(`TITLE:${escapeValue(contact.role)}`);

  if (!writes("birthday")) {
    keepField("birthday");
  } else if (contact.birthday) {
    // The card's own line when it says the same day, so a form the parser
    // cannot read ("1985", "---14", a date-time) is not dropped or redrawn.
    const own = entries.findIndex((e) => e.prop.name === "BDAY");
    const parsed = parseBirthday(contact.birthday);
    if (
      own >= 0 &&
      sameBirthday(unescapeValue(entries[own]!.prop.value), contact.birthday)
    ) {
      keep(own);
    } else if (v4 && parsed && parsed.year === null) {
      push(`BDAY:--${birthdayValue(parsed).replace("-", "")}`);
    } else {
      const birthday = vcardBirthdayLine(contact.birthday);
      if (birthday) push(birthday);
    }
  }
  if (!writes("about")) keepField("about");
  else if (contact.about) push(`NOTE:${escapeValue(contact.about)}`);

  /** The card's line for a value: kept, relabeled in its group, or null. */
  const reuse = (
    name: string,
    key: string,
    label: string,
    fallbackLabel: string,
    isPrimary: boolean | undefined,
    relabeled: (group: string, prop: VCardProperty) => string,
  ): boolean => {
    const index = take(name, key);
    if (index < 0) return false;
    const prop = entries[index]!.prop;
    const sameLabel =
      labelFor(existingCard, prop, fallbackLabel) === label.toLowerCase();
    const samePref = (primaryLine.get(name) === index) === Boolean(isPrimary);
    if (sameLabel && samePref) {
      keep(index);
      return true;
    }
    if (sameLabel && prop.group && groupLabelLines.has(prop.group)) {
      push(relabeled(prop.group, prop));
      pushGroupLabel(prop.group);
      return true;
    }
    return false;
  };

  if (!writes("emails")) {
    keepField("emails");
  } else {
    for (const email of contact.emails ?? []) {
      if (!email.email) continue;
      const reused = reuse(
        "EMAIL",
        email.email.trim().toLowerCase(),
        email.label || "personal",
        "personal",
        email.isPrimary,
        (group) =>
          `${group}.EMAIL;TYPE=INTERNET${pref(email.isPrimary)}:${escapeValue(email.email)}`,
      );
      if (reused) continue;
      write(
        "EMAIL;TYPE=INTERNET",
        email.label,
        "",
        pref(email.isPrimary),
        escapeValue(email.email),
      );
    }
  }

  if (!writes("phones")) {
    keepField("phones");
  } else {
    for (const phone of contact.phones ?? []) {
      if (!phone.phone) continue;
      const reused = reuse(
        "TEL",
        phone.phone.trim(),
        phone.label || "mobile",
        "mobile",
        phone.isPrimary,
        (group) =>
          `${group}.TEL;TYPE=VOICE${pref(phone.isPrimary)}:${escapeValue(phone.phone)}`,
      );
      if (reused) continue;
      write(
        "TEL",
        phone.label,
        ";TYPE=VOICE",
        pref(phone.isPrimary),
        escapeValue(phone.phone),
      );
    }
  }

  if (!writes("addresses")) {
    keepField("addresses");
  } else {
    for (const address of contact.addresses ?? []) {
      if (!address.address) continue;
      const key = address.address.trim();
      const before = byKey.get(`ADR\0${key}`)?.[0];
      const reused = reuse(
        "ADR",
        key,
        address.label || "home",
        "home",
        address.isPrimary,
        (group, prop) => `${group}.ADR${pref(address.isPrimary)}:${prop.value}`,
      );
      if (reused) continue;
      // Keep the structured ADR components even when label or primary changed
      write(
        "ADR",
        address.label,
        "",
        pref(address.isPrimary),
        before !== undefined
          ? entries[before]!.prop.value
          : `;;${escapeValue(address.address)};;;;`,
      );
    }
  }

  if (!writes("web")) {
    keepField("web");
  } else {
    const emittedWebsite = contact.website?.trim().toLowerCase() ?? null;
    if (contact.website) {
      const index = take("URL", emittedWebsite!);
      if (index >= 0) keep(index);
      else push(`URL:${escapeValue(contact.website)}`);
    }

    for (const link of contact.socialLinks ?? []) {
      if (!link.url) continue;
      const normUrl = link.url.trim().toLowerCase();
      const platform = (link.platform || "other").toLowerCase();
      if (
        (platform === "website" || platform === "homepage") &&
        emittedWebsite === normUrl
      ) {
        continue;
      }
      let index = take("X-SOCIALPROFILE", `${platform}\0${normUrl}`);
      if (index < 0) index = take("URL", normUrl);
      if (index >= 0) {
        keep(index);
        continue;
      }
      push(
        `X-SOCIALPROFILE;TYPE=${escapeValue(link.platform || "other")}:${escapeValue(link.url)}`,
      );
    }
  }

  const tags = (contact.tags ?? []).filter(Boolean);
  const cardTags = valuesOf(existingCard, "CATEGORIES").flatMap((p) =>
    splitList(p.value)
      .map((t) => t.trim())
      .filter(Boolean),
  );
  const sorted = (list: string[]) => JSON.stringify([...list].sort());
  if (
    !writes("tags") ||
    (tags.length > 0 && sorted(tags) === sorted(cardTags))
  ) {
    // Every CATEGORIES line the card has, when the tags are the same.
    keepField("tags");
  } else if (tags.length > 0) {
    push(`CATEGORIES:${tags.map(escapeValue).join(",")}`);
  }

  // Keep every property that Contrack does not manage (PHOTO, NICKNAME, X-*, etc.)
  for (const { rawLine, prop } of entries) {
    if (MANAGED_VCARD_NAMES.has(prop.name)) continue;
    if (
      prop.name === "X-ABLABEL" &&
      prop.group &&
      managedGroups.has(prop.group)
    ) {
      continue;
    }
    push(rawLine);
  }

  const rev = contact.updatedAt ? isoTimestamp(contact.updatedAt) : null;
  if (rev) push(`REV:${rev}`);

  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

export interface ExtractedVCardContact {
  uid: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  role: string | null;
  location: string | null;
  birthday: string | null;
  about: string | null;
  website: string | null;
  avatarUrl: string | null;
  emails: { email: string; label?: string; isPrimary?: boolean }[];
  phones: { phone: string; label?: string; isPrimary?: boolean }[];
  addresses: { address: string; label?: string; isPrimary?: boolean }[];
  socialLinks: { platform: string; url: string; handle?: string | null }[];
  tags: string[];
}

/**
 * Extract structured contacts from vCard text (3.0 or 4.0). Skips Apple
 * iCloud group cards (`X-ADDRESSBOOKSERVER-KIND:group`) and vCard 4.0
 * non-individual cards (`KIND:group`), as well as cards without a name.
 */
export function extractVCardContacts(vcardData: string): {
  contacts: ExtractedVCardContact[];
  totalCards: number;
} {
  const contacts: ExtractedVCardContact[] = [];
  const cards = parseVCards(vcardData);

  for (const card of cards) {
    const kind =
      firstValue(card, "X-ADDRESSBOOKSERVER-KIND") ?? firstValue(card, "KIND");
    if (kind && /^group$/i.test(kind.trim())) continue;

    // A card with no name is not a contact anyone can use. FN is required by
    // the specification; N is the fallback for exporters that skip it.
    const nComponents = splitComponents(firstRaw(card, "N") ?? "");
    const lastName = (nComponents[0] ?? "").trim() || null;
    const firstName = (nComponents[1] ?? "").trim() || null;

    const name =
      (firstValue(card, "FN") ?? "").trim() ||
      [firstName, lastName].filter(Boolean).join(" ").trim();
    if (!name) continue;

    const emails: ExtractedVCardContact["emails"] = [];
    const seenEmails = new Set<string>();
    for (const property of valuesOf(card, "EMAIL")) {
      const email = unescapeValue(property.value).trim();
      if (!email || seenEmails.has(email.toLowerCase())) continue;
      seenEmails.add(email.toLowerCase());
      emails.push({
        email,
        label: labelFor(card, property, "personal"),
        isPrimary: isPreferred(property),
      });
    }

    const phones: ExtractedVCardContact["phones"] = [];
    for (const property of valuesOf(card, "TEL")) {
      const phone = telValue(property);
      if (!phone) continue;
      phones.push({
        phone,
        label: labelFor(card, property, "mobile"),
        isPrimary: isPreferred(property),
      });
    }

    const addresses: ExtractedVCardContact["addresses"] = [];
    for (const property of valuesOf(card, "ADR")) {
      const address = joinAddress(property.value);
      if (!address) continue;
      addresses.push({
        address,
        label: labelFor(card, property, "home"),
        isPrimary: isPreferred(property),
      });
    }
    onePrimary(emails);
    onePrimary(phones);
    onePrimary(addresses);

    const socialLinks: ExtractedVCardContact["socialLinks"] = [];
    for (const property of valuesOf(card, "X-SOCIALPROFILE")) {
      const raw = unescapeValue(property.value).trim();
      if (!raw) continue;
      const platform = (property.params.TYPE?.[0] ?? "other").toLowerCase();
      const resolved = resolveSocialProfile(platform, raw);
      socialLinks.push({
        platform,
        url: resolved.url,
        handle: resolved.handle,
      });
    }

    const seenUrls = new Set(socialLinks.map((s) => s.url.toLowerCase()));
    for (const property of valuesOf(card, "URL")) {
      const url = unescapeValue(property.value).trim();
      if (!url || seenUrls.has(url.toLowerCase())) continue;
      seenUrls.add(url.toLowerCase());
      const label = labelFor(card, property, "website");
      socialLinks.push({
        platform: label === "homepage" ? "website" : label,
        url,
        handle: null,
      });
    }

    // Base64 in 3.0 (`PHOTO;ENCODING=b;TYPE=JPEG:`), a data URI or a plain URL
    // in 4.0. Folding is already undone, so the value is whole either way.
    let avatarUrl: string | null = null;
    const photo = valuesOf(card, "PHOTO")[0];
    if (photo) {
      const value = photo.value.replace(/\s+/g, "");
      if (value.startsWith("data:") || /^https?:/i.test(value)) {
        avatarUrl = value;
      } else if (value) {
        // 3.0 says JPEG, and some servers image/jpeg, the media type 4.0 has.
        const type = (
          photo.params.MEDIATYPE?.[0] ??
          photo.params.TYPE?.[0] ??
          "jpeg"
        )
          .toLowerCase()
          .replace(/^image\//, "");
        avatarUrl = `data:image/${type};base64,${value}`;
      }
    }

    const org = splitComponents(firstRaw(card, "ORG") ?? "");
    const website =
      socialLinks.find(
        (s) => s.platform === "website" || s.platform === "homepage",
      )?.url ?? null;

    // Every CATEGORIES line: a card can have more than one.
    const tags = [
      ...new Set(
        valuesOf(card, "CATEGORIES").flatMap((p) =>
          splitList(p.value)
            .map((t) => t.trim())
            .filter(Boolean),
        ),
      ),
    ];

    contacts.push({
      uid: (firstValue(card, "UID") ?? "").trim() || null,
      name,
      firstName,
      lastName,
      company: (org[0] ?? "").trim() || null,
      role: (firstValue(card, "TITLE") ?? "").trim() || null,
      birthday: (firstValue(card, "BDAY") ?? "").trim() || null,
      about: (firstValue(card, "NOTE") ?? "").trim() || null,
      location:
        addresses.find((a) => a.isPrimary)?.address ??
        addresses[0]?.address ??
        null,
      website,
      avatarUrl,
      emails,
      phones,
      addresses,
      socialLinks,
      tags,
    });
  }

  return { contacts, totalCards: cards.length };
}
