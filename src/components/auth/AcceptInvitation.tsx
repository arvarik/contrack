/**
 * AcceptInvitation — the screen an invitation link lands on.
 *
 * The link is `/join?token=<secret>`. The gate reads the secret, strips it
 * from the address bar, and renders this instead of the app; `/join` is not a
 * route in the router, and never becomes one, because the gate answers it
 * before the router exists.
 *
 * The secret is single-use and lives in this component's props until the form
 * is submitted. Everything about it is one-shot: a link that has been used,
 * revoked or has expired is gone, and the screen says which, because "that
 * link does not work" leaves somebody retrying a link that never will.
 */
import React, { useEffect, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { acceptInvitation, checkInvitation } from "../../api/auth";
import { isNetworkError, ApiError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";
import { AuthShell, AuthSubmit, AuthError } from "./AuthShell";
import {
  AccountFields,
  createAccountThenPhoto,
  useAccountForm,
} from "./accountForm";

/**
 * 404 is a secret the server does not recognise, 410 is one it used to. Both
 * are final: no amount of retrying makes a used link work again.
 */
const isDeadLink = (err: unknown): err is ApiError =>
  err instanceof ApiError && (err.status === 404 || err.status === 410);

export const AcceptInvitation = ({
  token,
  onAccepted,
  onCancel,
  mailConfigured = false,
}: {
  token: string;
  onAccepted: () => void;
  /** Give up on the link and go wherever the gate would otherwise send us. */
  onCancel: () => void;
  /** True when the instance can email links. The email hint says which. */
  mailConfigured?: boolean;
}) => {
  const form = useAccountForm();
  const [formError, setFormError] = useState<string | null>(null);
  // A dead link cannot be retried, so the form is taken away rather than left
  // there inviting a second attempt that will fail the same way.
  const [dead, setDead] = useState(false);
  const [busy, setBusy] = useState(false);
  // The link is checked when it opens, so a dead one says so before anybody
  // fills in the form.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let live = true;
    checkInvitation(token)
      .catch((err: unknown) => {
        if (live && isDeadLink(err)) {
          setDead(true);
          setFormError(err.message);
        }
        // Anything else (the server is down, a rate limit) shows the form,
        // and the submit says what is wrong.
      })
      .finally(() => live && setChecked(true));
    return () => {
      live = false;
    };
  }, [token]);

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
        () => acceptInvitation({ token, ...form.payload() }),
        form.photo,
      );
      onAccepted();
    } catch (err) {
      if (isDeadLink(err)) setDead(true);
      setFormError(
        isNetworkError(err)
          ? "Can't reach the Contrack server. Is it running?"
          : (rateLimitMessage(err) ??
              (err instanceof Error
                ? err.message
                : "Could not accept the invitation")),
      );
      setBusy(false);
    }
  };

  if (!checked) {
    return (
      <AuthShell
        title="You've been invited"
        subtitle="Checking your invitation…"
        onSubmit={(event) => event.preventDefault()}
      >
        <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" />
      </AuthShell>
    );
  }

  if (dead) {
    return (
      <AuthShell
        icon={<MailCheck className="w-7 h-7" />}
        title="This invitation is no longer valid"
        subtitle={
          formError ??
          "The link has been used, revoked, or has expired. Ask whoever invited you for a new one"
        }
        onSubmit={(event) => {
          event.preventDefault();
          onCancel();
        }}
        footer="An invitation link works once. A new one takes an administrator a few seconds to make"
      >
        <AuthSubmit>Go to sign-in</AuthSubmit>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="You've been invited"
      subtitle="Choose how you'll sign in. Your account starts empty: an invitation gives you a place on this Contrack, not access to anyone else's contacts"
      onSubmit={handleSubmit}
      footer={
        <>
          Not expecting this?{" "}
          <button
            type="button"
            onClick={onCancel}
            className="text-primary font-bold hover:underline"
          >
            Go to sign-in
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
            <MailCheck className="w-4 h-4" />
            Accept invitation
          </>
        )}
      </AuthSubmit>
    </AuthShell>
  );
};
