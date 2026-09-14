/**
 * Where an unsaved note lives between keystrokes and the save that keeps it.
 *
 * A note is the hardest thing in the app to reconstruct. The composer used
 * to clear itself the moment a save started, so a request that failed, or a
 * session that expired while the request was out, took the note with it. The
 * draft here is the other half of the fix: what is in the composer is on disk
 * within a moment of being typed, and it is read back when the composer next
 * opens for the same contact under the same account.
 *
 * The key names both. `localStorage` is keyed by origin, not by account, so
 * two people signing in and out of one browser would otherwise open each
 * other's half-written notes. A draft written under one account is not read
 * under another, and the contact id keeps one person's notes from appearing
 * on another person's page.
 *
 * Every read and write is wrapped. A private window, a full quota, or blocked
 * site data throws from `localStorage`, and a note must not be lost because
 * the place it was going to be kept refused it.
 *
 * @module lib/composerDrafts
 */

/** The four interaction kinds the composer offers. */
export type DraftKind = "note" | "call" | "meeting" | "email";

export interface ComposerDraft {
  /** The editor's HTML, exactly as `editor.getHTML()` returned it. */
  html: string;
  /** The "next action" field. */
  followUpText: string;
  type: DraftKind;
  /** Epoch milliseconds, written by the browser that saved it. */
  savedAt: number;
}

export const DRAFT_KEY_PREFIX = "contrack:draft:";

/** A draft larger than this is not written. 64 KB is pages of notes. */
export const MAX_DRAFT_BYTES = 64 * 1024;

/** A draft nobody touched for this long is discarded on read. */
export const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The account an un-gated instance runs as, when no user id is known. */
const LOCAL_ACCOUNT = "local";

const KINDS: ReadonlySet<string> = new Set([
  "note",
  "call",
  "meeting",
  "email",
]);

/**
 * The storage key for one account's draft on one contact.
 *
 * Both ids are encoded, so an id carrying a colon cannot read as a different
 * account and contact pair.
 */
export function draftKey(
  accountId: string | null | undefined,
  contactId: string,
): string {
  const account = accountId && accountId.trim() ? accountId : LOCAL_ACCOUNT;
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(account)}:${encodeURIComponent(contactId)}`;
}

/** True when the draft holds nothing worth keeping. */
export function isEmptyDraft(
  draft: Pick<ComposerDraft, "html" | "followUpText">,
): boolean {
  const html = draft.html.trim();
  return (
    (html === "" || html === "<p></p>") && draft.followUpText.trim() === ""
  );
}

function parseDraft(raw: string): ComposerDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const d = parsed as Record<string, unknown>;
  if (typeof d.html !== "string") return null;
  if (typeof d.followUpText !== "string") return null;
  if (typeof d.type !== "string" || !KINDS.has(d.type)) return null;
  const savedAt = typeof d.savedAt === "number" ? d.savedAt : 0;
  return {
    html: d.html,
    followUpText: d.followUpText,
    type: d.type as DraftKind,
    savedAt,
  };
}

/**
 * The draft stored under `key`, or null.
 *
 * Null for a missing key, for a value that is not the shape written here, and
 * for a draft older than {@link MAX_DRAFT_AGE_MS}. The stale one is removed
 * on the way out, so it does not sit in storage until somebody opens that
 * contact again a year later.
 */
export function readDraft(key: string, now = Date.now()): ComposerDraft | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const draft = parseDraft(raw);
  if (!draft) {
    clearDraft(key);
    return null;
  }
  if (draft.savedAt > 0 && now - draft.savedAt > MAX_DRAFT_AGE_MS) {
    clearDraft(key);
    return null;
  }
  return draft;
}

/**
 * Write a draft, or remove the key when the draft is empty.
 *
 * Returns false when nothing was written: the draft was over the size cap or
 * storage refused it. The caller cannot do anything about either, and it is
 * returned so a test can see it rather than so a screen can act on it.
 */
export function writeDraft(
  key: string,
  draft: Omit<ComposerDraft, "savedAt">,
  now = Date.now(),
): boolean {
  if (isEmptyDraft(draft)) {
    clearDraft(key);
    return true;
  }
  const value = JSON.stringify({ ...draft, savedAt: now });
  if (value.length > MAX_DRAFT_BYTES) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove the draft under `key`. Never throws. */
export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to remove, or nowhere to remove it from.
  }
}
