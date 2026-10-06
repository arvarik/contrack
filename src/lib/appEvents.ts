/**
 * Named window events, for messages between components with no useful
 * common ancestor: a sidebar button that opens a modal App owns, or a
 * refused credential the API client saw. A context would put a busy value
 * in a provider most of the app reads, for one consumer. The names live here
 * so a listener and its dispatcher cannot drift apart over a typo.
 */

/** Someone asked for the keyboard-shortcuts overlay. Owned by App. */
export const OPEN_SHORTCUTS_EVENT = "contrack:open-shortcuts";

/** Someone asked for the quick interaction modal. Owned by App. */
export const OPEN_QUICK_NOTE_EVENT = "contrack:open-quick-note";

/**
 * Someone asked for the command palette without the keyboard: the Network
 * header's button on a touch screen. Owned by the palette.
 */
export const OPEN_PALETTE_EVENT = "contrack:open-palette";

/**
 * Close the command palette, whatever it holds. A shortcut that opens a
 * dialog of its own sends it first. Escape is not the same: it clears the
 * input before it closes anything. Owned by the palette.
 */
export const CLOSE_PALETTE_EVENT = "contrack:close-palette";

export interface OpenQuickNoteDetail {
  contactId?: string;
}

/**
 * The server refused a request for want of an acceptable credential. The API
 * client sends it and AuthGate answers it, instead of a screen of error
 * toasts. The reason travels with it, because a disabled account must not
 * be told to sign in again.
 */
export const AUTH_EXPIRED_EVENT = "contrack:auth-expired";

/**
 * The server will not serve data until this account changes its password.
 * The credential still works, so AuthGate shows the forced-change screen,
 * not the sign-in screen.
 */
export const PASSWORD_CHANGE_REQUIRED_EVENT =
  "contrack:password-change-required";

/**
 * Something changed what this account or the instance allows. AuthGate reads
 * `/api/auth/status` once into state, so this asks it to read again. Also
 * sent on a `403 ADMIN_REQUIRED`, when the tab believes it is an admin and
 * the server disagrees.
 */
export const AUTH_STATUS_STALE_EVENT = "contrack:auth-status-stale";

/** Why the credential stopped being accepted. */
export type AuthExpiryReason = "expired" | "disabled";

/** The payload {@link AUTH_EXPIRED_EVENT} carries. */
export interface AuthExpiredDetail {
  reason: AuthExpiryReason;
}

/** Open the keyboard-shortcuts overlay from anywhere, as the `?` key does. */
export const openKeyboardShortcuts = (): void => {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
};

/**
 * Announce that this browser's credential is not accepted. A `CustomEvent`,
 * so the listener can tell an expired session from a disabled account.
 */
export const emitAuthExpired = (reason: AuthExpiryReason = "expired"): void => {
  window.dispatchEvent(
    new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, {
      detail: { reason },
    }),
  );
};

/** Announce that the server is refusing data until the password changes. */
export const emitPasswordChangeRequired = (): void => {
  window.dispatchEvent(new Event(PASSWORD_CHANGE_REQUIRED_EVENT));
};

/** Ask the gate to re-read `/api/auth/status`. */
export const emitAuthStatusStale = (): void => {
  window.dispatchEvent(new Event(AUTH_STATUS_STALE_EVENT));
};

/** Open the command palette from anywhere, as ⌘K (Ctrl+K) does. */
export const openCommandPalette = (): void => {
  window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
};

/** Close the command palette from anywhere. See {@link CLOSE_PALETTE_EVENT}. */
export const closeCommandPalette = (): void => {
  window.dispatchEvent(new Event(CLOSE_PALETTE_EVENT));
};

/** Ask App to open the quick note modal, optionally pre-selecting a contact. */
export const openQuickNote = (contactId?: string): void => {
  window.dispatchEvent(
    new CustomEvent<OpenQuickNoteDetail>(OPEN_QUICK_NOTE_EVENT, {
      detail: { contactId },
    }),
  );
};
