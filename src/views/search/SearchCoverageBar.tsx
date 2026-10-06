/**
 * SearchCoverageBar: how much of the network search by meaning can read.
 *
 * Two looks, for two places:
 *
 *   - `card` (the default), under the embedding model on Administration →
 *     AI: the coverage, its numbers and its actions as buttons, with a
 *     progress bar under them.
 *   - `row`, under the Ask Contrack search box: one slim line with a short
 *     bar, the count in words and quiet text buttons. It is only there while
 *     there is something to say, so a network that is fully indexed shows
 *     nothing and the search keeps the page.
 *
 * Both reach the same two dialogs: the confirmation before a paid provider
 * embeds anything, and the list of the contacts that failed.
 */
import { type RefObject, useCallback, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useSearchCoverage,
  useRefreshSearchIndex,
  type FailedIndexItem,
} from "../../api";
import { Modal } from "../../components/ui/Modal";
import { useAiAllowed } from "../../hooks/useAiAllowed";
import { BTN_QUIET, TONE_DOT, TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

interface SearchCoverageBarProps {
  /** `card` on a settings page, `row` under a search box. */
  variant?: "card" | "row";
  /**
   * Where the keyboard goes when the row leaves with focus inside it: the
   * search box. Indexing that ends after a press hides the row, and focus on
   * its button would fall onto the body.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * The share of contacts indexed, as a bar. Decorative: the words beside it
 * say the same number. It fills, so it takes the slow duration.
 */
const CoverageMeter = ({
  value,
  tone,
  className,
}: {
  value: number;
  tone: Tone;
  className?: string;
}) => (
  <div
    aria-hidden="true"
    className={cn(
      "bg-surface-container-highest rounded-full overflow-hidden",
      className,
    )}
  >
    <div
      className={cn(
        "h-full rounded-full transition-[width] duration-(--dur-slow)",
        TONE_DOT[tone],
      )}
      style={{ width: `${value}%` }}
    />
  </div>
);

export function SearchCoverageBar({
  variant = "card",
  returnFocusRef,
}: SearchCoverageBarProps) {
  const { data: coverage, isLoading } = useSearchCoverage();
  const refreshIndex = useRefreshSearchIndex();
  const aiAllowed = useAiAllowed();

  const [showProviderConfirm, setShowProviderConfirm] = useState(false);
  const [showInspectModal, setShowInspectModal] = useState(false);
  // Whether a person pressed Index missing or Retry failed, so the row keeps
  // that button until the work is done. It resets once nothing is missing
  // or failed.
  const [queuePressed, setQueuePressed] = useState(false);
  // React detaches a ref before it removes the node, so the cleanup still
  // finds focus inside the row and can hand it on while the row is there.
  const keepFocus = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      return () => {
        if (node.contains(document.activeElement)) {
          returnFocusRef?.current?.focus();
        }
      };
    },
    [returnFocusRef],
  );
  const workLeft = !!coverage && (coverage.missing > 0 || coverage.failed > 0);
  if (queuePressed && coverage && !workLeft) setQueuePressed(false);

  if (isLoading || !coverage) return null;

  // A hosted embedding model sends each contact to the provider, so it does
  // not index an account with AI off, and the server refuses to queue one.
  // Search stays keyword-only, and there is nothing to offer here.
  const providerBlocked = coverage.provider.isPaid && !aiAllowed;

  const isComplete =
    coverage.coverage === 100 &&
    coverage.pending === 0 &&
    coverage.failed === 0;
  /** The bar's tone, and the card's icon tile: done, failing, or still to do. */
  const tone: Tone = isComplete
    ? "success"
    : coverage.failed > 0
      ? "error"
      : "primary";

  const handleRefreshClick = () => {
    setQueuePressed(true);
    if (coverage.provider.isPaid) {
      setShowProviderConfirm(true);
      return;
    }
    triggerRefresh(false);
  };

  const triggerRefresh = async (allowProvider: boolean) => {
    try {
      const res = await refreshIndex.mutateAsync({ allowProvider });
      toast.success(res.message || "Indexing started");
      setShowProviderConfirm(false);
    } catch (err: unknown) {
      const e = err as Error & {
        data?: { requiresExplicitConfirmation?: boolean };
      };
      if (e.data?.requiresExplicitConfirmation) {
        setShowProviderConfirm(true);
      } else {
        toast.error(e.message || "Could not update the search index");
      }
    }
  };

  // Mounted whatever the row shows, so a dialog that is open stays open when
  // the numbers under it change.
  const dialogs = (
    <>
      <ProviderConfirmModal
        isOpen={showProviderConfirm}
        onClose={() => setShowProviderConfirm(false)}
        onConfirm={() => triggerRefresh(true)}
        isPending={refreshIndex.isPending}
        providerId={coverage.provider.providerId}
        model={coverage.provider.model}
        count={coverage.missing + coverage.pending}
      />
      <FailedInspectModal
        isOpen={showInspectModal}
        onClose={() => setShowInspectModal(false)}
        failedItems={coverage.failedItems}
        onRetry={handleRefreshClick}
        isRetrying={refreshIndex.isPending}
      />
    </>
  );

  if (variant === "row") {
    if (providerBlocked) return null;
    /*
     * Indexing is under way: the worker is running, or contacts wait for the
     * built-in model, which drains its queue on its own between batches. A
     * paid provider's queue waits until a person allows it, so it is not
     * running: while contacts are missing, the row offers the action that
     * asks, and the changed contacts it would embed again are a settings
     * matter, as they always were.
     */
    const running =
      coverage.isIndexing ||
      (coverage.pending > 0 && !coverage.provider.isPaid);
    const hasNews = running || coverage.missing > 0 || coverage.failed > 0;
    // One endpoint queues the missing contacts and the failed ones together,
    // so there is one action, named for the failures when there are some.
    // Once pressed it stays on the row until the work is done, marked
    // unavailable with `aria-disabled` while the queue runs: a pressed button
    // that left the page, or turned `disabled`, would drop the keyboard's
    // focus onto the body.
    const hasWork = coverage.missing > 0 || coverage.failed > 0;
    const canQueue = !running && hasWork;
    const showQueue = canQueue || (queuePressed && hasWork);
    const queueUnavailable = running || refreshIndex.isPending;
    // Every contact counted and the worker busy: it is embedding contacts
    // that changed, and "30 of 30" would read as stuck.
    const words = running
      ? coverage.missing > 0
        ? `Indexing ${coverage.indexed} of ${coverage.total}…`
        : "Updating the search index…"
      : `${coverage.indexed} of ${coverage.total} contacts indexed`;

    return (
      <>
        {hasNews && (
          <section
            ref={keepFocus}
            aria-label="Search by meaning coverage"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant"
          >
            <div className="flex items-center gap-2 min-w-0">
              <CoverageMeter
                value={coverage.coverage}
                tone={tone}
                className="w-16 h-1 shrink-0"
              />
              <p>
                {words}
                {coverage.failed > 0 && (
                  <span className="text-error">
                    {" "}
                    · {coverage.failed} failed
                  </span>
                )}
              </p>
            </div>
            {/* The negative margin sets the last word flush with the search
                box's right edge, past the button's own padding. */}
            {(coverage.failed > 0 || showQueue) && (
              <div className="flex items-center gap-1 ml-auto -mr-2">
                {coverage.failed > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowInspectModal(true)}
                    className={BTN_QUIET}
                  >
                    Show failed
                  </button>
                )}
                {showQueue && (
                  <button
                    type="button"
                    onClick={queueUnavailable ? undefined : handleRefreshClick}
                    aria-disabled={queueUnavailable || undefined}
                    className={cn(
                      BTN_QUIET,
                      "aria-disabled:opacity-50 aria-disabled:cursor-not-allowed",
                    )}
                  >
                    {coverage.failed > 0 ? "Retry failed" : "Index missing"}
                  </button>
                )}
              </div>
            )}
          </section>
        )}
        {dialogs}
      </>
    );
  }

  return (
    <div
      className={cn(
        "rounded-2xl p-4 border transition-colors",
        isComplete
          ? "bg-surface-container-lowest border-outline-variant/30"
          : coverage.failed > 0
            ? "bg-error/5 border-error/20"
            : "bg-surface-container-low border-primary/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
              TONE_WASH[tone],
            )}
          >
            {coverage.isIndexing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : isComplete ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : coverage.failed > 0 ? (
              <AlertCircle className="w-5 h-5" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-on-surface">
                Search by meaning
              </h3>
              <span
                className={cn(
                  "text-xs font-semibold px-2 py-0.5 rounded-md",
                  TONE_WASH[isComplete ? "success" : "primary"],
                )}
              >
                {coverage.coverage}%
              </span>
            </div>
            <p className="text-xs text-on-surface-variant truncate">
              {coverage.indexed} of {coverage.total} contacts indexed
              {coverage.pending > 0 && ` • ${coverage.pending} indexing`}
              {coverage.failed > 0 && ` • ${coverage.failed} failed`}
              {coverage.provider.isPaid &&
                ` • Provider: ${coverage.provider.providerId}`}
              {providerBlocked && " • AI is off for your account"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {coverage.failed > 0 && (
            <button
              type="button"
              onClick={() => setShowInspectModal(true)}
              className="btn-secondary"
            >
              Show {coverage.failed} failed
            </button>
          )}

          {!providerBlocked && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={refreshIndex.isPending || coverage.isIndexing}
              className="btn-primary"
            >
              <RefreshCw
                className={cn(
                  "w-3.5 h-3.5",
                  (refreshIndex.isPending || coverage.isIndexing) &&
                    "animate-spin",
                )}
              />
              <span>
                {coverage.missing > 0 ? "Index missing" : "Refresh index"}
              </span>
            </button>
          )}
        </div>
      </div>

      <CoverageMeter
        value={coverage.coverage}
        tone={tone}
        className="w-full h-1.5 mt-3"
      />

      {dialogs}
    </div>
  );
}

function ProviderConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  providerId,
  model,
  count,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  providerId?: string | null;
  model?: string | null;
  count: number;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Update the search index"
      size="md"
    >
      <div className="space-y-4 pt-2">
        <div
          className={cn(
            TONE_WASH.warning,
            "p-3 rounded-xl flex items-start gap-2.5",
          )}
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-bold">This uses a paid provider</p>
            <p>
              Search reads your contacts through{" "}
              <strong>{providerId ?? "an outside provider"}</strong>
              {model && ` (${model})`}. An update sends{" "}
              <strong>
                {count > 0
                  ? `${count} ${count === 1 ? "contact" : "contacts"}`
                  : "every contact not in the index yet"}
              </strong>{" "}
              to it, and the provider may charge for that
            </p>
          </div>
        </div>

        <p className="text-xs text-on-surface-variant">
          Contrack asks before it uses a paid provider, so an edit to a contact
          never costs money without your say
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="btn-primary"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Update the index</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}

