/**
 * SignIn — username-or-email + password.
 *
 * One identifier field rather than a choice between two, because making
 * someone decide which of their own identifiers to type is a question with no
 * useful answer; the server accepts either.
 */
import React, { useState } from "react";
import { Lock, LogIn, Loader2 } from "lucide-react";
import { signIn } from "../../api/auth";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";

/** Why this screen appeared, when it was not the user's own doing. */
export type SignInReason = "expired" | "disabled" | null;

const HEADINGS: Record<
  "expired" | "disabled",
  { title: string; subtitle: string }
> = {
  expired: {
    title: "Signed out",
    subtitle:
      "Your session expired, so Contrack signed you out. Sign in to pick up where you left off.",
  },
  // Deliberately not "sign in again". This account is closed, and the one
  // thing a sign-in form invites is the one thing that cannot work.
  disabled: {
    title: "This account is disabled",
    subtitle:
      "An administrator has closed this account. Ask them to enable it, or sign in with a different one.",
  },
};

export const SignIn = ({
  onSignedIn,
  reason,
  canRegister = false,
  onRegister,
}: {
  onSignedIn: () => void;
  reason?: SignInReason;
  /** True when this instance accepts new accounts from the sign-in page. */
  canRegister?: boolean;
  onRegister?: () => void;
}) => {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !identifier.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn({ identifier: identifier.trim(), password });
      onSignedIn();
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : // Sign-in shares one per-address budget with register, accept-
            // invitation and change-password. A refusal for that reason is
            // not a wrong password, and saying "incorrect" would send
            // somebody hunting for a password that was right.
            (rateLimitMessage(err) ??
              (err instanceof Error ? err.message : "Sign-in failed.")),
      );
      // Clear only the password. Retyping a username you already got right is
      // busywork, and the failure is almost always the other field.
      setPassword("");
      setBusy(false);
      return;
    }
    // Left busy on success: the tree is about to be replaced, and re-enabling
    // the button first would flash an interactive form nobody should use.
  };

  return (
    <AuthShell
      icon={<Lock className="w-7 h-7" />}
      title={reason ? HEADINGS[reason].title : "Welcome back"}
      subtitle={
        reason ? HEADINGS[reason].subtitle : "Sign in to your Contrack account."
      }
      onSubmit={handleSubmit}
      footer={
        <>
          {canRegister && onRegister && (
            <>
              No account yet?{" "}
              <button
                type="button"
                onClick={onRegister}
                className="text-primary font-bold hover:underline"
              >
                Create one
              </button>
              <br />
            </>
          )}
          Forgot your password? A self-hosted Contrack has no way to email you a
          reset — see the configuration docs for the recovery steps.
        </>
      }
    >
      <div className="space-y-4">
        <AuthField
          id="identifier"
          label="Username or email"
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          // The sign-in screen is the whole page and has one starting point.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <AuthError>{error}</AuthError>}
      </div>

      <AuthSubmit busy={busy} disabled={!identifier.trim() || !password}>
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            <LogIn className="w-4 h-4" />
            Sign in
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
