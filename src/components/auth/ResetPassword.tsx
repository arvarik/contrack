/**
 * ResetPassword — screen where `/reset-password?token=` lands.
 *
 * Allows a user holding a valid one-time reset link to choose a new password.
 * When the link is dead (expired or already used), shows a dead-link state
 * with a button to request a new link.
 *
 * @module components/auth/ResetPassword
 */

import React, { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";
import { PasswordStrengthMeter } from "../../lib/passwordStrength";
import { completePasswordReset } from "../../api/authLinks";
import { isNetworkError, ApiError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";

export const ResetPassword = ({
  token,
  onReset,
  onRequestNewLink,
}: {
  token: string;
  onReset: () => void;
  onRequestNewLink: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !password) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await completePasswordReset({ token, password });
      onReset();
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 410)
      ) {
        setDead(true);
      }
      setError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not reset your password")),
      );
      setBusy(false);
    }
  };

  if (dead || !token) {
    return (
      <AuthShell
        icon={<KeyRound className="w-7 h-7" />}
        title="This reset link is no longer valid"
        subtitle={
          error ??
          "The link has already been used or has expired. Reset links work for a limited time and can only be used once"
        }
        onSubmit={(event) => {
          event.preventDefault();
          onRequestNewLink();
        }}
        footer="Reset links work once. You can request a new one at any time"
      >
        <AuthSubmit>Request a new link</AuthSubmit>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="Enter a new password for your Contrack account"
      onSubmit={handleSubmit}
      footer="Once you set a new password, all other active sessions will be signed out"
    >
      <div className="space-y-4">
        <AuthField
          id="new-password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => {
            if (error) setError(null);
            setPassword(e.target.value);
          }}
          autoComplete="new-password"
          required
          revealable
          capsLockHint
        />
        <PasswordStrengthMeter password={password} />
        {error && <AuthError>{error}</AuthError>}
      </div>

      <div className="space-y-3 pt-2">
        <AuthSubmit busy={busy} disabled={!password}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Setting password…
            </>
          ) : (
            "Set my password"
          )}
        </AuthSubmit>
      </div>
    </AuthShell>
  );
};
