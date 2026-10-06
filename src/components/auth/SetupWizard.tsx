/**
 * The first-run screen that creates the administrator, on a gated instance
 * nobody can sign in to. With `localOwnerPresent`, the instance ran without
 * sign-in and is being secured: this converts the account that owns its
 * contacts, and nothing moves. The fields come from `accountForm.tsx`.
 */
import React, { useState } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { setupAccount } from "../../api/auth";
import { AuthShell, AuthSubmit, AuthError, authErrorText } from "./AuthShell";
import {
  AccountFields,
  createAccountThenPhoto,
  useAccountForm,
} from "./accountForm";

export const SetupWizard = ({
  onCreated,
  deviceContacts = 0,
  localOwnerPresent = false,
  mailConfigured = false,
}: {
  onCreated: () => void;
  /** Contacts already in this database, waiting to be claimed. */
  deviceContacts?: number;
  /** True when this instance has been running with sign-in switched off. */
  localOwnerPresent?: boolean;
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
      // Reveal every problem at once rather than one submit at a time.
      form.revealAll();
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await createAccountThenPhoto(
        () => setupAccount(form.payload()),
        form.photo,
      );
      onCreated();
    } catch (err) {
      setFormError(authErrorText(err, "Could not create the account"));
      setBusy(false);
    }
  };

  const contacts = deviceContacts.toLocaleString();

  return (
    <AuthShell
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
                already here stay with it
              </>
            ) : (
              "Everything already here stays with it"
            )}
          </>
        ) : (
          "This instance asks everyone to sign in. Create the account you'll sign in with. It becomes the admin"
        )
      }
      onSubmit={handleSubmit}
      footer={
        localOwnerPresent
          ? "Nothing is moved or re-imported. The account that already owns this data becomes yours, keeping its id and everything attached to it"
          : "The first person to open this page creates the admin account, so finish this now"
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
            {localOwnerPresent ? "Secure this instance" : "Create account"}
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
