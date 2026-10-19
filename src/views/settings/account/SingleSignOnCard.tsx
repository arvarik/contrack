/** Links and unlinks the account's single sign-on (OIDC) identity. */
import { useEffect, useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { Fingerprint, Link2, Loader2, Trash2 } from "lucide-react";
import { useAuth } from "../../../components/auth/AuthGate";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { LoadFailed } from "../../../components/ui/LoadFailed";
import { RailTooltip } from "../../../components/ui/RailTooltip";
import { ICON_BTN, TONE_WASH } from "../../../lib/styles";
import { cn, errorText } from "../../../lib/utils";
import { SETTINGS_CARD } from "../layout";
import {
  listIdentities,
  startOidcLink,
  unlinkIdentity,
  type LinkedIdentity,
} from "../../../api/auth";

export const identitiesQuery = queryOptions({
  queryKey: ["auth", "identities"],
  queryFn: listIdentities,
  staleTime: 30_000,
});

/** The toast for the address's ?oidc=<outcome> after a link attempt. */
export const OUTCOMES: Record<
  string,
  [ok: boolean, text: (name: string) => string]
> = {
  linked: [true, (name) => `${name} linked`],
  taken: [false, () => "That sign-in is already linked to another account"],
  expired: [false, () => "That took too long. Try linking again"],
  denied: [false, () => "Linking was cancelled"],
  failed: [false, () => "Linking did not finish. Try again"],
};

/** A SQLite timestamp as a local date. */
function formatDay(iso: string): string {
  const date = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? "Unknown"
    : date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export const SingleSignOnCard = () => {
  const { oidc } = useAuth();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<LinkedIdentity | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    ...identitiesQuery,
    enabled: Boolean(oidc),
  });

  // The callback lands here as ?oidc=<outcome>#password.
  useEffect(() => {
    if (!oidc) return;
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("oidc");
    if (!outcome) return;
    const [ok, text] = OUTCOMES[outcome] ?? OUTCOMES.failed;
    (ok ? toast.success : toast.error)(text(oidc.name));
    url.searchParams.delete("oidc");
    history.replaceState(null, "", url);
  }, [oidc]);

  const link = useMutation({
    mutationFn: startOidcLink,
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error: Error) =>
      toast.error(`Could not start linking: ${errorText(error)}`),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => unlinkIdentity(id),
    onSuccess: () => {
      setTarget(null);
      queryClient.invalidateQueries({ queryKey: ["auth", "identities"] });
      toast.success(`${oidc?.name} unlinked`);
    },
    onError: (error: Error) =>
      toast.error(`Could not unlink: ${errorText(error)}`),
  });

  if (!oidc) return null;
  const identities = data?.identities ?? [];

  return (
    <div className={cn(SETTINGS_CARD, "space-y-4")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-on-surface">Single sign-on</h3>
          <p className="text-xs sm:text-sm text-on-surface-variant text-pretty">
            Sign in with {oidc.name}
          </p>
        </div>
        {!isLoading && !isError && identities.length === 0 && (
          <button
            type="button"
            onClick={() => link.mutate()}
            disabled={link.isPending}
            className="btn-secondary btn-sm shrink-0"
          >
            {link.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Link2 className="w-3.5 h-3.5" />
            )}
            Link {oidc.name}
          </button>
        )}
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
        <p className="text-sm text-on-surface-variant text-pretty">
          Not linked. Link it to sign in without your password
        </p>
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
                  <Fingerprint className="w-[18px] h-[18px]" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-on-surface truncate">
                    {identity.email ?? `${oidc.name} account`}
                  </p>
                  <p className="text-xs text-on-surface-variant">
                    Linked {formatDay(identity.createdAt)}
                  </p>
                </div>
              </div>
              <RailTooltip label="Unlink" side="bottom-end">
                <button
                  type="button"
                  onClick={() => setTarget(identity)}
                  className={cn(ICON_BTN, "hover:text-error")}
                  aria-label={`Unlink ${identity.email ?? oidc.name}`}
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
        onConfirm={() => target && unlink.mutate(target.id)}
        title={`Unlink ${oidc.name}`}
        description="You can still sign in with your password and passkeys"
        confirmLabel={`Unlink ${oidc.name}`}
        tone="danger"
        busy={unlink.isPending}
      />
    </div>
  );
};
