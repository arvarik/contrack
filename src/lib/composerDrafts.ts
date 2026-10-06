/**
 * Where an unsaved note lives until a save keeps it. A note is the hardest
 * thing in the app to rebuild, so the composer's text is in `localStorage` a
 * moment after it is typed, and a failed save or an expired session does not
 * lose it. The key names the account and the contact, because storage is per
 * origin and two people may share a browser. Every read and write is
 * wrapped: a private window or a full quota throws.
 */

/** The four interaction kinds the composer offers. */
export type DraftKind = "note" | "call" | "meeting" | "email";

interface ComposerDraft {
  /** The editor's HTML, exactly as `editor.getHTML()` returned it. */
  html: string;
  /** The "next action" field. */
  followUpText: string;
  type: DraftKind;
  /** Epoch milliseconds, written by the browser that saved it. */
  savedAt: number;
}

const DRAFT_KEY_PREFIX = "contrack:draft:";

/** A draft larger than this is not written. 64 KB is pages of notes. */
const MAX_DRAFT_BYTES = 64 * 1024;

/** A draft nobody touched for this long is discarded on read. */
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The account an un-gated instance runs as, when no user id is known. */
const LOCAL_ACCOUNT = "local";

const KINDS: ReadonlySet<string> = new Set([
  "note",
  "call",
  "meeting",
  "email",
]);

/**
 * The storage key for one account's draft on one contact. Both ids are
 * encoded, so a colon in one cannot read as another pair.
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
 * The draft stored under `key`, or null when it is missing, malformed or
 * older than {@link MAX_DRAFT_AGE_MS}. A malformed or stale draft is removed.
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
 * Write a draft, or remove the key when the draft is empty. False when
 * nothing was written: the draft was over the size cap or storage refused it.
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

/**
 * Remove every draft one account wrote in this browser, at sign-out, so a
 * shared browser keeps no half-written note. An expired session keeps its
 * drafts: that is the loss they exist to prevent. Never throws.
 */
export function clearAccountDrafts(accountId: string | null | undefined): void {
  const prefix = draftKey(accountId, "");
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // Nowhere to remove them from.
  }
}
