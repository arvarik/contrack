/**
 * PasskeyNudge — post-creation interstitial offering to register a passkey.
 *
 * Appears after first-run setup, registration, or accepting an invitation,
 * when the browser supports passkeys and the account has not registered one yet.
 *
 * @module components/auth/PasskeyNudge
 */
import React, { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { AuthShell, AuthSubmit, AuthError } from "./AuthShell";
import { registerPasskey, dismissPasskeyNudge } from "../../api/passkeys";

export const PasskeyNudge = ({ onDone }: { onDone: () => void }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      onDone();
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName !== "AbortError" && errName !== "NotAllowedError") {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to add passkey. Try again.",
        );
      }
      setBusy(false);
    }
  };

  const handleNotNow = async () => {
    try {
      await dismissPasskeyNudge();
    } catch {
      // Best effort dismissal
    }
    onDone();
  };

  return (
    <AuthShell
      icon={<KeyRound className="w-6 h-6" />}
      title="Sign in faster next time"
      subtitle="Add a passkey and this device signs you in with Face ID, Touch ID or Windows Hello. Your password still works."
      onSubmit={(e) => {
        e.preventDefault();
        void handleAddPasskey();
      }}
    >
      {error && <AuthError>{error}</AuthError>}

      <div className="space-y-3 pt-2">
        <AuthSubmit busy={busy}>
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Waiting for your device…
            </>
          ) : (
            <>
              <KeyRound className="w-4 h-4" />
              Add a passkey
            </>
          )}
        </AuthSubmit>

        <button
          type="button"
          onClick={handleNotNow}
          disabled={busy}
          className="btn-secondary w-full"
        >
          Not now
        </button>
      </div>
    </AuthShell>
  );
};
