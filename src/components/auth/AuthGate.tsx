/**
 * Decides which screen the app shows, before the app exists:
 *
 *   checking         nothing yet, /status has not replied
 *   setup            gated, nobody can sign in: create the first account
 *   join             arrived on an invitation link
 *   signin           gated, signed out
 *   register         signed out, and this instance takes new accounts
 *   password-change  signed in with a password somebody else chose
 *   open             render the app
 *   unreachable      the server is not answering: render the app anyway
 *
 * `useAuth` publishes the account, so the tree does not ask `/status` again.
 * The provider wraps every state, because the screens before the app need
 * `refresh()` and `user` too. The gate listens for the credential failures
 * the API client announces (lib/appEvents).
 *
 * It mounts outside BrowserRouter, so nothing here may use `useLocation`,
 * `Link` or `Navigate`. The invitation link comes from `window.location`.
 */
import React, {
  Suspense,
  lazy,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAuthStatus, signOut, type AccountUser } from "../../api/auth";
import type { MapStyleUrls } from "../../../shared/geo";
import { fetchContactsSlim } from "../../api/contacts";
import {
  AUTH_EXPIRED_EVENT,
  AUTH_STATUS_STALE_EVENT,
  PASSWORD_CHANGE_REQUIRED_EVENT,
  type AuthExpiredDetail,
} from "../../lib/appEvents";
import { logCacheEvent } from "../../lib/queryConfig";
import {
  takeInvitationToken,
  takeUrlSecret,
  RESET_PASSWORD_PATH,
  SIGNIN_LINK_PATH,
} from "../../lib/credentials";
import { SignIn } from "./SignIn";
import { SetupWizard } from "./SetupWizard";
import { Register } from "./Register";
import { AcceptInvitation } from "./AcceptInvitation";
import { ForcedPasswordChange } from "./ForcedPasswordChange";
import { PasskeyNudge } from "./PasskeyNudge";
import { ResetPassword } from "./ResetPassword";
import { MagicLinkLanding } from "./MagicLinkLanding";
import { ForgotPassword } from "./ForgotPassword";
import { passkeysSupported, listPasskeys } from "../../api/passkeys";
import { PreferencesProvider } from "../../contexts/PreferencesContext";
import { clearAccountDrafts } from "../../lib/composerDrafts";
import { clearLastView } from "../../views/map/lastView";

/**
 * Where an app's OAuth sign-in asks the person to approve it. It stands
 * apart from the app's routes, outside the shell, and loads only there.
 */
const OAuthConsent = lazy(() => import("../../views/oauth/OAuthConsent"));
const isConsentPage = () => window.location.pathname === "/oauth/consent";

interface AuthContextValue {
  /** The signed-in account, or null when nobody is signed in. */
  user: AccountUser | null;
  /** True when this instance requires a credential. */
  authRequired: boolean;
  /** True when this account may reach the administration area. */
  isAdmin: boolean;
  /** The address people open (`PUBLIC_URL`), or null when it is not set. */
  publicUrl: string | null;
  /** An MCP client can sign in here with OAuth instead of a token. */
  mcpOAuth: boolean;
  /** The instance's name, or "". Known before sign-in, for sign in and join. */
  instanceName: string;
  /**
   * The basemap style URL for each palette, or null until `/status` answers.
   * The server owns these because it also owns the CSP that must allow them.
   */
  mapStyles: MapStyleUrls | null;
  /**
   * `/api/auth/status` has answered at least once. A redirect based on the
   * account waits for this, or an unreachable server bounces an admin off
   * their page.
   */
  isResolved: boolean;
  /** Re-read /status — call after anything that changes the account. */
  refresh: () => Promise<void>;
  /** End the session and show the sign-in screen. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authRequired: false,
  isAdmin: false,
  publicUrl: null,
  mcpOAuth: false,
  instanceName: "",
  mapStyles: null,
  isResolved: false,
  refresh: async () => {},
  signOut: async () => {},
});

/**
 * The current account and the actions that change it, anywhere under
 * AuthGate. On an un-gated instance `authRequired` is false and `user` is the
 * local owner, so "is there an account" must read `authRequired`, never
 * `user`.
 */
export const useAuth = () => useContext(AuthContext);

type GateState =
  | "checking"
  | "setup"
  | "join"
  | "reset"
  | "link"
  | "forgot"
  | "signin"
  | "register"
  | "password-change"
  | "passkey-nudge"
  | "open"
  | "unreachable";

/**
 * A keyed wrapper whose only job is to be replaced. A new key drops every
 * component's state, as clearing the query cache drops the server's data, so
 * a new account sees no trace of the previous one.
 */
const AppScope = ({ children }: { children: React.ReactNode }) => (
  <>{children}</>
);

/*
 * PreferencesProvider sits inside AppScope, so the identity key drops it too:
 * one account's settings never show for the next, even for a render.
 */

export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GateState>("checking");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [deviceContacts, setDeviceContacts] = useState(0);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [mcpOAuth, setMcpOAuth] = useState(false);
  const [instanceName, setInstanceName] = useState("");
  const [mapStyles, setMapStyles] = useState<MapStyleUrls | null>(null);
  const [localOwnerPresent, setLocalOwnerPresent] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [magicLinkSignIn, setMagicLinkSignIn] = useState(false);
  // Why the sign-in screen shows. Null for a sign-out or a signed-out
  // arrival, "expired" for a credential no longer accepted, "disabled" for a
  // closed account.
  const [signInReason, setSignInReason] = useState<
    "expired" | "disabled" | null
  >(null);
  // Read once, and removed from the address bar at once: a credential in a
  // URL reaches the history and any screenshot.
  const [invitation, setInvitation] = useState<string | null>(
    takeInvitationToken,
  );
  // `check` reads the ref, not the state: accepting an invitation clears it
  // and re-checks in one handler, and stale state would reopen the join form.
  const invitationRef = useRef(invitation);
  const clearInvitation = useCallback(() => {
    invitationRef.current = null;
    setInvitation(null);
  }, []);

