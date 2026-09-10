/**
 * appEvents.ts — Named window events used for cross-tree signalling.
 *
 * A handful of things need to travel between components that share no useful
 * ancestor: a preference written to localStorage in Settings that a widget
 * three routes away renders, or a modal owned by App that a nav button in the
 * sidebar wants to open. Threading either through context would put a
 * high-churn value in a provider that most of the app subscribes to, purely to
 * serve one consumer.
 *
 * Window events keep those couplings explicit and cheap. The names live here
 * so a listener and its dispatcher cannot drift apart over a typo.
 *
 * @module lib/appEvents
 */

/**
 * A locally-stored preference changed (temperature unit, recent-contact
 * limit). Listeners re-read localStorage; the event carries no payload
 * because the store is the source of truth.
 */
export const SETTINGS_CHANGED_EVENT = "contrack_settings_changed";

/** Someone asked for the keyboard-shortcuts overlay. Owned by App. */
export const OPEN_SHORTCUTS_EVENT = "contrack:open-shortcuts";

/**
 * The server refused a request for want of an acceptable credential.
 *
 * Dispatched by the API client, which is the only place that sees the status,
 * and heard by AuthGate, which is the only place that can do anything about
 * it. Without this the app answers an expired session with a screen full of
 * identical error toasts, none of which say "sign in again".
 *
 * The reason travels with the event because the two cases need different
 * words. An expired session is a routine "sign in again"; a disabled account
 * is not, and telling someone whose account an administrator has closed to
 * try their password again sends them round a loop that cannot end.
 */
export const AUTH_EXPIRED_EVENT = "contrack:auth-expired";

/**
 * The server will not serve data until this account changes its password.
 *
 * Separate from the event above because the account is fine and the
 * credential is accepted: the server is holding one door shut, not all of
 * them. AuthGate answers it with the forced-change screen rather than the
 * sign-in screen, so nobody is asked to re-enter a password that is working.
 */
export const PASSWORD_CHANGE_REQUIRED_EVENT =
  "contrack:password-change-required";

/** Why the credential stopped being accepted. */
export type AuthExpiryReason = "expired" | "disabled";

/** The payload {@link AUTH_EXPIRED_EVENT} carries. */
export interface AuthExpiredDetail {
  reason: AuthExpiryReason;
}

/** Announce that a locally-stored preference changed. */
export const emitSettingsChanged = (): void => {
  window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
};

/**
 * Open the keyboard-shortcuts overlay from anywhere.
 *
 * The overlay itself is mounted once in App, next to the `?` key handler that
 * has always opened it. This is the same door, reachable by mouse.
 */
export const openKeyboardShortcuts = (): void => {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
};

/**
 * Announce that this browser's credential is no longer accepted.
 *
 * A `CustomEvent` rather than a bare one, so the listener can tell an expired
 * session apart from a disabled account without asking the server a second
 * question it has already answered.
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
