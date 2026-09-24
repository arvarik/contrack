/**
 * The four fields that create an account, and the rules they follow.
 *
 * Three screens create an account: first-run setup, open registration, and
 * accepting an invitation. They differ in their title, their copy, and which
 * endpoint they call. They do not differ in what an account is, so the fields,
 * the validation, the blur behaviour and the error wording live here once.
 *
 * The rules mirror the server's (`server/services/authService.ts`) and run on
 * blur rather than on every keystroke: telling someone their email is invalid
 * while they are still typing the domain is noise, not help. The server is
 * still the authority; this only saves a round trip.
 */
import React, { useCallback, useMemo, useState } from "react";
import { uploadAccountAvatar } from "../../api/auth";
import { accountAvatarUrl } from "../../lib/avatar";
import { AccountPhotoField } from "./AccountPhotoField";
import { AuthField } from "./AuthShell";
import { PasswordStrengthMeter } from "../../lib/passwordStrength";

/** Kept in step with USERNAME_PATTERN in server/services/authService.ts. */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export type AccountField = "displayName" | "email" | "username" | "password";

type Values = Record<AccountField, string>;
type Errors = Partial<Record<AccountField, string>>;

const EMPTY: Values = {
  displayName: "",
  email: "",
  username: "",
  password: "",
};

/**
 * Suggest a username from an email address.
 *
 * Takes the local part, lowercases it, replaces characters outside USERNAME_PATTERN
 * with '.', collapses consecutive dots, trims non-alphanumeric edges, and clips to 32 characters.
 */
export function suggestUsername(email: string): string {
  if (!email) return "";
  const atIndex = email.indexOf("@");
  const localPart = atIndex === -1 ? email : email.slice(0, atIndex);
  let s = localPart.toLowerCase();

  s = s.replace(/[^a-z0-9._-]/g, ".");
  s = s.replace(/\.+/g, ".");
  s = s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  s = s.slice(0, 32);
  s = s.replace(/[^a-z0-9]+$/, "");

  return s;
}

/**
 * Why a new password is not acceptable, or undefined when it is.
 *
 * Shared with the forced-change screen, which has no email or username but
 * the same password fields and ways to get them wrong.
 */
export function passwordProblem(
  password: string,
  confirm?: string,
): { password?: string; confirm?: string } {
  const problems: { password?: string; confirm?: string } = {};
  if (!password) problems.password = "Choose a password";
  else if (password.length < MIN_PASSWORD_LENGTH)
    problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (confirm !== undefined && password && confirm !== password)
    problems.confirm = "These don't match";
  return problems;
}

function validate(values: Values): Errors {
  const errors: Errors = {};

  const email = values.email.trim().toLowerCase();
  if (!email) errors.email = "Enter an email address";
  else if (!EMAIL_PATTERN.test(email))
    errors.email = "That doesn't look like an email address";

  const username = values.username.trim().toLowerCase();
  if (!username) errors.username = "Choose a username";
  else if (username.length < 2)
    errors.username = "Usernames need at least 2 characters";
  else if (username.length > 32)
    errors.username = "Usernames can be at most 32 characters";
  else if (!USERNAME_PATTERN.test(username))
    errors.username =
      "Use lowercase letters, numbers, dots, dashes and underscores";

  return { ...errors, ...passwordProblem(values.password) };
}

export interface AccountForm {
  values: Values;
  photo: File | null;
  setPhoto: (photo: File | null) => void;
  errors: Errors;
  isValid: boolean;
  isUsernameSuggested: boolean;
  /** The error to show for a field: only after the user has left it. */
  errorFor: (field: AccountField) => string | undefined;
  set: (
    field: AccountField,
  ) => (event: React.ChangeEvent<HTMLInputElement>) => void;
  blur: (field: AccountField) => () => void;
  /** Mark every field touched, so one submit reveals every problem at once. */
  revealAll: () => void;
  /** The values as the server should receive them. */
  payload: () => {
    email: string;
    username: string;
    password: string;
    displayName: string;
  };
}

