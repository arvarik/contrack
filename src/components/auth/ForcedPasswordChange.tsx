/**
 * The screen after an admin creates or resets an account's password. Until
 * it is replaced, every data route answers `403 PASSWORD_CHANGE_REQUIRED`,
 * so this is a full page, not a modal over a page that cannot work.
 */
import React, { useState } from "react";
import { KeyRound, Loader2, LogOut } from "lucide-react";
import { changePassword } from "../../api/auth";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  AuthError,
  authErrorText,
} from "./AuthShell";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "./accountForm";
import { useAuth } from "./AuthGate";
import { touchFirst } from "../../lib/platform";

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
        setFormError("Choose a password different from the temporary one");
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      await onChanged();
    } catch (err) {
      // A rate limit (shared with sign-in, register and join) says so, so
      // nobody retries into it.
      setFormError(authErrorText(err, "Could not change the password"));
      setCurrent("");
      setBusy(false);
    }
  };

  return (
    <AuthShell
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
          Replace it to continue. Nothing else works until you do
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
          hint="The one you were given"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          revealable
          capsLockHint
          // Not on a touch screen, where focus opens the keyboard.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={!touchFirst()}
        />
        <AuthField
          id="new-password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words beats a short scramble`}
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onBlur={() => setTouched(true)}
          error={touched ? problems.password : undefined}
          autoComplete="new-password"
          required
          revealable
          capsLockHint
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
          revealable
          capsLockHint
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
