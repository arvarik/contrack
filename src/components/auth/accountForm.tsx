/**
 * The five fields that create an account, and the rules they follow.
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
import { AuthField } from "./AuthShell";

/** Kept in step with USERNAME_PATTERN in server/services/authService.ts. */
export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export type AccountField =
  "displayName" | "email" | "username" | "password" | "confirm";

type Values = Record<AccountField, string>;
type Errors = Partial<Record<AccountField, string>>;

const EMPTY: Values = {
  displayName: "",
  email: "",
  username: "",
  password: "",
  confirm: "",
};

/**
 * Why a new password is not acceptable, or undefined when it is.
 *
 * Shared with the forced-change screen, which has no email or username but
 * the same two password fields and the same two ways to get them wrong.
 */
export function passwordProblem(
  password: string,
  confirm: string,
): { password?: string; confirm?: string } {
  const problems: { password?: string; confirm?: string } = {};
  if (!password) problems.password = "Choose a password.";
  else if (password.length < MIN_PASSWORD_LENGTH)
    problems.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password && confirm !== password) problems.confirm = "These don't match.";
  return problems;
}

function validate(values: Values): Errors {
  const errors: Errors = {};

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

  return { ...errors, ...passwordProblem(values.password, values.confirm) };
}

export interface AccountForm {
  values: Values;
  errors: Errors;
  isValid: boolean;
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
  // Only fields the user has left show errors, so the form is not a wall of
  // red before they have typed anything.
  const [touched, setTouched] = useState<
    Partial<Record<AccountField, boolean>>
  >({});

  const errors = useMemo(() => validate(values), [values]);

  const set = useCallback(
    (field: AccountField) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setValues((prev) => ({ ...prev, [field]: next }));
    },
    [],
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
        confirm: true,
      }),
    [],
  );

  return {
    values,
    errors,
    isValid: Object.keys(errors).length === 0,
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
 * The five fields, in the order they are filled in.
 *
 * `autoFocus` is on the first field because each of the three screens is the
 * whole page with one thing to do on it.
 */
export const AccountFields = ({
  form,
  passwordHint,
  nameHint = "Optional. Shown in the app.",
}: {
  form: AccountForm;
  passwordHint?: string;
  nameHint?: string;
}) => (
  <>
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
      hint="Used to sign in. Contrack never sends mail."
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
      hint="Lowercase letters, numbers, dots, dashes, underscores."
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
        `At least ${MIN_PASSWORD_LENGTH} characters. A few random words beats a short scramble.`
      }
      type="password"
      value={form.values.password}
      onChange={form.set("password")}
      onBlur={form.blur("password")}
      error={form.errorFor("password")}
      autoComplete="new-password"
      required
    />
    <AuthField
      id="confirm"
      label="Confirm password"
      type="password"
      value={form.values.confirm}
      onChange={form.set("confirm")}
      onBlur={form.blur("confirm")}
      error={form.errorFor("confirm")}
      autoComplete="new-password"
      required
    />
  </>
);
