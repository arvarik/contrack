/**
 * ForcedPasswordChange — the screen an administrator's password reset leads to.
 *
 * An admin who creates an account, or resets one, hands over a password they
 * chose and can still read. Until it is replaced, the server refuses every
 * data route with `403 PASSWORD_CHANGE_REQUIRED`, so there is nothing useful
 * behind this screen and no reason to let anyone past it.
 *
 * It is a full-page screen rather than a modal for that reason: a modal
 * implies the page behind it still works, and it does not.
 */
import React, { useState } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { changePassword } from "../../api/auth";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./accountForm";
import { useAuth } from "./AuthGate";

export const ForcedPasswordChange = ({
  onChanged,
}: {
  /** Re-read /status. The gate opens once the flag is clear. */
  onChanged: () => void | Promise<void>;
}) => {
  const { user, signOut } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problems = passwordProblem(next, confirm);
  const ready =
    current.length > 0 &&
    Object.keys(problems).length === 0 &&
    next !== current;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!ready) {
      setTouched(true);
      if (current && next && next === current)
        setFormError("Choose a password different from the temporary one.");
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      await onChanged();
    } catch (err) {
      setFormError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : // Sign-in, register, accept-invitation and this screen share one
            // per-address budget on the server, so a few wrong attempts can
            // produce a rate limit rather than a rejection. Saying which it
            // is stops somebody retrying into a wall.
            (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not change the password.")),
      );
      setCurrent("");
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<KeyRound className="w-7 h-7" />}
      title="Choose your own password"
      subtitle={
        <>
          {user?.displayName || user?.username ? (
            <>
              You're signed in as{" "}
              <strong className="text-on-surface">
                {user.displayName || user.username}
              </strong>{" "}
              with a password an administrator chose.{" "}
            </>
          ) : (
            "You're signed in with a password an administrator chose. "
          )}
          Replace it to continue. Nothing else works until you do.
        </>
      }
      onSubmit={handleSubmit}
      footer={
        <>
          Changing your password signs you out everywhere else.{" "}
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-primary font-bold hover:underline inline-flex items-center gap-1"
          >
            <LogOut className="w-3 h-3" />
            Sign out instead
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <AuthField
          id="current-password"
          label="Temporary password"
          hint="The one you were given."
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          // The whole page has one thing to do on it.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <AuthField
          id="new-password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words beats a short scramble.`}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? problems.password : undefined}
          autoComplete="new-password"
          required
        />
        <AuthField
          id="confirm-password"
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? problems.confirm : undefined}
          autoComplete="new-password"
          required
        />
        {formError && <AuthError>{formError}</AuthError>}
      </div>

      <AuthSubmit busy={busy} disabled={!current || !next || !confirm}>
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <KeyRound className="w-4 h-4" />
            Set my password
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
