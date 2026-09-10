/**
 * SetupWizard — the first-run screen that creates the administrator account.
 *
 * Shown once, on a gated instance nobody can sign in to. Everything else is
 * locked until this is done, so it has to be self-explanatory with no way
 * back and no documentation to hand.
 *
 * It has two stories to tell, and which one depends on `localOwnerPresent`.
 * A fresh install is being set up. An instance that has been running without
 * sign-in is being *secured*: its contacts already exist, they belong to an
 * account nobody can sign in to, and this screen converts that account rather
 * than creating a second one. Nothing is claimed, moved, or lost, and saying
 * so is the difference between confidence and a support question.
 *
 * The fields, their validation and their wording are shared with the register
 * and accept-invitation screens — see `accountForm.tsx`.
 */
import React, { useState } from "react";
import { UserPlus, Loader2, ShieldCheck } from "lucide-react";
import { setupAccount } from "../../api/auth";
import { isNetworkError } from "../../api/client";
import { AuthShell, AuthSubmit, AuthError } from "./AuthShell";
import { AccountFields, useAccountForm } from "./accountForm";

export const SetupWizard = ({
  onCreated,
  deviceContacts = 0,
  localOwnerPresent = false,
}: {
  onCreated: () => void;
  /** Contacts already in this database, waiting to be claimed. */
  deviceContacts?: number;
  /** True when this instance has been running with sign-in switched off. */
  localOwnerPresent?: boolean;
}) => {
  const form = useAccountForm();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!form.isValid) {
      // Reveal every problem at once rather than one submit at a time.
      form.revealAll();
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await setupAccount(form.payload());
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

  const contacts = deviceContacts.toLocaleString();

  return (
    <AuthShell
      icon={<ShieldCheck className="w-7 h-7" />}
      title={localOwnerPresent ? "Secure this instance" : "Set up Contrack"}
      subtitle={
        localOwnerPresent ? (
          <>
            Contrack has been running without sign-in. Create the administrator
            account.{" "}
            {deviceContacts > 0 ? (
              <>
                The{" "}
                <strong className="text-on-surface">{contacts} contacts</strong>{" "}
                already here stay with it.
              </>
            ) : (
              "Everything already here stays with it."
            )}
          </>
        ) : (
          "This instance is protected. Create the account you'll sign in with — you're the only one who can, and it becomes the admin."
        )
      }
      onSubmit={handleSubmit}
      footer={
        localOwnerPresent
          ? "Nothing is moved or re-imported. The account that already owns this data becomes yours, keeping its id and everything attached to it."
          : "You're the only one who can create this account. It becomes the admin."
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
            {localOwnerPresent ? "Secure this instance" : "Create account"}
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
