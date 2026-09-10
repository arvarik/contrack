/**
 * AuthGate — decides which screen the app is, before the app exists.
 *
 * It answers one question on every load: given this instance and this
 * browser, what should the person be looking at? Eight answers:
 *
 *   checking         nothing yet, /status has not replied
 *   setup            gated, nobody can sign in — create the first account
 *   join             arrived on an invitation link
 *   signin           gated, signed out
 *   register         signed out, and this instance takes new accounts
 *   password-change  signed in with a password somebody else chose
 *   open             render the app
 *   unreachable      the server is not answering; render the app anyway
 *
 * It also publishes the answer through `useAuth`, so the rest of the tree can
 * name the signed-in account and its role without asking the server again.
 * That is why the gate owns the state rather than each screen fetching its
 * own: the sidebar, the account page and the admin area all need the current
 * user, and three independent `/status` calls would be three chances to
 * disagree.
 *
 * The provider wraps every state, not just `open`. The screens above the app
 * need `refresh()` and `user` too, and a provider that covered only the open
 * state handed them the default context — a `refresh` that silently did
 * nothing.
 *
 * Credential failures from anywhere are handled here. The API client
 * announces them on the window (see lib/appEvents) and this is what listens:
 * without it, a session that expires while the tab is open answers with a
 * screenful of identical error toasts and no way to sign back in.
 *
 * This component mounts OUTSIDE BrowserRouter (main.tsx wraps App, and App
 * owns the router), so nothing it renders may use `useLocation`, `Link`, or
 * `Navigate`. The invitation link is read from `window.location` for exactly
 * that reason.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAuthStatus, signOut, type AccountUser } from "../../api/auth";
import { fetchContactsSlim } from "../../api/contacts";
import {
  AUTH_EXPIRED_EVENT,
  PASSWORD_CHANGE_REQUIRED_EVENT,
  type AuthExpiredDetail,
} from "../../lib/appEvents";
import { logCacheEvent } from "../../lib/queryConfig";
import { takeInvitationToken } from "../../lib/credentials";
import { SignIn } from "./SignIn";
import { SetupWizard } from "./SetupWizard";
import { Register } from "./Register";
import { AcceptInvitation } from "./AcceptInvitation";
import { ForcedPasswordChange } from "./ForcedPasswordChange";

interface AuthContextValue {
  /** The signed-in account, or null when nobody is signed in. */
  user: AccountUser | null;
  /** True when this instance requires a credential. */
  authRequired: boolean;
  /** True when this account may reach the administration area. */
  isAdmin: boolean;
  /** True while the server refuses data until the password changes. */
  mustChangePassword: boolean;
  /** An admin has opened this instance to new accounts. */
  registrationOpen: boolean;
  /** The deprecated environment `API_TOKEN` is still set on the server. */
  legacyTokenConfigured: boolean;
  /** This instance has never been secured. */
  localOwnerPresent: boolean;
  /** Re-read /status — call after anything that changes the account. */
  refresh: () => Promise<void>;
  /** End the session and show the sign-in screen. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authRequired: false,
  isAdmin: false,
  mustChangePassword: false,
  registrationOpen: false,
  legacyTokenConfigured: false,
  localOwnerPresent: false,
  refresh: async () => {},
  signOut: async () => {},
});

/**
 * The current account and the actions that change it.
 *
 * Safe to call anywhere under AuthGate, on any screen. On an un-gated
 * instance `authRequired` is false, which is the one signal account UI uses
 * to hide itself rather than offer a sign-out that does nothing. `user` is
 * still set there — it is the local owner the instance runs as — so a check
 * for "is there an account" must read `authRequired`, never `user`.
 */
export const useAuth = () => useContext(AuthContext);

type GateState =
  | "checking"
  | "setup"
  | "join"
  | "signin"
  | "register"
  | "password-change"
  | "open"
  | "unreachable";

/**
 * A keyed wrapper whose only job is to be replaced.
 *
 * Changing the key unmounts everything under it, which drops every piece of
 * `useState` in the tree: the recent-contact list, the AI Search session, the
 * dedupe scan, the last query someone typed. Clearing the React Query cache
 * removes what the server sent; this removes what the components remembered.
 * Both are needed, because signing in as somebody else must not leave one
 * trace of the previous account on screen.
 */
