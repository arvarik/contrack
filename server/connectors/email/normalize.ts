/**
 * server/connectors/email/normalize.ts — Email normalization for Contrack connectors.
 *
 * Normalizes email headers and bodies from IMAP (via imapflow/mailparser) and
 * Google Workspace (via Gmail API metadata or full format).
 *
 * Provides:
 * 1. NormalizedEmail shape matching Contrack's interaction requirements.
 * 2. Clean subject threading ("Re:", "Fwd:", brackets stripped).
 * 3. Direction resolution ("in" vs "out") based on account owner addresses and aliases.
 * 4. Header-only by default, body text extracted only when summaries are enabled.
 *
 * @module server/connectors/email/normalize
 */

import type { Participant } from "../../../shared/connectors.ts";

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
    if (p.email && selfEmailSet.has(p.email)) {
      return "out";
    }
  }
  return "in";
}

/**
 * Normalizes raw email headers into a NormalizedEmail structure.
 */
export function normalizeEmail(
  raw: RawEmailInput,
  options: NormalizeEmailOptions,
): NormalizedEmail {
  const selfSet = new Set<string>();
  for (const email of options.selfEmails) {
    const norm = normalizeEmailAddress(email);
    if (norm) selfSet.add(norm);
  }
  if (options.aliases) {
    for (const email of options.aliases) {
      const norm = normalizeEmailAddress(email);
      if (norm) selfSet.add(norm);
    }
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
