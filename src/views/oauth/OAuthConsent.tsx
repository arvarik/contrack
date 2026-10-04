/**
 * OAuthConsent — where a person approves an app that asked to use their
 * Contrack, such as Claude on the web or an editor.
 *
 * The app sent the browser to `/oauth/authorize`, and the server sent it
 * here with a request id (server/services/oauthService.ts). AuthGate shows
 * the sign-in screen first when nobody is signed in, at this same address,
 * so the request is still here after sign-in.
 *
 * The page says who is asking and where the browser goes after, then offers
 * Read and write or Read only. The answer goes by `fetch`, and the page then
 * moves the browser itself. A form posted to the server would be stopped by
 * the CSP's `form-action 'self'`, which Chrome applies to the redirect too.
 *
 * @module views/oauth/OAuthConsent
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Unlink } from "lucide-react";
import { useAuth } from "../../components/auth/AuthGate";
import {
  AuthError,
  AuthShell,
  AuthSubmit,
} from "../../components/auth/AuthShell";
import { ChoiceGroup, type Choice } from "../../components/ui/ChoiceGroup";
import { decideConsent, fetchConsentRequest } from "../../api/oauth";
import type { OAuthConsentRequest } from "../../../shared/contracts/oauth";

type Access = "read" | "write";

/** Why the link stopped before the consent, by the server's error code. */
const PROBLEMS: Record<string, string> = {
  unknown_client:
    "Contrack does not know the app that sent you here. Go back to the app and connect again",
  bad_redirect:
    "The app asked to send you to an address it did not register, so Contrack stopped here. Go back to the app and connect again",
  client_unavailable:
    "Contrack could not read the app's details. Check that this server can reach the internet, then connect again from the app",
};

/** Where the browser goes after the answer, in words. */
function destination(redirect: OAuthConsentRequest["redirect"]): string {
  if (redirect.kind === "loopback") {
    return `an app on this computer (${redirect.host})`;
  }
  if (redirect.kind === "app") return `the ${redirect.host} app`;
  return redirect.host;
}

/** The page after the answer, while the app takes over. */
const Returning = ({
  request,
  href,
}: {
  request: OAuthConsentRequest;
  href: string;
}) => (
  <AuthShell
    icon={<Check className="w-7 h-7" aria-hidden="true" />}
    title={`Return to ${request.client.name}`}
    subtitle="You can close this tab"
    onSubmit={(e) => e.preventDefault()}
  >
    {request.redirect.kind !== "web" && (
      // An app's own scheme or a local port may need a second press: a
      // browser opens an outside app only after a gesture.
      <a href={href} className="btn-secondary w-full">
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
        Open {request.client.name}
      </a>
    )}
  </AuthShell>
);

export default function OAuthConsent() {
  const { user, signOut } = useAuth();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestId = params.get("request");
  const problem = params.get("error");

  const request = useQuery({
    queryKey: ["oauth", "request", requestId],
    queryFn: () => fetchConsentRequest(requestId!),
    enabled: Boolean(requestId) && !problem,
    retry: false,
    staleTime: Infinity,
  });
  const [access, setAccess] = useState<Access | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  // What the app asked for, until the person picks.
  const chosen: Access = access ?? (request.data?.canWrite ? "write" : "read");

  const decide = useMutation({
    mutationFn: (decision: "allow" | "deny") =>
      decideConsent(requestId!, decision, chosen),
    onSuccess: ({ redirectTo }) => {
      setReturnTo(redirectTo);
      window.location.assign(redirectTo);
    },
  });

  if (problem || !requestId || request.isError) {
    return (
      <AuthShell
        icon={<Unlink className="w-7 h-7" aria-hidden="true" />}
        title="This link does not work"
        subtitle={
          PROBLEMS[problem ?? ""] ??
          "It expired or was already used. Go back to the app and connect again"
        }
        onSubmit={(e) => e.preventDefault()}
      >
        {null}
      </AuthShell>
    );
  }
  if (!request.data) return null;

  const shown = request.data;
  if (returnTo) return <Returning request={shown} href={returnTo} />;

  const options: Choice<Access>[] = [
    {
      value: "write",
      label: "Read and write",
      hint: shown.canWrite
        ? "Search and read, and add or change contacts, notes, follow-ups and lists"
        : "The app asked to read only",
      disabled: !shown.canWrite,
    },
    {
      value: "read",
      label: "Read only",
      hint: "Search and read. It sees no tool that changes anything",
    },
  ];

  return (
    <AuthShell
      title={`Allow ${shown.client.name} to use your Contrack?`}
      subtitle={
        shown.client.verified
          ? `Its details come from ${shown.client.host}`
          : "This app named itself. Contrack cannot check who made it"
      }
      onSubmit={(e) => {
        e.preventDefault();
        decide.mutate("allow");
      }}
      footer="Disconnect it any time in Settings, Account, API tokens"
    >
      <div className="rounded-xl bg-surface-container-highest p-3 space-y-2 text-sm text-on-surface text-pretty">
        <p>
          After you choose, you go back to{" "}
          <strong className="font-semibold">
            {destination(shown.redirect)}
          </strong>
        </p>
        <p className="flex flex-wrap items-center gap-x-2">
          <span>
            Signed in as{" "}
            <strong className="font-semibold">
              {user?.displayName || user?.username}
            </strong>
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-primary font-semibold hover:underline min-h-[44px] inline-flex items-center"
          >
            Use another account
          </button>
        </p>
      </div>

      <ChoiceGroup
        label="Access"
        value={chosen}
        options={options}
        onChange={setAccess}
      />

      {decide.isError && (
        <AuthError>
          {decide.error instanceof Error
            ? decide.error.message
            : "Contrack could not save your answer. Try again"}
        </AuthError>
      )}

      <div className="space-y-3">
        <AuthSubmit busy={decide.isPending}>Allow</AuthSubmit>
        <button
          type="button"
          disabled={decide.isPending}
          onClick={() => decide.mutate("deny")}
          className="btn-secondary w-full"
        >
          Deny
        </button>
      </div>
    </AuthShell>
  );
}
