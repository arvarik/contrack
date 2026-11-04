/**
 * Email normalization for connectors, from IMAP (imapflow and mailparser) and
 * Google Workspace (Gmail API metadata or full format):
 * 1. A NormalizedEmail shape for interactions.
 * 2. Clean thread subjects ("Re:", "Fwd:" and brackets stripped).
 * 3. Direction ("in" or "out") from the account owner's addresses and aliases.
 * 4. Headers only by default; body text only when summaries are on.
 *
 * @module server/connectors/email/normalize
 */

import type { Participant } from "../../../shared/connectors.ts";
import { trimChars } from "../../utils/helpers.ts";

export interface NormalizedEmail {
  externalId: string;
  messageId?: string;
  inReplyTo?: string;
  date: string; // ISO string
  subject: string;
  title: string; // Cleaned title for interaction/thread
  direction: "in" | "out";
  participants: Participant[];
  from: Participant[];
  to: Participant[];
  cc: Participant[];
  bodyText?: string;
  snippet?: string;
  raw?: unknown;
}

export interface RawAddressInput {
  name?: string | null;
  address?: string | null;
  email?: string | null;
}

export interface RawEmailInput {
  externalId?: string;
  messageId?: string | null;
  inReplyTo?: string | null;
  date?: Date | string | number | null;
  subject?: string | null;
  from?: RawAddressInput | RawAddressInput[] | string | null;
  to?: RawAddressInput | RawAddressInput[] | string | null;
  cc?: RawAddressInput | RawAddressInput[] | string | null;
  bodyText?: string | null;
  snippet?: string | null;
  raw?: unknown;
}

export interface NormalizeEmailOptions {
  selfEmails: string[];
  aliases?: string[];
  includeBody?: boolean;
}

/**
 * Normalizes an email address by trimming whitespace and converting to lowercase.
 */
export function normalizeEmailAddress(
  email: string | null | undefined,
): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

/** Brackets, quotes, list punctuation and spaces around an address. */
const STRAY = /[<>"',;\s]/;

/**
 * The mailbox an address reaches, so that two spellings of one mailbox are one
 * person: lower case, without stray brackets, quotes or list punctuation,
 * without a "+tag" (sub-addressing), and for Gmail without dots, which Gmail
 * ignores. "Ana.Lee+news@GoogleMail.com," and "analee@gmail.com" give
 * "analee@gmail.com".
 */
export function canonicalEmailAddress(
  email: string | null | undefined,
): string {
  const address = trimChars(normalizeEmailAddress(email), STRAY);
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  let local = address.slice(0, at);
  let domain = address.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") local = local.replace(/\./g, "");
  return `${local}@${domain}`;
}

/** A mailbox no one reads, by its whole local part. */
const NO_REPLY = /^(no-?reply|do-?not-?reply)([._-]|$)/;

/**
 * Words that name a role or a robot, not a person, when one is any word of a
 * local part: "billing", "access-support", "salesforce_customercare",
 * "unsubscribe-<token>".
 */
const ROLE_WORDS = new Set([
  "noreply",
  "donotreply",
  "notification",
  "notifications",
  "notify",
  "alert",
  "alerts",
  "mailer-daemon",
  "mailerdaemon",
  "postmaster",
  "bounce",
  "bounces",
  "billing",
  "invoice",
  "invoices",
  "statement",
  "statements",
  "receipt",
  "receipts",
  "order",
  "orders",
  "support",
  "helpdesk",
  "help",
  "info",
  "news",
  "newsletter",
  "newsletters",
  "marketing",
  "update",
  "updates",
  "digest",
  "account",
  "accounts",
  "unsubscribe",
  "customercare",
  "customerservice",
  "events",
  "trips",
  "reservations",
  "bookings",
  "tickets",
  "feedback",
  "surveys",
  "promotions",
  "offers",
]);

/** Mailboxes of devices and relays, never of a person: Send to Kindle. */
const DEVICE_DOMAINS = new Set(["kindle.com", "free.kindle.com"]);

/**
 * Hosts that send bulk mail for a company: email.example.com and the like. One
 * with only a top-level domain after the label is a mail provider (mail.ru,
 * email.cz), and "mail." alone is often a school's or a company's own mail
 * (mail.utoronto.ca), so neither counts.
 * ponytail: no public suffix list, so a provider under a two-part suffix, such
 * as email.com.br, still counts. Add one if that turns up.
 */
const BULK_HOST =
  /^(e|em|email|emails|mailer|mailing|news|newsletters?|notifications?|notify|marketing|bounces?|reply|updates?)\.[^.]+\.[^.]/;

/** A university's domain, whose student mail looks like a bulk host. */
const ACADEMIC_DOMAIN = /\.(edu|ac)(\.[a-z]{2})?$/;

/** Apple's Hide My Email domains. */
const APPLE_RELAY_DOMAIN = /^(icloud\.com|privaterelay\.appleid\.com)$/;

/**
 * Whether an address is a robot or a relay rather than a person: a role
 * mailbox such as billing@ or no-reply@, a bulk sending host, or an address of
 * Apple's Hide My Email. Those are either a sender's relay, which spells the
 * sender out as "info_at_shop_com_<token>_<token>@icloud.com", or one of the
 * owner's own hidden addresses, such as "quiet.river-4a@icloud.com", which
 * mail clients name "Hide My Email". Neither is an address of a person.
 */
export function isAutomatedSender(
  email: string | null | undefined,
  name?: string | null,
): boolean {
  const raw = normalizeEmailAddress(email);
  const address = canonicalEmailAddress(raw);
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (
    APPLE_RELAY_DOMAIN.test(domain) &&
    (name?.trim().toLowerCase() === "hide my email" ||
      /_at_.+_[a-z0-9]{8,}_[a-z0-9]{6,}@/.test(raw) ||
      /^[a-z]+[._-][a-z]+[._-]?\d[a-z]$/.test(local))
  ) {
    return true;
  }
  return (
    NO_REPLY.test(local) ||
    local.split(/[._-]/).some((word) => ROLE_WORDS.has(word)) ||
    ROLE_WORDS.has(local) ||
    DEVICE_DOMAINS.has(domain) ||
    (BULK_HOST.test(domain) && !ACADEMIC_DOMAIN.test(domain))
  );
}

/**
 * Whether a calendar organizer is a person: not a shared, room, holiday or
 * imported calendar (an address at calendar.google.com, such as
 * c_abc@group.calendar.google.com or Google's
 * unknownorganizer@calendar.google.com), and not a robot sender.
 */
export function organizerIsPerson(
  email: string | undefined,
  name?: string,
): boolean {
  return (
    !email ||
    !(/calendar\.google\.com$/i.test(email) || isAutomatedSender(email, name))
  );
}

/** The headers that mark bulk mail, read with each message's metadata. */
export const BULK_HEADERS = [
  "List-Unsubscribe",
  "List-Id",
  "Precedence",
  "Auto-Submitted",
];

/** Gmail's tabs for mail no person wrote to the owner. */
const BULK_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
]);