  const [resetToken, setResetToken] = useState<string | null>(() =>
    takeUrlSecret(RESET_PASSWORD_PATH),
  );
  const resetTokenRef = useRef(resetToken);
  const clearResetToken = useCallback(() => {
    resetTokenRef.current = null;
    setResetToken(null);
  }, []);

  const [magicToken, setMagicToken] = useState<string | null>(() =>
    takeUrlSecret(SIGNIN_LINK_PATH),
  );
  const magicTokenRef = useRef(magicToken);
  const clearMagicToken = useCallback(() => {
    magicTokenRef.current = null;
    setMagicToken(null);
  }, []);
  const queryClient = useQueryClient();

  const check = useCallback(async () => {
    let status;
    try {
      status = await fetchAuthStatus();
    } catch {
      // The server is down, not refusing, so the app renders and its
      // connection banner explains. Only on the first check: a blip in a later
      // `refresh()` must not forget the account. The effect below keeps asking.
      setState((current) => (current === "checking" ? "unreachable" : current));
      return;
    }

    setAuthRequired(status.authRequired);
    setUser(status.user);
    setDeviceContacts(status.deviceContacts ?? 0);
    setRegistrationOpen(status.registrationOpen ?? false);
    setPublicUrl(status.publicUrl ?? null);
    setMcpOAuth(status.mcpOAuth ?? false);
    setInstanceName(status.instanceName ?? "");
    setMapStyles(status.map ?? null);
    setLocalOwnerPresent(status.localOwnerPresent ?? false);
    setMailConfigured(status.mailConfigured ?? false);
    setMagicLinkSignIn(status.magicLinkSignIn ?? false);

    // Order matters, and each rung rules out the ones below it.
    if (status.setupRequired) {
      // Nobody can sign in, so no invitation can exist. Setup outranks a
      // stale link in the address bar.
      setState("setup");
      return;
    }
    if (invitationRef.current) {
      setState("join");
      return;
    }
    if (resetTokenRef.current) {
      setState("reset");
      return;
    }
    if (magicTokenRef.current) {
      setState("link");
      return;
    }
    if (status.authRequired && !status.authenticated) {
      setState("signin");
      return;
    }
    if (status.user?.mustChangePassword) {
      // A password somebody else chose. Data routes refuse until it changes.
      setState("password-change");
      return;
    }
    setState("open");
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Asks every five seconds while the server is not answering, so
   * `unreachable` has a way out. A successful check leaves the state and
   * ends the interval.
   */
  useEffect(() => {
    if (state !== "unreachable") return;
    const timer = window.setInterval(() => void check(), 5000);
    return () => window.clearInterval(timer);
  }, [state, check]);

  /** Re-checks after signing in. */
  const handleAuthenticated = useCallback(async () => {
    queryClient.clear();
    setSignInReason(null);
    clearInvitation();
    clearResetToken();
    clearMagicToken();
    await check();
  }, [check, clearInvitation, clearResetToken, clearMagicToken, queryClient]);

  /**
   * After setup, join or register: offers the passkey nudge when the browser
   * supports passkeys and the account has none and has not dismissed it.
   */
  const handleAccountCreated = useCallback(async () => {
    queryClient.clear();
    setSignInReason(null);
    clearInvitation();
    clearResetToken();
    clearMagicToken();
    await check();
    if (passkeysSupported()) {
      try {
        const { passkeys, nudgeDismissed } = await listPasskeys();
        if (passkeys.length === 0 && !nudgeDismissed) {
          setState("passkey-nudge");
          return;
        }
      } catch {
        // Fall through to open
      }
    }
  }, [check, clearInvitation, clearResetToken, clearMagicToken, queryClient]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // Best effort. The local state signs out either way.
    }
    queryClient.clear();
    // A deliberate sign-out leaves no note draft and no map view behind for
    // the next person at this browser. The remembered sign-in name stays.
    clearAccountDrafts(user?.id);
    clearLastView();
    setUser(null);
    setSignInReason(null); // deliberate sign-out, not an expiry
    setState(authRequired ? "signin" : "open");
  }, [authRequired, queryClient, user?.id]);

