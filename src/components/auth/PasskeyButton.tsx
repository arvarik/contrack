/**
 * PasskeyButton — secondary button to sign in with a WebAuthn passkey.
 *
 * @module components/auth/PasskeyButton
 */
import React from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export const PasskeyButton = ({
  onClick,
  busy = false,
  disabled = false,
}: {
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || busy}
    className={cn(
      "w-full bg-surface-container-high text-on-surface font-bold py-3 rounded-xl",
      "flex items-center justify-center gap-2 transition-opacity hover:opacity-90",
      "disabled:bg-surface-container-high/50 disabled:text-on-surface-variant/50",
      "disabled:cursor-not-allowed disabled:hover:opacity-100",
    )}
  >
    {busy ? (
      <>
        <Loader2 className="w-4 h-4 animate-spin" />
        Waiting for your device…
      </>
    ) : (
      <>
        <KeyRound className="w-4 h-4" />
        Sign in with a passkey
      </>
    )}
  </button>
);