function FailedInspectModal({
  isOpen,
  onClose,
  failedItems,
  onRetry,
  isRetrying,
}: {
  isOpen: boolean;
  onClose: () => void;
  failedItems: FailedIndexItem[];
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Contacts not in the search index"
      size="lg"
    >
      <div className="space-y-4 pt-2">
        <p className="text-xs text-on-surface-variant">
          Search tried to index these contacts several times, and each try
          failed. The error says why. Fix the contact or the provider, then try
          again
        </p>

        {failedItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-xl">
            No contact failed
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {failedItems.map((item) => (
              <div
                key={item.contactId}
                className="p-3 bg-surface-container-low rounded-xl space-y-1 text-xs"
              >
                <div className="flex items-center justify-between font-bold text-on-surface">
                  <span>{item.name}</span>
                  <span
                    className={cn(
                      TONE_WASH.error,
                      "text-[11px] font-mono px-2 py-0.5 rounded-md",
                    )}
                  >
                    {item.attempts} {item.attempts === 1 ? "try" : "tries"}
                  </span>
                </div>
                <p className="text-error font-mono text-[11px] break-words">
                  {item.error}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <p className="text-[11px] text-on-surface-variant">
            Try again puts these contacts back in line for the index
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                onRetry();
                onClose();
              }}
              disabled={isRetrying || failedItems.length === 0}
              className="btn-primary"
            >
              {isRetrying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Try again</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
