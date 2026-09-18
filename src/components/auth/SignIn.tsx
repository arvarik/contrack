/**
 * SignIn — username-or-email + password.
 *
 * One identifier field rather than a choice between two, because making
 * someone decide which of their own identifiers to type is a question with no
 * useful answer; the server accepts either.
 */
import React, { useEffect, useRef, useState } from "react";
import { LogIn, Loader2, Mail, ArrowLeft } from "lucide-react";
import { signIn } from "../../api/auth";
import {
  passkeysSupported,
  passkeyAutofillSupported,
  signInWithPasskey,
} from "../../api/passkeys";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";
import { PasskeyButton } from "./PasskeyButton";
import { ForgotPassword } from "./ForgotPassword";
import { requestMagicLink } from "../../api/authLinks";

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
  mailConfigured = false,
  magicLinkSignIn = false,
}: {
  onSignedIn: () => void;
  reason?: SignInReason;
  /** True when this instance accepts new accounts from the sign-in page. */
  canRegister?: boolean;
  onRegister?: () => void;
  mailConfigured?: boolean;
  magicLinkSignIn?: boolean;
}) => {
  const [view, setView] = useState<"signin" | "forgot" | "magic-link">(
    "signin",
  );
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

  const isPasskeySupported = passkeysSupported();
  const autofillAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!isPasskeySupported) return;

    let mounted = true;
    const controller = new AbortController();
    autofillAbortRef.current = controller;

    passkeyAutofillSupported()
      .then((supported) => {
        if (!supported || !mounted || controller.signal.aborted) return;
        return signInWithPasskey({
          useBrowserAutofill: true,
          signal: controller.signal,
        });
      })
      .then((user) => {
        if (user && mounted) {
          onSignedIn();
        }
      })
      .catch((err) => {
        // AbortError is normal when user switches to password or clicks passkey button.
        // Ignore quiet autofill dismissal/errors.
        if (err?.name !== "AbortError") {
          // No alert for passive autofill failure
        }
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [isPasskeySupported, onSignedIn]);

  const abortAutofill = () => {
    if (autofillAbortRef.current) {
      autofillAbortRef.current.abort();
      autofillAbortRef.current = null;
    }
  };

  const handlePasskeySignIn = async () => {
    abortAutofill();
    if (busy || passkeyBusy) return;
    setPasskeyBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      onSignedIn();
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setError(
          "That passkey did not work. Try again, or sign in with your password.",
        );
      }
      setPasskeyBusy(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    abortAutofill();
    if (busy || passkeyBusy || !identifier.trim() || !password) return;
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

  if (view === "forgot") {
    return (
      <ForgotPassword
        onBack={() => setView("signin")}
        mailConfigured={mailConfigured}
      />
    );
  }

  if (view === "magic-link") {
    return (
      <MagicLinkRequest
        onBack={() => setView("signin")}
        initialEmail={identifier.includes("@") ? identifier : ""}
      />
    );
  }

  return (
    <AuthShell
      title={reason ? HEADINGS[reason].title : "Welcome back"}
      subtitle={
        reason ? HEADINGS[reason].subtitle : "Sign in to your Contrack account."
      }
      onSubmit={handleSubmit}
      footer={
        <span className="inline-flex items-center gap-2 justify-center flex-wrap">
          <button
            type="button"
            onClick={() => setView("forgot")}
            className="text-primary font-bold hover:underline"
          >
            Forgot your password?
          </button>
          {canRegister && onRegister && (
            <>
              <span className="text-on-surface-variant/60">·</span>
              <button
                type="button"
                onClick={onRegister}
                className="text-primary font-bold hover:underline"
              >
                Create one
              </button>
            </>
          )}
        </span>
      }
    >
      <div className="space-y-4">
        <AuthField
          id="identifier"
          label="Username or email"
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete={isPasskeySupported ? "username webauthn" : "username"}
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

      <div className="space-y-3">
        <AuthSubmit
          busy={busy}
          disabled={passkeyBusy || !identifier.trim() || !password}
        >
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

        {isPasskeySupported && (
          <>
            <div className="relative my-3 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-outline-variant/30" />
              </div>
              <span className="relative bg-surface-container-low px-3 text-xs text-on-surface-variant">
                or
              </span>
            </div>
            <PasskeyButton
              onClick={handlePasskeySignIn}
              busy={passkeyBusy}
              disabled={busy}
            />
          </>
        )}

        {magicLinkSignIn && (
          <div className="text-center pt-1">
            <button
              type="button"
              onClick={() => setView("magic-link")}
              className="text-xs text-primary font-medium hover:underline"
            >
              Email me a sign-in link
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
};

const MagicLinkRequest = ({
  onBack,
  initialEmail = "",
}: {
  onBack: () => void;
  initialEmail?: string;
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not send sign-in link.")),
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="If that address has an account, a link is on its way. It works for 15 minutes."
        onSubmit={(e) => {
          e.preventDefault();
          onBack();
        }}
        footer={
          <button
            type="button"
            onClick={onBack}
            className="text-primary font-bold hover:underline inline-flex items-center gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to sign in
          </button>
        }
      >
        <div className="pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-full py-2.5 px-4 rounded-xl bg-surface-container text-on-surface font-medium hover:bg-surface-container-high transition-colors text-sm"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Sign in with email"
      subtitle="Enter your email address and we'll send you a link that signs you right in."
      onSubmit={handleSubmit}
      footer={
        <button
          type="button"
          onClick={onBack}
          className="text-primary font-bold hover:underline inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </button>
      }
    >
      <div className="space-y-4">
        <AuthField
          id="magic-email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        {error && <AuthError>{error}</AuthError>}
      </div>
      <div className="space-y-3 pt-2">
        <AuthSubmit busy={busy} disabled={!email.trim()}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Sending link…
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              Send sign-in link
            </>
          )}
        </AuthSubmit>
      </div>
    </AuthShell>
  );
};
