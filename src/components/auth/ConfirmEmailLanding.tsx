/**
 * Where `/confirm-email?token=` lands: finishes the email change on mount and
 * says what happened. It works signed in or not, on any device, and signs
 * nobody in.
 */

import { useEffect, useState } from "react";
import { Loader2, MailCheck } from "lucide-react";
import { AuthShell, AuthSubmit, authErrorText } from "./AuthShell";
import { completeEmailChange } from "../../api/authLinks";

/** One request per token, so a second mount (StrictMode) does not spend it. */
const requests = new Map<string, Promise<{ email: string }>>();

export const ConfirmEmailLanding = ({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) => {
  const [result, setResult] = useState<
    { email: string } | { error: string } | null
  >(null);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setResult({ error: "This link is no longer valid" });
      return;
    }
    let request = requests.get(token);
    if (!request) {
      request = completeEmailChange(token);
      requests.set(token, request);
    }
    request
      .then((done) => {
        if (mounted) setResult(done);
      })
      .catch((err) => {
        if (mounted) {
          setResult({
            error: authErrorText(err, "This link is no longer valid"),
          });
        }
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  if (!result) {
    return (
      <AuthShell
        title="Confirming your email…"
        subtitle="Checking the link from your email"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AuthShell>
    );
  }

  const changed = "email" in result;
  return (
    <AuthShell
      icon={<MailCheck className="w-7 h-7" />}
      title={changed ? "Your email is changed" : "This link is no longer valid"}
      subtitle={
        changed ? `Your account now uses ${result.email}` : result.error
      }
      onSubmit={(event) => {
        event.preventDefault();
        onDone();
      }}
      footer={
        changed
          ? undefined
          : "Email-change links work for 24 hours and once. Change your email again under Account settings"
      }
    >
      <AuthSubmit>Continue</AuthSubmit>
    </AuthShell>
  );
};
