/** The secondary button that signs in with a passkey. */
import { KeyRound, Loader2 } from "lucide-react";

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
    className="btn-secondary w-full"
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