/**
 * Whether a message is bulk mail: Gmail sorted it into Promotions, Updates,
 * Social or Forums, or it carries a list header, a bulk Precedence or an
 * Auto-Submitted other than "no" (RFC 2369, 2919 and 3834). `header` gives a
 * header's value by name.
 */
export function isBulkMail(
  labelIds: string[] | undefined,
  header: (name: string) => string | undefined,
): boolean {
  if (labelIds?.some((l) => BULK_LABELS.has(l))) return true;
  if (header("List-Unsubscribe") || header("List-Id")) return true;
  if (/^(bulk|list|junk)$/i.test(header("Precedence")?.trim() ?? "")) {
    return true;
  }
  const auto = header("Auto-Submitted")?.trim().toLowerCase();
  return Boolean(auto && auto !== "no");
}

/**
 * Strips reply and forward prefixes ("Re:", "Fwd:", "Fw:", "Re[2]:", etc.)
 * and normalizes whitespace to produce a consistent thread title.
 */
export function stripSubjectPrefixes(
  subject: string | null | undefined,
): string {
  if (!subject) return "(No subject)";
  let cleaned = subject.trim();

  // Repeatedly strip Re:, Fwd:, Fw:, [tag] Re:, etc.
  const prefixRegex = /^(\s*(\[[^\]]+\]\s*)?(re|fwd|fw)(\[\d+\])?:\s*)+/i;
  while (prefixRegex.test(cleaned)) {
    cleaned = cleaned.replace(prefixRegex, "").trim();
  }

  // Collapse multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ");

  return cleaned || "(No subject)";
}

/**
 * Parses raw address input (string, object, or array) into an array of Participants.
 */
export function parseAddressList(
  input: RawAddressInput | RawAddressInput[] | string | null | undefined,
): Participant[] {
  if (!input) return [];

  const results: Participant[] = [];

  if (typeof input === "string") {
    // Handle comma-separated list of "Name <email@example.com>" or "email@example.com"
    const parts = input.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const angleMatch = trimmed.match(/^(?:"?([^"]*)"?\s*)?<([^>]+)>$/);
      if (angleMatch) {
        const name = angleMatch[1]?.trim() || undefined;
        const email = normalizeEmailAddress(angleMatch[2]);
        if (email) results.push({ name, email });
      } else if (trimmed.includes("@")) {
        results.push({ email: normalizeEmailAddress(trimmed) });
      }
    }
    return results;
  }

  const items = Array.isArray(input) ? input : [input];
  for (const item of items) {
    if (!item) continue;
    const addr = item.address || item.email;
    if (!addr) continue;
    const email = normalizeEmailAddress(addr);
    if (!email) continue;
    const name = item.name?.trim() || undefined;
    results.push({ name, email });
  }

  return results;
}