const AppScope = ({ children }: { children: React.ReactNode }) => (
  <>{children}</>
);

export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GateState>("checking");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState(0);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [legacyTokenConfigured, setLegacyTokenConfigured] = useState(false);
  const [localOwnerPresent, setLocalOwnerPresent] = useState(false);
  // Why the sign-in screen is showing. Null when the user asked for it
  // (sign-out) or simply arrived signed-out; "expired" when a credential we
  // had stopped being accepted; "disabled" when the account itself is closed,
  // which is the one case where trying the password again cannot help.
  const [signInReason, setSignInReason] = useState<
    "expired" | "disabled" | null
  >(null);
  // Read once, at first render, and removed from the address bar in the same
  // breath. A credential in a URL reaches the history, the tab title, and any
  // screenshot; the form keeps its own copy until it is submitted.
  const [invitation, setInvitation] = useState<string | null>(
    takeInvitationToken,
  );
  // `check` reads the ref, not the state. Accepting an invitation clears it
  // and re-checks in the same handler, and a `check` closed over the previous
  // render's state would send the freshly-created account straight back to
  // the join form it just submitted.
  const invitationRef = useRef(invitation);
  const clearInvitation = useCallback(() => {
    invitationRef.current = null;
    setInvitation(null);
  }, []);
  const queryClient = useQueryClient();

  const check = useCallback(async () => {
    let status;
    try {
      status = await fetchAuthStatus();
    } catch {
      // The status endpoint is unreachable, which means the server is down —
      // not that we are locked out. Rendering the app lets its own connection
      // banner explain what is happening, which is the accurate story.
      //
      // Only on the first check. Once /status has answered we know who this
      // is, and a blip during a later `refresh()` must not throw that away:
      // forgetting the account would hide the identity row, hide the admin
      // area and tell the account page there is no account, for a dropped
      // packet. The effect below keeps asking until the server answers.
      setState((current) => (current === "checking" ? "unreachable" : current));
      return;
    }

    setAuthRequired(status.authRequired);
    setUser(status.user);
    setDeviceContacts(status.deviceContacts ?? status.existingContacts ?? 0);
    setRegistrationOpen(status.registrationOpen ?? false);
    setLegacyTokenConfigured(status.legacyTokenConfigured ?? false);
    setLocalOwnerPresent(status.localOwnerPresent ?? false);

    // Order matters, and each rung rules out the ones below it.
    if (status.setupRequired) {
      // Nobody can sign in yet, so no invitation can exist: issuing one needs
      // an admin. Setup outranks a stale link in the address bar.
      setState("setup");
      return;
    }
    if (invitationRef.current) {
      setState("join");
      return;
    }
    if (status.authRequired && !status.authenticated) {
      setState("signin");
      return;
    }
    if (status.user?.mustChangePassword) {
      // The credential works. It is just one somebody else chose, and the
      // server refuses every data route until it is replaced.
      setState("password-change");
      return;
    }
    setState("open");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Keep asking while the server is not answering.
   *
   * Without this, `unreachable` was a state with no way out: one failed
   * `/status` at load and the tab rendered an un-gated app until somebody
   * reloaded it — including on a gated instance, where the sign-in screen was
   * what should have appeared once the server came back.
   *
   * Five seconds, and only in this state. It stops the moment `check`
   * succeeds, because a successful check leaves `unreachable` and unmounts
   * the interval with it.
   */
  useEffect(() => {
    if (state !== "unreachable") return;
    const timer = window.setInterval(() => void check(), 5000);
    return () => window.clearInterval(timer);
  }, [state, check]);

  /**
   * Re-check after signing in, setting up, joining, or registering.
   *
   * The cache is cleared first because everything in it was fetched as a
   * different principal. Clearing beats a full page reload: no white flash,
   * and the queries refetch on mount anyway.
   */
  const handleAuthenticated = useCallback(async () => {
    queryClient.clear();
    setSignInReason(null);
    clearInvitation();
    await check();
  }, [check, clearInvitation, queryClient]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // Best effort. The cookie is cleared server-side or it is not, but the
      // local state must end up signed out either way — leaving someone
      // staring at a "Sign out" button that did nothing is worse.
    }
    queryClient.clear();
    setUser(null);
    setSignInReason(null); // deliberate sign-out, not an expiry
    setState(authRequired ? "signin" : "open");
  }, [authRequired, queryClient]);

  // A 401 from anywhere means the credential stopped being accepted. A
  // 403 ACCOUNT_DISABLED means it was accepted and the account behind it is
  // closed, which needs different words on the same screen.
  useEffect(() => {
    const onExpired = (event: Event) => {
      const reason =
        (event as CustomEvent<AuthExpiredDetail>).detail?.reason ?? "expired";
      setState((current) => {
        // Only meaningful while the app is up. During setup, sign-in or the
        // join form a 401 is the expected state, not news.
        if (current !== "open" && current !== "password-change") return current;
        queryClient.clear();
        setUser(null);
        setSignInReason(reason);
        return "signin";
      });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  // The server refused a data route until this account changes its password.
  // Reached when an admin resets a password in another tab, or on any request
  // made before /status has caught up.
  useEffect(() => {
    const onForced = () =>
      setState((current) => (current === "open" ? "password-change" : current));
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onForced);
    return () =>
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onForced);
  }, []);

  /**
   * Warm the contacts cache the moment the gate opens.
   *
   * This used to run at module load in main.tsx, before React rendered at
   * all, which on a gated instance meant the first request of every page load
   * was a 401. It runs here instead, keyed to the identity, so it also warms
   * again for the next account after a sign-out and sign-in.
   */
  useEffect(() => {
    if (state !== "open") return;
    void queryClient.prefetchQuery({
      queryKey: ["contacts"],
      queryFn: async () => {
        const data = await fetchContactsSlim();
        logCacheEvent({
          type: "prefetch",
          queryKey: "['contacts']",
          meta: { count: data.length, source: "gate-open" },
        });
        return data;
      },
    });
  }, [state, user?.id, queryClient]);

  const context: AuthContextValue = {
    user,
    // While the server is unreachable nothing is known, and `authRequired`
    // decides whether account UI exists at all. `false` is the safe answer:
    // it hides a sign-out that cannot work and an admin area whose every
    // request would fail, and it is what the state meant before it could be
    // re-entered.
    authRequired: state === "unreachable" ? false : authRequired,
    isAdmin: user?.role === "admin",
    mustChangePassword: user?.mustChangePassword === true,
    registrationOpen,
    legacyTokenConfigured,
    localOwnerPresent,
    refresh: check,
    signOut: handleSignOut,
  };

  function renderScreen(): React.ReactNode {
    switch (state) {
      // Nothing is rendered while checking. The call is same-origin and
      // typically resolves in a few milliseconds; a spinner for that long is
      // a flash of chrome, not feedback.
      case "checking":
        return null;
      case "setup":
        return (
          <SetupWizard
            onCreated={handleAuthenticated}
            deviceContacts={deviceContacts}
            localOwnerPresent={localOwnerPresent}
          />
        );
      case "join":
        return (
          <AcceptInvitation
            token={invitation ?? ""}
            onAccepted={handleAuthenticated}
            onCancel={() => {
              clearInvitation();
              void check();
            }}
          />
        );
      case "register":
        return (
          <Register
            onRegistered={handleAuthenticated}
            onCancel={() => setState("signin")}
          />
        );
      case "password-change":
        return <ForcedPasswordChange onChanged={check} />;
      case "signin":
        return (
          <SignIn
            onSignedIn={handleAuthenticated}
            reason={signInReason}
            canRegister={registrationOpen}
            onRegister={() => setState("register")}
          />
        );
      default:
        // `open` and `unreachable` both render the app. The key is the whole
        // point: a change of identity replaces the tree rather than reusing
        // the previous account's component state.
        return <AppScope key={user?.id ?? "anon"}>{children}</AppScope>;
    }
  }

  return (
    <AuthContext.Provider value={context}>
      {renderScreen()}
    </AuthContext.Provider>
  );
};
