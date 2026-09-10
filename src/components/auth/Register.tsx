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
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";
import { AuthShell, AuthSubmit, AuthError } from "./AuthShell";
import { AccountFields, useAccountForm } from "./accountForm";

export const Register = ({
  onRegistered,
  onCancel,
}: {
  onRegistered: () => void;
  onCancel: () => void;
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
      await registerAccount(form.payload());
      onRegistered();
    } catch (err) {
      setFormError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not create the account.")),
      );
      setBusy(false);
    }
  };

  return (
    <AuthShell
      icon={<UserPlus className="w-7 h-7" />}
      title="Create an account"
      subtitle="This Contrack is open to new accounts. Yours starts empty — nobody else's contacts are in it, and yours are not in theirs."
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
        <AccountFields form={form} />
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
