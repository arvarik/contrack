/**
 * ForgotPassword — panel opened when a user clicks "Forgot your password?".
 *
 * Has two shapes depending on whether outgoing mail is configured:
 * - With mail: email field to request a self-service password reset link.
 * - Without mail: ask an admin, and the server command behind "I run this
 *   server".
 *
 * @module components/auth/ForgotPassword
 */

import React, { useState } from "react";
import { Mail, Loader2, ArrowLeft } from "lucide-react";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";
import { touchFirst } from "../../lib/platform";
import { requestPasswordReset } from "../../api/authLinks";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";

export const ForgotPassword = ({
  onBack,
  mailConfigured = false,
}: {
  onBack: () => void;
  mailConfigured?: boolean;
}) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mailConfigured) {
      onBack();
      return;
    }
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not request password reset")),
      );
    } finally {
      setBusy(false);
    }
  };

  // The pages with nothing to fill in have one way back: the button.
  const backButton = (
    <div className="pt-2">
      <button type="button" onClick={onBack} className="btn-secondary w-full">
        Back to sign in
      </button>
    </div>
  );

  if (!mailConfigured) {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="This Contrack cannot send email, so an admin resets it for you"
        onSubmit={handleSubmit}
      >
        <div className="space-y-3 text-sm text-on-surface-variant text-pretty">
          <p>
            Ask an admin to reset your password in Settings → Accounts. You get
            a temporary password to sign in with
          </p>
          {/* Closed, so a visitor does not get a server command first. */}
          <details>
            <summary className="cursor-pointer font-semibold text-on-surface min-h-[44px] flex items-center">
              I run this server
            </summary>
            <p>
              Run{" "}
              <code className="px-1.5 py-0.5 rounded bg-surface-container font-mono text-xs text-on-surface">
                node scripts/reset-password.ts &lt;username&gt;
              </code>{" "}
              on the server. It prints a temporary password
            </p>
          </details>
        </div>
        {backButton}
      </AuthShell>
    );
  }

  if (sent) {
    return (
      <AuthShell
        title="Reset your password"
        subtitle="If that address has an account, a link is on its way. It works for one hour"
        onSubmit={(e) => {
          e.preventDefault();
          onBack();
        }}
      >
        {backButton}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email address and we'll send you a link to reset your password"
      onSubmit={handleSubmit}
      footer={
        <button
          type="button"
          onClick={onBack}
          className="text-primary font-bold hover:underline min-h-[44px] inline-flex items-center gap-1.5 py-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to sign in
        </button>
      }
    >
      <div className="space-y-4">
        <AuthField
          id="reset-email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => {
            if (error) setError(null);
            setEmail(e.target.value);
          }}
          autoComplete="email"
          required
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!touchFirst()}
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
              Send reset link
            </>
          )}
        </AuthSubmit>
      </div>
    </AuthShell>
  );
};