  // A 401 from anywhere: the credential stopped working. A 403
  // ACCOUNT_DISABLED: the account is closed, which needs different words.
  useEffect(() => {
    const onExpired = (event: Event) => {
      const reason =
        (event as CustomEvent<AuthExpiredDetail>).detail?.reason ?? "expired";
      setState((current) => {
        // Only while the app is up. Before it, a 401 is expected.
        if (
          current !== "open" &&
          current !== "password-change" &&
          current !== "passkey-nudge"
        ) {
          return current;
        }
        queryClient.clear();
        setUser(null);
        setSignInReason(reason);
        return "signin";
      });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  // A data route refused until this account changes its password, as after
  // an admin's reset in another tab.
  useEffect(() => {
    const onForced = () =>
      setState((current) => (current === "open" ? "password-change" : current));
    window.addEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onForced);
    return () =>
      window.removeEventListener(PASSWORD_CHANGE_REQUIRED_EVENT, onForced);
  }, []);

  // Something changed what this account may do, or what the instance allows.
  // `/status` lives in state, not in a cache, so only this re-reads it.
  useEffect(() => {
    const onStale = () => void check();
    window.addEventListener(AUTH_STATUS_STALE_EVENT, onStale);
    return () => window.removeEventListener(AUTH_STATUS_STALE_EVENT, onStale);
  }, [check]);

  /**
   * Warms the contacts cache once the gate opens (before it, a gated instance
   * answers 401), and again for each new identity.
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
    // Unreachable: `false` hides a sign-out that cannot work and an admin
    // area whose every request would fail.
    authRequired: state === "unreachable" ? false : authRequired,
    isAdmin: user?.role === "admin",
    publicUrl,
    mcpOAuth,
    instanceName,
    mapStyles,
    isResolved: state !== "checking" && state !== "unreachable",
    refresh: check,
    signOut: handleSignOut,
  };

  function renderScreen(): React.ReactNode {
    switch (state) {
      // Nothing while checking: the call takes milliseconds, and a spinner
      // would only flash.
      case "checking":
        return null;
      case "setup":
        return (
          <SetupWizard
            onCreated={handleAccountCreated}
            deviceContacts={deviceContacts}
            localOwnerPresent={localOwnerPresent}
            mailConfigured={mailConfigured}
          />
        );
      case "join":
        return (
          <AcceptInvitation
            token={invitation ?? ""}
            onAccepted={handleAccountCreated}
            onCancel={() => {
              clearInvitation();
              void check();
            }}
            mailConfigured={mailConfigured}
          />
        );
      case "register":
        return (
          <Register
            onRegistered={handleAccountCreated}
            onCancel={() => setState("signin")}
            mailConfigured={mailConfigured}
          />
        );
      case "passkey-nudge":
        return (
          <PasskeyNudge
            onDone={() => {
              void check();
              setState("open");
            }}
          />
        );
      case "password-change":
        return <ForcedPasswordChange onChanged={check} />;
      case "reset":
        return (
          <ResetPassword
            token={resetToken ?? ""}
            onReset={handleAuthenticated}
            onRequestNewLink={() => {
              clearResetToken();
              setState("forgot");
            }}
          />
        );
      case "link":
        return (
          <MagicLinkLanding
            token={magicToken ?? ""}
            onSignedIn={handleAuthenticated}
            onCancel={() => {
              clearMagicToken();
              setState("signin");
            }}
          />
        );
      case "forgot":
        return (
          <ForgotPassword
            onBack={() => setState("signin")}
            mailConfigured={mailConfigured}
          />
        );
      case "signin":
        return (
          <SignIn
            onSignedIn={handleAuthenticated}
            reason={signInReason}
            canRegister={registrationOpen}
            onRegister={() => setState("register")}
            mailConfigured={mailConfigured}
            // A mailed link opens in another browser, where an app's
            // sign-in in progress is not, so the consent page offers none.
            magicLinkSignIn={magicLinkSignIn && !isConsentPage()}
          />
        );
      default:
        // `open` and `unreachable` both render the app. A new identity
        // replaces the tree (the key).
        return (
          <AppScope key={user?.id ?? "anon"}>
            <PreferencesProvider>
              {isConsentPage() ? (
                <Suspense fallback={null}>
                  <OAuthConsent />
                </Suspense>
              ) : (
                children
              )}
            </PreferencesProvider>
          </AppScope>
        );
    }
  }

  return (
    <AuthContext.Provider value={context}>
      {renderScreen()}
    </AuthContext.Provider>
  );
};