/**
 * Determines whether an email was sent ("out") or received ("in") by checking
 * if any sender in `from` belongs to the account owner's known email addresses.
 */
export function determineDirection(
  from: Participant[],
  selfEmailSet: Set<string>,
): "in" | "out" {
  for (const p of from) {
    if (p.email && selfEmailSet.has(canonicalEmailAddress(p.email))) {
      return "out";
    }
  }
  return "in";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a mail was sent: its Date header, unless that is more than a day after
 * the time the mailbox received it, or missing or unreadable. The header is
 * what the sender wrote, and spam dated 2099 would top a timeline for years.
 * A header far before it is kept: a mail moved from another mailbox arrived
 * on the day it was moved.
 *
 * @param header - The Date header, as a Date or a string.
 * @param received - The mailbox's own time: IMAP INTERNALDATE as a Date, or
 *   Gmail's internalDate as milliseconds in a string.
 */
export function mailDate(
  header: Date | string | null | undefined,
  received: Date | string | number | null | undefined,
): Date | undefined {
  const sent = header ? new Date(header) : null;
  const got =
    received == null
      ? null
      : new Date(
          typeof received === "string" && /^\d+$/.test(received)
            ? Number(received)
            : received,
        );
  const sentOk = sent && !isNaN(sent.getTime());
  const gotOk = got && !isNaN(got.getTime());
  if (!sentOk) return gotOk ? got : undefined;
  if (gotOk && sent.getTime() - got.getTime() > DAY_MS) return got;
  return sent;
}

/**
 * Normalizes raw email headers into a NormalizedEmail structure.
 */
export function normalizeEmail(
  raw: RawEmailInput,
  options: NormalizeEmailOptions,
): NormalizedEmail {
  const selfSet = new Set<string>();
  for (const email of [...options.selfEmails, ...(options.aliases ?? [])]) {
    const norm = canonicalEmailAddress(email);
    if (norm) selfSet.add(norm);
  }

  const from = parseAddressList(raw.from);
  const to = parseAddressList(raw.to);
  const cc = parseAddressList(raw.cc);

  const direction = determineDirection(from, selfSet);

  // All non-self participants, prioritizing the counterparty
  // For incoming: From is the primary counterparty
  // For outgoing: To/Cc are counterparties
  const participants: Participant[] = [];
  const seenEmails = new Set<string>();

  const addParticipant = (p: Participant) => {
    const emailKey = p.email ? normalizeEmailAddress(p.email) : undefined;
    if (emailKey && seenEmails.has(emailKey)) return;
    if (emailKey) seenEmails.add(emailKey);
    participants.push(p);
  };

  if (direction === "in") {
    // Put From first
    for (const p of from) addParticipant(p);
    for (const p of to) addParticipant(p);
    for (const p of cc) addParticipant(p);
  } else {
    // Put To first, then Cc, then From
    for (const p of to) addParticipant(p);
    for (const p of cc) addParticipant(p);
    for (const p of from) addParticipant(p);
  }

  // Parse Date
  let dateIso = new Date().toISOString();
  if (raw.date) {
    const d = new Date(raw.date);
    if (!isNaN(d.getTime())) {
      dateIso = d.toISOString();
    }
  }

  const rawSubject = raw.subject || "";
  const title = stripSubjectPrefixes(rawSubject);

  // Clean messageId (remove angle brackets)
  let cleanMessageId: string | undefined;
  if (raw.messageId) {
    cleanMessageId = raw.messageId.trim().replace(/^<|>$/g, "");
  }

  let cleanInReplyTo: string | undefined;
  if (raw.inReplyTo) {
    cleanInReplyTo = raw.inReplyTo.trim().replace(/^<|>$/g, "");
  }

  const externalId =
    raw.externalId ||
    cleanMessageId ||
    `email:${dateIso}:${from[0]?.email || "unknown"}`;

  const result: NormalizedEmail = {
    externalId,
    messageId: cleanMessageId,
    inReplyTo: cleanInReplyTo,
    date: dateIso,
    subject: rawSubject,
    title,
    direction,
    participants,
    from,
    to,
    cc,
    snippet: raw.snippet || undefined,
    raw: raw.raw,
  };

  if (options.includeBody && raw.bodyText) {
    result.bodyText = raw.bodyText.trim();
  }

  return result;
}
