import React, { useState } from "react";
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
import { TONE_DOT, TONE_WASH, type Tone } from "../../lib/styles";
import { cn } from "../../lib/utils";

/** The compact status: a chip on its tone's wash, a button when it acts. */
const STATUS_CHIP =
  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium";

interface SearchCoverageBarProps {
  /** If true, renders a compact badge/pill suitable for headers */
  compact?: boolean;
  className?: string;
}

export function SearchCoverageBar({
  compact = false,
  className,
}: SearchCoverageBarProps) {
  const { data: coverage, isLoading } = useSearchCoverage();
  const refreshIndex = useRefreshSearchIndex();

  const [showProviderConfirm, setShowProviderConfirm] = useState(false);
  const [showInspectModal, setShowInspectModal] = useState(false);

  if (isLoading || !coverage) return null;

  const isComplete =
    coverage.coverage === 100 &&
    coverage.pending === 0 &&
    coverage.failed === 0;
  /** The banner's tone, on its icon tile and its bar: done, failing, or still to do. */
  const tone: Tone = isComplete
    ? "success"
    : coverage.failed > 0
      ? "error"
      : "primary";

  const handleRefreshClick = () => {
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
        toast.error(e.message || "Failed to refresh search index");
      }
    }
  };

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        {coverage.isIndexing || coverage.pending > 0 ? (
          <button
            onClick={handleRefreshClick}
            disabled={refreshIndex.isPending}
            title={`${coverage.pending} contact(s) pending indexing`}
            className={cn(
              "hit-area state-layer transition-colors",
              STATUS_CHIP,
              TONE_WASH.primary,
            )}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>
              Indexing ({coverage.indexed}/{coverage.total})
            </span>
          </button>
        ) : coverage.failed > 0 ? (
          <button
            onClick={() => setShowInspectModal(true)}
            className={cn(
              "hit-area state-layer transition-colors",
              STATUS_CHIP,
              TONE_WASH.error,
            )}
            title={`${coverage.failed} contact(s) failed indexing — click to inspect`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{coverage.failed} failed</span>
          </button>
        ) : coverage.missing > 0 ? (
          <button
            onClick={handleRefreshClick}
            disabled={refreshIndex.isPending}
            className={cn(
              "hit-area state-layer transition-colors",
              STATUS_CHIP,
              TONE_WASH.warning,
            )}
            title={`${coverage.missing} contact(s) missing search vectors — click to index`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{coverage.coverage}% indexed</span>
          </button>
        ) : (
          <div
            title={`Semantic search coverage: 100% (${coverage.indexed}/${coverage.total} contacts)`}
            className={cn(STATUS_CHIP, "gap-1", TONE_WASH.success)}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>100% indexed</span>
          </div>
        )}

        {/* Confirmation modal for paid provider */}
        <ProviderConfirmModal
          isOpen={showProviderConfirm}
          onClose={() => setShowProviderConfirm(false)}
          onConfirm={() => triggerRefresh(true)}
          isPending={refreshIndex.isPending}
          providerId={coverage.provider.providerId}
          model={coverage.provider.model}
          count={coverage.missing + coverage.pending}
        />

        {/* Inspect modal for failed contacts */}
        <FailedInspectModal
          isOpen={showInspectModal}
          onClose={() => setShowInspectModal(false)}
          failedItems={coverage.failedItems}
          onRetry={handleRefreshClick}
          isRetrying={refreshIndex.isPending}
        />
      </div>
    );
  }

  // Banner / full display
  return (
    <div
      className={cn(
        "rounded-2xl p-4 border transition-colors",
        isComplete
          ? "bg-surface-container-lowest border-outline-variant/30"
          : coverage.failed > 0
            ? "bg-error/5 border-error/20"
            : "bg-surface-container-low border-primary/20",
        className,
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
              <h2 className="text-sm font-bold text-on-surface">
                Semantic search coverage
              </h2>
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
              Inspect {coverage.failed} failed
            </button>
          )}

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
        </div>
      </div>

      {/* Progress bar. It fills, so it takes the slow duration. */}
      <div className="w-full bg-surface-container-highest rounded-full h-1.5 mt-3 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-(--dur-slow)",
            TONE_DOT[tone],
          )}
          style={{ width: `${coverage.coverage}%` }}
        />
      </div>

      {/* Confirmation modal for paid provider */}
      <ProviderConfirmModal
        isOpen={showProviderConfirm}
        onClose={() => setShowProviderConfirm(false)}
        onConfirm={() => triggerRefresh(true)}
        isPending={refreshIndex.isPending}
        providerId={coverage.provider.providerId}
        model={coverage.provider.model}
        count={coverage.missing + coverage.pending}
      />

      {/* Inspect modal for failed contacts */}
      <FailedInspectModal
        isOpen={showInspectModal}
        onClose={() => setShowInspectModal(false)}
        failedItems={coverage.failedItems}
        onRetry={handleRefreshClick}
        isRetrying={refreshIndex.isPending}
      />
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
      title="Confirm provider embeddings refresh"
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
            <p className="font-bold">Paid provider embeddings</p>
            <p>
              Your instance is configured to use{" "}
              <strong className="underline">
                {providerId ?? "external provider"}
              </strong>{" "}
              ({model ?? "provider model"}).
            </p>
            <p>
              Refreshing will generate embeddings for{" "}
              <strong>{count > 0 ? count : "all missing"}</strong> contact(s),
              which may consume API quota or incur usage costs with your
              provider.
            </p>
          </div>
        </div>

        <p className="text-xs text-on-surface-variant">
          Contrack keeps paid provider indexing explicit so you never incur
          unexpected API costs after editing contacts.
        </p>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-outline-variant/20">
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
            <span>Confirm & refresh</span>
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
      title="Failed search indexing tasks"
      size="lg"
    >
      <div className="space-y-4 pt-2">
        <p className="text-xs text-on-surface-variant">
          The following contacts encountered errors while generating semantic
          search embeddings. They have exceeded the maximum retry attempts and
          require inspection.
        </p>

        {failedItems.length === 0 ? (
          <div className="p-6 text-center text-xs text-on-surface-variant bg-surface-container-low rounded-xl">
            No failed tasks to inspect.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {failedItems.map((item) => (
              <div
                key={item.contactId}
                className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/20 space-y-1 text-xs"
              >
                <div className="flex items-center justify-between font-bold text-on-surface">
                  <span>{item.name}</span>
                  <span
                    className={cn(
                      TONE_WASH.error,
                      "text-[11px] font-mono px-2 py-0.5 rounded-md",
                    )}
                  >
                    {item.attempts} attempts
                  </span>
                </div>
                <p className="text-error font-mono text-[11px] break-words">
                  {item.error}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-outline-variant/20">
          <p className="text-[11px] text-on-surface-variant">
            Clicking Retry will re-enqueue these contacts for indexing.
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
              <span>Retry all failed</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
