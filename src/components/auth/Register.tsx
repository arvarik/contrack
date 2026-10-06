/**
 * Register — create an account on an instance that takes new ones.
 *
 * Reached from a link on the sign-in screen, and only while the server says
 * `registrationOpen`. The link is hidden otherwise, and the server refuses
 * with `403 REGISTRATION_CLOSED` regardless, because a hidden link is not a
 * gate.
 *
 * The account is always a member. There is no role to choose: an instance
 * that let a stranger pick their own role would not be gated at all.
 */
import React, { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { registerAccount } from "../../api/auth";
import { AuthShell, AuthSubmit, AuthError, authErrorText } from "./AuthShell";
import {
  AccountFields,
  createAccountThenPhoto,
  useAccountForm,
} from "./accountForm";

export const Register = ({
  onRegistered,
  onCancel,
  mailConfigured = false,
}: {
  onRegistered: () => void;
  onCancel: () => void;
  /** True when the instance can email links. The email hint says which. */
  mailConfigured?: boolean;
}) => {
  const form = useAccountForm();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!form.isValid) {
      form.revealAll();
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await createAccountThenPhoto(
        () => registerAccount(form.payload()),
        form.photo,
      );
      onRegistered();
    } catch (err) {
      setFormError(authErrorText(err, "Could not create the account"));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create an account"
      subtitle="This Contrack is open to new accounts. Yours starts empty. No one else's contacts are in it, and yours are not in theirs"
      onSubmit={handleSubmit}
      footer={
        <>
          Already have an account?{" "}
          <button
            type="button"
            onClick={onCancel}
            className="text-primary font-bold hover:underline"
          >
            Sign in
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <AccountFields form={form} mailConfigured={mailConfigured} />
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
