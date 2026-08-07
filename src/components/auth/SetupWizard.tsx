/**
 * SetupWizard — the first-run screen that creates the owner's account.
 *
 * Shown once, on a gated instance with no accounts. Everything else is locked
 * until this is done, so it has to be self-explanatory with no way back and no
 * documentation to hand.
 *
 * Validation mirrors the server's rules (server/services/authService.ts) and
 * runs on blur rather than on every keystroke — telling someone their email is
 * invalid while they are still typing the domain is noise, not help. The
 * server is still the authority; this only saves a round trip.
 */
import React, { useState } from "react";
import { UserPlus, Loader2, ShieldCheck } from "lucide-react";
import { setupAccount } from "../../api/auth";
import { isNetworkError } from "../../api/client";
import { AuthShell, AuthField, AuthSubmit, AuthError } from "./AuthShell";

/** Kept in step with USERNAME_PATTERN in server/services/authService.ts. */
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type Field = "displayName" | "email" | "username" | "password" | "confirm";

function validate(
  values: Record<Field, string>,
): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};

  const email = values.email.trim().toLowerCase();
  if (!email) errors.email = "Enter an email address.";
  else if (!EMAIL_PATTERN.test(email))
    errors.email = "That doesn't look like an email address.";

  const username = values.username.trim().toLowerCase();
  if (!username) errors.username = "Choose a username.";
  else if (username.length < 2)
    errors.username = "Usernames need at least 2 characters.";
  else if (username.length > 32)
    errors.username = "Usernames can be at most 32 characters.";
  else if (!USERNAME_PATTERN.test(username))
    errors.username =
      "Use lowercase letters, numbers, dots, dashes and underscores.";

  if (!values.password) errors.password = "Choose a password.";
  else if (values.password.length < MIN_PASSWORD_LENGTH)
    errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

  if (values.password && values.confirm !== values.password)
    errors.confirm = "These don't match.";

  return errors;
}

export const SetupWizard = ({ onCreated }: { onCreated: () => void }) => {
  const [values, setValues] = useState<Record<Field, string>>({
    displayName: "",
    email: "",
    username: "",
    password: "",
    confirm: "",
  });
  // Only fields the user has left show errors, so the form is not a wall of
  // red before they have typed anything.
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errors = validate(values);
  const isValid = Object.keys(errors).length === 0;

  const set = (field: Field) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [field]: event.target.value }));
  const blur = (field: Field) => () =>
    setTouched((prev) => ({ ...prev, [field]: true }));
  const errorFor = (field: Field) =>
    touched[field] ? errors[field] : undefined;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!isValid) {
      // Reveal every problem at once rather than one submit at a time.
      setTouched({
        displayName: true,
        email: true,
        username: true,
        password: true,
        confirm: true,
      });
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await setupAccount({
        email: values.email.trim(),
        username: values.username.trim(),
        password: values.password,
        displayName: values.displayName.trim(),
      });
      onCreated();
    } catch (err) {
      setFormError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : err instanceof Error
            ? err.message
            : "Could not create the account.",
      );
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<ShieldCheck className="w-7 h-7" />}
      title="Set up Contrack"
      subtitle="This instance is protected. Create the account you'll sign in with — you're the only one who can, and it becomes the admin."
      onSubmit={handleSubmit}
      footer="Anything already in this Contrack — contacts, notes, lists — is assigned to this account when you create it."
    >
      <div className="space-y-4">
        <AuthField
          id="displayName"
          label="Your name"
          hint="Optional. Shown in the app."
          type="text"
          value={values.displayName}
          onChange={set("displayName")}
          onBlur={blur("displayName")}
          autoComplete="name"
          // First field of a screen the user was sent to with nothing else to do.
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
        <AuthField
          id="email"
          label="Email"
          hint="Used to sign in. Contrack never sends mail."
          type="email"
          inputMode="email"
          value={values.email}
          onChange={set("email")}
          onBlur={blur("email")}
          error={errorFor("email")}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <AuthField
          id="username"
          label="Username"
          hint="Lowercase letters, numbers, dots, dashes, underscores."
          type="text"
          value={values.username}
          onChange={set("username")}
          onBlur={blur("username")}
          error={errorFor("username")}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
        />
        <AuthField
          id="password"
          label="Password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words beats a short scramble.`}
          type="password"
          value={values.password}
          onChange={set("password")}
          onBlur={blur("password")}
          error={errorFor("password")}
          autoComplete="new-password"
          required
        />
        <AuthField
          id="confirm"
          label="Confirm password"
          type="password"
          value={values.confirm}
          onChange={set("confirm")}
          onBlur={blur("confirm")}
          error={errorFor("confirm")}
          autoComplete="new-password"
          required
        />
        {formError && <AuthError>{formError}</AuthError>}
      </div>

      <AuthSubmit busy={busy}>
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Creating account…
          </>
        ) : (
          <>
            <UserPlus className="w-4 h-4" />
            Create account
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
