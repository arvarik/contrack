/**
 * Where `/reset-password?token=` lands: choose a new password. A spent or
 * expired link says so, with a way to ask for a new one.
 */

import React, { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  AuthError,
  authErrorText,
} from "./AuthShell";
import { PasswordStrengthMeter } from "../../lib/passwordStrength";
import { completePasswordReset } from "../../api/authLinks";
import { ApiError } from "../../api/client";

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
      setError(authErrorText(err, "Could not reset your password"));
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
      footer="A new password signs you out everywhere else, and every API token and MCP app you connected stops working"
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
