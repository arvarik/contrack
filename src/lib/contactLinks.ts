/**
 * The ways a contact leaves the app: a call, a text, an email, and a card
 * that another address book can import.
 *
 * A phone number is one tap from a call only when it is a `tel:` link, and a
 * contact goes into the phone's own address book only as a vCard. These
 * functions are pure, so the unit test reads what they write.
 *
 * @module lib/contactLinks
 */
import { parseBirthday } from "./birthday";

/** "x 123", "ext. 123" or "extension 123" at the end of a number. */
const EXTENSION = /\s*(?:ext(?:ension)?\.?|x)\s*(\d+)\s*$/i;

/**
 * The number as a dialler reads it: a leading "+", the digits, and the marks
 * "*", "#" and ",". Spaces, brackets, dots and dashes go. An extension
 * follows a "," (a pause), which every phone dials after the call connects.
 * The trunk "(0)" after a country code goes too: "+44 (0) 20" is dialled as
 * "+4420". Null when the text holds no digit, or a letter, such as
 * "1-800-FLOWERS": dropping the letters would dial a wrong, short number.
 */
function dialString(phone: string): string | null {
  const trimmed = phone.trim();
  const extension = trimmed.match(EXTENSION);
  const main = (
    extension ? trimmed.slice(0, extension.index) : trimmed
  ).replace(/^(\+\d{1,3})\s*\(0\)/, "$1");
  if (/\p{L}/u.test(main)) return null;
  const digits = main.replace(/[^0-9*#,]/g, "");
  if (!/\d/.test(digits)) return null;
  const plus = main.startsWith("+") ? "+" : "";
  return `${plus}${digits}${extension ? `,${extension[1]}` : ""}`;
}

/**
 * The `tel:` link for a phone number: "+1 (555) 010-2030" calls
 * "tel:+15550102030". Null when the text holds no digit, so the caller shows
 * plain text and no link that dials nothing.
 */
export function telHref(phone: string): string | null {
  const dial = dialString(phone);
  return dial ? `tel:${dial}` : null;
}

/** The `sms:` link that starts a text to a phone number, or null. */
export function smsHref(phone: string): string | null {
  const dial = dialString(phone);
  return dial ? `sms:${dial}` : null;
}

/**
 * The `mailto:` link for an email address. The address is encoded, so a
 * value such as "a@b.com?body=x" cannot add a subject or a body to the mail.
 */
export function mailtoHref(email: string): string {
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}`;
}

// ---------------------------------------------------------------------------
// vCard
// ---------------------------------------------------------------------------

/** What a vCard reads from a contact. A full `Contact` fits. */
export interface VCardSource {
  name: string;
  role?: string | null;
  company?: string | null;
  emails?: readonly { email: string; label?: string | null }[];
  phones?: readonly { phone: string; label?: string | null }[];
  addresses?: readonly { address: string; label?: string | null }[];
  /** The one place of an older contact that has no address list. */
  location?: string | null;
  birthday?: string | null;
  website?: string | null;
  socialLinks?: readonly { url: string }[];
}

/** The vCard TYPE of each label the contact page offers. */
const EMAIL_TYPE: Record<string, string> = { work: "WORK", personal: "HOME" };
const PHONE_TYPE: Record<string, string> = {
  mobile: "CELL",
  work: "WORK",
  home: "HOME",
};
const ADDRESS_TYPE: Record<string, string> = { home: "HOME", work: "WORK" };

/**
 * A text value as vCard 3.0 writes it (RFC 2426, 4): a backslash, a comma
 * and a semicolon take a backslash, and a line break becomes "\n".
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** A last word that is a suffix, not a family name: "Jr.", "III", "PhD". */
const SUFFIX = /^(?:jr|sr|ii|iii|iv|v|phd|md|esq)\.?$/i;

/** Bytes per line before a fold, as RFC 2425 asks. */
const FOLD_OCTETS = 75;

const encoder = new TextEncoder();

/**
 * One content line, folded every 75 octets: CRLF and a space start each
 * continued line. The fold counts UTF-8 bytes and never cuts a character.
 */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // A continued line starts with a space, which takes one octet.
    const limit = parts.length === 0 ? FOLD_OCTETS : FOLD_OCTETS - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** "TYPE=WORK,PREF" for the first value of its kind, "TYPE=WORK" after it. */
function typeParam(types: (string | undefined)[], first: boolean): string {
  const list = [...types, first ? "PREF" : undefined].filter(Boolean);
  return list.length ? `;TYPE=${list.join(",")}` : "";
}

/**
 * The birthday as vCard writes a date: "1990-05-14", or "--05-14" when the
 * year is not known. Null for text that is no date.
 */
function vCardDate(birthday: string): string | null {
  const parsed = parseBirthday(birthday);
  if (!parsed) return null;
  const monthDay = `${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")}`;
  return parsed.year === null
    ? `--${monthDay}`
    : `${String(parsed.year).padStart(4, "0")}-${monthDay}`;
}

/**
 * A contact as a vCard 3.0 card, the version that iOS, Android and the
 * desktop address books all import.
 *
 * 1. The name, as FN, and as N split at its last space: "Ada Lovelace" is
 *    the family name "Lovelace" and the given name "Ada". A suffix such as
 *    "Jr." stays a suffix. A contact with no name is named by its company
 *    or its email, because an importer refuses an empty FN.
 * 2. The company and the role, as ORG and TITLE.
 * 3. Each email, phone and address, in the contact's order, with its label
 *    as a TYPE. The first of each kind is the preferred one (PREF), as it is
 *    the primary one on the contact page. An address is free text, so it
 *    fills the street part of ADR.
 * 4. The birthday, the website and each social link.
 *
 * Lines end in CRLF and fold at 75 octets.
 */
export function buildVCard(contact: VCardSource): string {
  const name =
    contact.name.trim() ||
    contact.company?.trim() ||
    contact.emails?.[0]?.email.trim() ||
    "Unnamed contact";
  const words = contact.name.trim().split(/\s+/).filter(Boolean);
  const suffix =
    words.length > 2 && SUFFIX.test(words[words.length - 1])
      ? words.pop()!
      : "";
  const family = words.length > 1 ? words.pop()! : "";
  const given = words.join(" ");

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeText(family)};${escapeText(given)};;;${escapeText(suffix)}`,
    `FN:${escapeText(name)}`,
  ];
  if (contact.company?.trim())
    lines.push(`ORG:${escapeText(contact.company.trim())}`);
  if (contact.role?.trim())
    lines.push(`TITLE:${escapeText(contact.role.trim())}`);

  (contact.emails ?? []).forEach(({ email, label }, index) => {
    if (!email.trim()) return;
    const type = typeParam(["INTERNET", EMAIL_TYPE[label ?? ""]], index === 0);
    lines.push(`EMAIL${type}:${escapeText(email.trim())}`);
  });
  (contact.phones ?? []).forEach(({ phone, label }, index) => {
    if (!phone.trim()) return;
    const type = typeParam([PHONE_TYPE[label ?? ""]], index === 0);
    lines.push(`TEL${type}:${escapeText(phone.trim())}`);
  });
  const addresses = contact.addresses?.length
    ? contact.addresses
    : contact.location
      ? [{ address: contact.location, label: "home" }]
      : [];
  addresses.forEach(({ address, label }, index) => {
    if (!address.trim()) return;
    const type = typeParam([ADDRESS_TYPE[label ?? ""]], index === 0);
    lines.push(`ADR${type}:;;${escapeText(address.trim())};;;;`);
  });

  const birthday = contact.birthday ? vCardDate(contact.birthday) : null;
  if (birthday) lines.push(`BDAY:${birthday}`);
  const urls = [
    contact.website,
    ...(contact.socialLinks ?? []).map((link) => link.url),
  ].filter((url): url is string => !!url?.trim());
  // A URL is a URI value, which vCard 3.0 writes as it is, with no text
  // escaping (RFC 2426, 3.6.8). Only a line break could break the card.
  for (const url of new Set(urls))
    lines.push(`URL:${url.trim().replace(/[\r\n]/g, "")}`);

  lines.push("END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/**
 * The card's file name: the contact's name with the characters a file
 * system refuses taken out, at most 80 characters, with no dot or space at
 * the end (which Windows refuses), and ".vcf". "contact.vcf" when nothing is
 * left.
 */
export function vCardFileName(name: string): string {
  const safe = [
    ...name
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\p{Cc}/gu, "")
      .trim(),
  ]
    .slice(0, 80)
    .join("")
    .replace(/[.\s]+$/u, "");
  return `${safe || "contact"}.vcf`;
}
