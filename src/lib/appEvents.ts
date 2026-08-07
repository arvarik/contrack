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
 * The server refused a request for want of a credential — the session expired,
 * or was revoked from another device.
 *
 * Dispatched by the API client, which is the only place that sees the 401, and
 * heard by AuthGate, which is the only place that can do anything about it.
 * Without this the app answers an expired session with a screen full of
 * identical error toasts, none of which say "sign in again".
 */
export const AUTH_EXPIRED_EVENT = "contrack:auth-expired";

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

/** Announce that this browser's credential is no longer accepted. */
export const emitAuthExpired = (): void => {
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
};
