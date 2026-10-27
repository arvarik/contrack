/** Links and unlinks the account's single sign-on (OIDC) identity. */
import { useEffect, useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Loader2, LogIn, Trash2 } from "lucide-react";
import { useAuth } from "../../../components/auth/AuthGate";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { LoadFailed } from "../../../components/ui/LoadFailed";
import { RailTooltip } from "../../../components/ui/RailTooltip";
import { ICON_BTN, TONE_WASH } from "../../../lib/styles";
import { formatDay } from "../../../lib/datetime";
import { cn, errorText } from "../../../lib/utils";
import { SETTINGS_CARD } from "../layout";
import { passkeysQuery } from "./PasskeysCard";
import { passkeysSupported } from "../../../api/passkeys";
import {
  listIdentities,
  startOidcLink,
  unlinkIdentity,
  type LinkedIdentity,
} from "../../../api/auth";

const identitiesQuery = queryOptions({
  queryKey: ["auth", "identities"],
  queryFn: listIdentities,
});

/** The toast for the address's ?oidc=<outcome> after a link attempt. */
const OUTCOMES: Record<string, [ok: boolean, text: (name: string) => string]> =
  {
    linked: [true, (name) => `${name} linked`],
    taken: [false, () => "That sign-in is already linked to another account"],
    expired: [false, () => "That took too long. Try linking again"],
    denied: [false, () => "Linking was cancelled"],
    failed: [false, () => "Linking did not finish. Try again"],
  };

/** The host of an issuer address, for a provider that is no longer set up. */
function issuerHost(issuer: string): string {
  try {
    return new URL(issuer).host;
  } catch {
    return issuer;
  }
}

export const SingleSignOnCard = () => {
  const { oidc, user } = useAuth();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<LinkedIdentity | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    ...identitiesQuery,
    enabled: Boolean(oidc),
  });
  const { data: passkeyData } = useQuery({
    ...passkeysQuery,
    enabled: Boolean(oidc) && passkeysSupported(),
  });
  // Without passkey support the query never runs, so the card cannot know.
  const others = !passkeysSupported()
    ? "your password and any other sign-in methods"
    : (passkeyData?.passkeys.length ?? 0) > 0
      ? "your password and passkeys"
      : "your password";

  // The callback lands here as ?oidc=<outcome>#password.
  useEffect(() => {
    if (!oidc) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("oidc");
    if (!outcome) return;
    const [ok, text] = OUTCOMES[outcome] ?? OUTCOMES.failed;
    (ok ? toast.success : toast.error)(text(oidc.name));
    url.searchParams.delete("oidc");
    history.replaceState(history.state, "", url);
  }, [oidc]);

  const link = useMutation({
    mutationFn: startOidcLink,
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error: Error) =>
      toast.error(`Could not start linking: ${errorText(error)}`),
  });
  // An identity from a provider that is no longer set up goes by its host.
  const nameOf = (identity: LinkedIdentity) =>
    identity.current ? (oidc?.name ?? "") : issuerHost(identity.issuer);
  const unlink = useMutation({
    mutationFn: (identity: LinkedIdentity) => unlinkIdentity(identity.id),
    onSuccess: (_data, identity) => {
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: identitiesQuery.queryKey });
      toast.success(`${nameOf(identity)} unlinked`);
    },
    onError: (error: Error) =>
      toast.error(`Could not unlink: ${errorText(error)}`),
  });

  if (!oidc) return null;
  const identities = data?.identities ?? [];
  const unlinkLabel = `Unlink ${target ? nameOf(target) : oidc.name}`;
  const canLink =
    !isLoading && !isError && !identities.some((identity) => identity.current);
  const linkButton = (
    <button
      type="button"
      onClick={() => link.mutate()}
      disabled={link.isPending}
      className="btn-secondary btn-sm"
    >
      {link.isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Link2 className="w-3.5 h-3.5" />
      )}
      Link {oidc.name}
    </button>
  );

  return (
    <div className={cn(SETTINGS_CARD, "space-y-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-on-surface break-words">
            Single sign-on
          </h3>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty break-words">
            Sign in with {oidc.name}
          </p>
        </div>
        {canLink && identities.length > 0 && linkButton}
      </div>

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : isError ? (
        <LoadFailed
          what="your linked sign-ins"
          onRetry={() => void refetch()}
          level={3}
        />
      ) : identities.length === 0 ? (
        <EmptyState
          icon={LogIn}
          title="Not linked"
          body="Link it to sign in without your password"
          action={{
            label: link.isPending ? "Opening…" : `Link ${oidc.name}`,
            onClick: () => {
              if (!link.isPending) link.mutate();
            },
            icon: Link2,
          }}
          level={3}
        />
      ) : (
        <ul className="space-y-4">
          {identities.map((identity) => (
            <li
              key={identity.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <span
                  className={cn(
                    "shrink-0 w-9 h-9 rounded-xl flex items-center justify-center mt-0.5",
                    TONE_WASH.primary,
                  )}
                >
                  <LogIn className="w-[18px] h-[18px]" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">
                    {identity.email ?? `${nameOf(identity)} account`}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Linked {formatDay(identity.createdAt)}
                    {!identity.current && ` · ${issuerHost(identity.issuer)}`}
                  </p>
                </div>
              </div>
              <RailTooltip label="Unlink" side="bottom-end">
                <button
                  type="button"
                  onClick={() => setTarget(identity)}
                  className={cn(ICON_BTN, "hover:text-error")}
                  aria-label={`Unlink ${identity.email ?? nameOf(identity)}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </RailTooltip>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => target && unlink.mutate(target)}
        title={unlinkLabel}
        // A sign-in links the account again only with the account's own email.
        description={`You can still sign in with ${others}${data?.matchByEmail && target?.current && target.email?.toLowerCase() === user?.email.toLowerCase() ? `. Email matching is on, so your next ${oidc.name} sign-in can link this account again` : ""}`}
        confirmLabel={unlinkLabel}
        tone="danger"
        busy={unlink.isPending}
      />
    </div>
  );
};
