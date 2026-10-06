/**
 * DupeBanner — a possible duplicate of the contact on this page.
 *
 * ```
 * ⧉ Ada Quill may be the same person as A. Quill     [ Compare ] [ Keep separate ]
 *   ✉ Same email address
 *   ⚠ First names differ: Ada and Ben
 * ```
 *
 * The same words as Possible duplicates: the reason, and the caveat on the
 * banner itself. Compare opens the review list's comparison, where the
 * contact to keep is chosen, with this page's contact chosen first. A merge
 * that keeps the other contact goes to its page, because this one is gone.
 * Each decision says what it did, with Undo.
 */
import { useState } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, GitMerge, Loader2, X } from "lucide-react";
import {
  undoMerges,
  useDismissSuggestion,
  useMergeCluster,
  useRestoreSuggestion,
  useSuggestionForContact,
} from "../../../api";
import { cn } from "../../../lib/utils";
import { TONE_WASH } from "../../../lib/styles";
import { withUndo } from "../../../lib/undoToast";
import { DuplicateComparison } from "../../dedupe/components/DuplicateComparison";
import {
  isAiReason,
  pairCaveats,
  plainReason,
  reasonIcon,
} from "../../dedupe/utils/reason";
import type { PersistedDedupeSuggestion } from "../../../types";

interface DupeBannerProps {
  contactId: string;
}

const errorText = (err: unknown) =>
  err instanceof Error ? err.message.replace(/\.$/, "") : String(err);

export const DupeBanner = ({ contactId }: DupeBannerProps) => {
  const { data: suggestion, isLoading } = useSuggestionForContact(contactId);
  if (isLoading || !suggestion) return null;
  // One banner per pair: a new pair for this contact starts closed.
  return (
    <Banner key={suggestion.id} contactId={contactId} suggestion={suggestion} />
  );
};

function Banner({
  contactId,
  suggestion,
}: {
  contactId: string;
  suggestion: PersistedDedupeSuggestion;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const dismiss = useDismissSuggestion();
  const restore = useRestoreSuggestion();
  const merge = useMergeCluster();
  const [open, setOpen] = useState(false);
  const [keeperId, setKeeperId] = useState(contactId);

  const here =
    suggestion.contactIdA === contactId
      ? suggestion.contactA
      : suggestion.contactB;
  const other =
    suggestion.contactIdA === contactId
      ? suggestion.contactB
      : suggestion.contactA;
  if (!here || !other) return null;

  const caveats = pairCaveats(suggestion.caveat, suggestion.reasoning);
  const Icon = reasonIcon(suggestion.matchType);
  const ai = isAiReason(suggestion.matchType);
  const busy = dismiss.isPending || merge.isPending;
  const caveatId = `dupe-caveat-${suggestion.id}`;

  /** A contact's page, on the map or in the network, as this page is. */
  const pageOf = (id: string) =>
    location.pathname.startsWith("/map/contact/")
      ? `/map/contact/${id}`
      : `/contact/${id}`;

  const handleKeepSeparate = async () => {
    try {
      await dismiss.mutateAsync(suggestion.id);
      toast(`Kept ${here.name} and ${other.name} separate`, {
        description: "Contrack will not suggest them again",
        ...withUndo(() => {
          void restore
            .mutateAsync(suggestion.id)
            .catch((err) => toast.error(`Could not undo: ${errorText(err)}`));
        }),
      });
    } catch (err) {
      toast.error(`Could not keep them separate: ${errorText(err)}`);
    }
  };

  const handleMerge = async () => {
    const keeper = keeperId === here.id ? here : other;
    const gone = keeper.id === here.id ? other : here;
    try {
      const result = await merge.mutateAsync({
        primaryId: keeper.id,
        duplicateIds: [gone.id],
      });
      if (result.merged === 0) {
        toast.error("Nothing was merged");
        return;
      }
      toast.success(
        `Merged ${gone.name} into ${keeper.name}`,
        withUndo(() => {
          void undoMerges(qc, result.mergeLogIds, false)
            .then(() => {
              if (gone.id === contactId) {
                navigate(pageOf(contactId), { replace: true });
              }
            })
            .catch((err) => toast.error(`Could not undo: ${errorText(err)}`));
        }),
      );
      // This page's contact merged into the other: its page is the other's now.
      if (gone.id === contactId) navigate(pageOf(keeper.id), { replace: true });
    } catch (err) {
      toast.error(`Could not merge: ${errorText(err)}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 md:px-8 lg:px-10 mt-2 mb-4">
      <div className="rounded-2xl bg-surface-container-low p-3 sm:p-4 space-y-3">
        {/* Wraps on a phone: two buttons beside the sentence would leave it
            a word per line, so they drop under it. */}
        <div className="flex flex-wrap items-start gap-3">
          <span className={cn("p-2 rounded-lg shrink-0", TONE_WASH.warning)}>
            <Copy aria-hidden="true" className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-[12rem] space-y-1">
            <p className="text-sm text-on-surface text-pretty">
              <span className="font-bold">{here.name}</span> may be the same
              person as <span className="font-bold">{other.name}</span>
            </p>
            <p
              className={cn(
                "flex items-start gap-1.5 text-sm",
                ai ? "text-on-surface" : "text-on-surface-variant",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", ai && "text-ai")}
              />
              <span className="line-clamp-2">
                {plainReason(suggestion.matchType, suggestion.reasoning)}
              </span>
            </p>
            {caveats.length > 0 && (
              <div id={caveatId} className="space-y-0.5">
                {caveats.map((caveat) => (
                  <p
                    key={caveat}
                    className="flex items-start gap-1.5 text-sm font-semibold text-warning"
                  >
                    <AlertTriangle
                      aria-hidden="true"
                      className="w-3.5 h-3.5 mt-0.5 shrink-0"
                    />
                    {caveat}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 max-sm:w-full">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="btn-secondary btn-sm max-sm:flex-1"
            >
              {open ? "Close" : "Compare"}
            </button>
            {!open && (
              <button
                type="button"
                onClick={() => void handleKeepSeparate()}
                disabled={busy}
                className="btn-secondary btn-sm max-sm:flex-1"
              >
                <X aria-hidden="true" className="w-3.5 h-3.5" />
                Keep separate
              </button>
            )}
          </div>
        </div>

        {open && (
          <div className="space-y-3 pt-1">
            <DuplicateComparison
              contacts={[here, other]}
              keeperId={keeperId}
              onKeeperChange={setKeeperId}
              caveats={caveats}
              caveatsAbove
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleKeepSeparate()}
                disabled={busy}
                className="btn-secondary max-sm:flex-1"
              >
                <X aria-hidden="true" className="w-4 h-4" />
                Keep separate
              </button>
              <button
                type="button"
                onClick={() => void handleMerge()}
                disabled={busy}
                aria-describedby={caveats.length > 0 ? caveatId : undefined}
                className="btn-primary max-sm:flex-1"
              >
                {merge.isPending ? (
                  <Loader2
                    aria-hidden="true"
                    className="w-4 h-4 animate-spin"
                  />
                ) : (
                  <GitMerge aria-hidden="true" className="w-4 h-4" />
                )}
                Merge
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
