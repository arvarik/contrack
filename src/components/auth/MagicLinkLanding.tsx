/**
 * MagicLinkLanding — screen where `/signin-link?token=` lands.
 *
 * Automatically redeems the token on mount and signs the user in.
 * If the link is dead (expired or already used), shows a dead-link message
 * with a button to return to the sign-in screen.
 *
 * @module components/auth/MagicLinkLanding
 */

import React, { useEffect, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { AuthShell, AuthSubmit } from "./AuthShell";
import { completeMagicLink } from "../../api/authLinks";
import { isNetworkError } from "../../api/client";
import { rateLimitMessage } from "../../lib/rateLimitMessage";

export const MagicLinkLanding = ({
  token,
  onSignedIn,
  onCancel,
}: {
  token: string;
  onSignedIn: () => void;
  onCancel: () => void;
}) => {
  const [error, setError] = useState<string | null>(null);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setDead(true);
      return;
    }

    completeMagicLink({ token })
      .then(() => {
        if (mounted) {
          onSignedIn();
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setDead(true);
        setError(
          isNetworkError(err)
            ? "Can't reach the Contrack server. Is it running?"
            : (rateLimitMessage(err) ??
                (err instanceof Error
                  ? err.message
                  : "This sign-in link is no longer valid")),
        );
      });

    return () => {
      mounted = false;
    };
  }, [token, onSignedIn]);

  if (dead) {
    return (
      <AuthShell
        icon={<MailCheck className="w-7 h-7" />}
        title="This sign-in link is no longer valid"
        subtitle={
          error ??
          "The link has already been used or has expired. Sign-in links work for 15 minutes and can only be used once"
        }
        onSubmit={(event) => {
          event.preventDefault();
          onCancel();
        }}
        footer="Sign-in links work once. You can request a new one from the sign-in screen"
      >
        <AuthSubmit>Back to sign in</AuthSubmit>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Signing you in…"
      subtitle="Verifying your sign-in link and preparing your session"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex justify-center py-8">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    </AuthShell>
  );
};
