/**
 * AuthGate — decides which of three things the app is right now.
 *
 *   1. Un-gated, or already signed in  → render the app.
 *   2. Gated with no account yet       → first-run setup.
 *   3. Gated and signed out            → sign-in.
 *
 * It also publishes the answer through `useAuth`, so the rest of the tree can
 * name the signed-in account without asking the server again. That is why the
 * gate owns the state rather than each screen fetching its own: the sidebar
 * and the account settings page both need the current user, and three
 * independent `/status` calls would be three chances to disagree.
 *
 * Session expiry is handled here too. The API client announces any 401 on the
 * window (see lib/appEvents), and this is what listens — without it, a session
 * that expires while the tab is open answers with a screenful of identical
 * error toasts and no way to sign back in.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchAuthStatus, signOut, type AccountUser } from "../../api/auth";
import { AUTH_EXPIRED_EVENT } from "../../lib/appEvents";
import { SignIn } from "./SignIn";
import { SetupWizard } from "./SetupWizard";

interface AuthContextValue {
  /** The signed-in account, or null when the instance is un-gated. */
  user: AccountUser | null;
  /** True when this instance requires a credential. */
  authRequired: boolean;
  /** Re-read /status — call after anything that changes the account. */
  refresh: () => Promise<void>;
  /** End the session and show the sign-in screen. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  authRequired: false,
  refresh: async () => {},
  signOut: async () => {},
});

/**
 * The current account and the actions that change it.
 *
 * Safe to call anywhere under AuthGate. On an un-gated instance `user` is null
 * and `authRequired` is false, which is the signal for account UI to hide
 * itself rather than offer a sign-out that does nothing.
 */
export const useAuth = () => useContext(AuthContext);

type GateState = "checking" | "setup" | "signin" | "open" | "unreachable";

export const AuthGate = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<GateState>("checking");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const queryClient = useQueryClient();

  const check = useCallback(async () => {
    try {
      const status = await fetchAuthStatus();
      setAuthRequired(status.authRequired);
      setUser(status.user);
      if (status.setupRequired) setState("setup");
      else if (status.authRequired && !status.authenticated) setState("signin");
      else setState("open");
    } catch {
      // The status endpoint is unreachable, which means the server is down —
      // not that we are locked out. Rendering the app lets its own connection
      // banner explain what is happening, which is the accurate story.
      setAuthRequired(false);
      setUser(null);
      setState("unreachable");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /**
   * Re-check after signing in or setting up.
   *
   * The cache is cleared first because everything in it was fetched as a
   * different principal — including, on a gated instance, a pile of 401s from
   * the cold-boot prefetch in main.tsx. Clearing beats a full page reload: no
   * white flash, and the queries refetch on mount anyway.
   */
  const handleAuthenticated = useCallback(async () => {
    queryClient.clear();
    await check();
  }, [check, queryClient]);

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
    setState(authRequired ? "signin" : "open");
  }, [authRequired, queryClient]);

  // A 401 from anywhere means the credential stopped being accepted.
  useEffect(() => {
    const onExpired = () => {
      setState((current) => {
        // Only meaningful while the app is up; during setup or sign-in a 401
        // is the expected state, not news.
        if (current !== "open") return current;
        queryClient.clear();
        setUser(null);
        return "signin";
      });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  // Nothing is rendered while checking. The call is same-origin and typically
  // resolves in a few milliseconds; a spinner for that long is a flash of
  // chrome, not feedback.
  if (state === "checking") return null;

  if (state === "setup") return <SetupWizard onCreated={handleAuthenticated} />;
  if (state === "signin") return <SignIn onSignedIn={handleAuthenticated} />;

  return (
    <AuthContext.Provider
      value={{
        user,
        authRequired,
        refresh: check,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