export function useAccountForm(initial?: Partial<Values>): AccountForm {
  const [values, setValues] = useState<Values>({ ...EMPTY, ...initial });
  const [photo, setPhoto] = useState<File | null>(null);
  const [usernameEdited, setUsernameEdited] = useState(
    Boolean(initial?.username),
  );
  // Only fields the user has left show errors, so the form is not a wall of
  // red before they have typed anything.
  const [touched, setTouched] = useState<
    Partial<Record<AccountField, boolean>>
  >({});

  const errors = useMemo(() => validate(values), [values]);

  const set = useCallback(
    (field: AccountField) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      if (field === "username") {
        setUsernameEdited(true);
        setValues((prev) => ({ ...prev, username: next }));
        return;
      }
      if (field === "email" && !usernameEdited) {
        const suggested = suggestUsername(next);
        setValues((prev) => ({
          ...prev,
          email: next,
          username: suggested,
        }));
        return;
      }
      setValues((prev) => ({ ...prev, [field]: next }));
    },
    [usernameEdited],
  );

  const blur = useCallback(
    (field: AccountField) => () =>
      setTouched((prev) => ({ ...prev, [field]: true })),
    [],
  );

  const revealAll = useCallback(
    () =>
      setTouched({
        displayName: true,
        email: true,
        username: true,
        password: true,
      }),
    [],
  );

  const isUsernameSuggested = !usernameEdited && Boolean(values.username);

  return {
    values,
    photo,
    setPhoto,
    errors,
    isValid: Object.keys(errors).length === 0,
    isUsernameSuggested,
    errorFor: (field) => (touched[field] ? errors[field] : undefined),
    set,
    blur,
    revealAll,
    payload: () => ({
      email: values.email.trim(),
      username: values.username.trim(),
      password: values.password,
      displayName: values.displayName.trim(),
    }),
  };
}

/**
 * Run account creation followed by photo upload when a photo was selected.
 *
 * A failure during photo upload does not block account creation: the account
 * is already created and authenticated, so it resolves with `{ photoFailed: true }`
 * and lets the caller notify the user.
 */
export async function createAccountThenPhoto(
  submit: () => Promise<unknown>,
  photo: File | null,
): Promise<{ photoFailed: boolean }> {
  await submit();
  if (!photo) {
    return { photoFailed: false };
  }
  try {
    await uploadAccountAvatar(photo);
    return { photoFailed: false };
  } catch {
    return { photoFailed: true };
  }
}

/**
 * The fields that create an account, in the order they are filled in.
 *
 * `autoFocus` is on the first field because each of the three screens is the
 * whole page with one thing to do on it.
 */
export const AccountFields = ({
  form,
  passwordHint,
  nameHint = "Optional. Shown in the app",
}: {
  form: AccountForm;
  passwordHint?: string;
  nameHint?: string;
}) => {
  const usernameHint = form.isUsernameSuggested
    ? "Suggested from your email. Change it if you like"
    : "Lowercase letters, numbers, dots, dashes, underscores";

  return (
    <>
      <div className="space-y-1.5">
        <AccountPhotoField
          value={form.photo}
          fallbackUrl={accountAvatarUrl(
            form.values.username || form.values.displayName,
          )}
          onChange={form.setPhoto}
        />
        <p className="text-xs text-on-surface-variant">
          Optional. You can add or change it later in Settings
        </p>
      </div>
      <AuthField
        id="displayName"
        label="Your name"
        hint={nameHint}
        type="text"
        value={form.values.displayName}
        onChange={form.set("displayName")}
        onBlur={form.blur("displayName")}
        autoComplete="name"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
      />
      <AuthField
        id="email"
        label="Email"
        hint="Used to sign in. Contrack never sends mail"
        type="email"
        inputMode="email"
        value={form.values.email}
        onChange={form.set("email")}
        onBlur={form.blur("email")}
        error={form.errorFor("email")}
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <AuthField
        id="username"
        label="Username"
        hint={usernameHint}
        type="text"
        value={form.values.username}
        onChange={form.set("username")}
        onBlur={form.blur("username")}
        error={form.errorFor("username")}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <AuthField
        id="password"
        label="Password"
        hint={
          passwordHint ??
          `At least ${MIN_PASSWORD_LENGTH} characters. A few random words beats a short scramble`
        }
        type="password"
        value={form.values.password}
        onChange={form.set("password")}
        onBlur={form.blur("password")}
        error={form.errorFor("password")}
        autoComplete="new-password"
        required
        revealable
        capsLockHint
      />
      <PasswordStrengthMeter password={form.values.password} />
    </>
  );
};
