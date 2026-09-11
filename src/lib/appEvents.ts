/**
 * appEvents.ts — Named window events used for cross-tree signalling.
 *
 * A handful of things need to travel between components that share no useful
 * ancestor: a modal owned by App that a nav button in the sidebar wants to
 * open, or the answer to a credential the API client saw refused. Threading
 * either through context would put a high-churn value in a provider that most
 * of the app subscribes to, purely to serve one consumer.
 *
 * There used to be a settings-changed event here as well, for preferences that
 * lived in localStorage and had no other way to reach a widget three routes
 * away. Preferences are on the account now, behind one React Query cache, so
 * every reader of one re-renders when it changes and the event had nothing
 * left to announce.
 *
 * Window events keep those couplings explicit and cheap. The names live here
 * so a listener and its dispatcher cannot drift apart over a typo.
 *
 * @module lib/appEvents
 */

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

/**
 * Something changed what this account is allowed to do, or what the instance
 * allows.
 *
 * `/api/auth/status` is read once, into `useState` inside AuthGate, and
 * nothing caches it — so a role change, a disable, or an instance setting
 * written from an admin page leaves every screen reading the answer from
 * before. This asks the gate to look again.
 *
 * Also fired when the server answers `403 ADMIN_REQUIRED`, which is the
 * server saying it disagrees with what this tab believes it is.
 */
export const AUTH_STATUS_STALE_EVENT = "contrack:auth-status-stale";

/** Why the credential stopped being accepted. */
export type AuthExpiryReason = "expired" | "disabled";

/** The payload {@link AUTH_EXPIRED_EVENT} carries. */
export interface AuthExpiredDetail {
  reason: AuthExpiryReason;
}

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

/** Ask the gate to re-read `/api/auth/status`. */
export const emitAuthStatusStale = (): void => {
  window.dispatchEvent(new Event(AUTH_STATUS_STALE_EVENT));
};
