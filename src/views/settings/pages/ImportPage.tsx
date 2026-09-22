/**
 * ImportPage — Settings workbench for importing contacts and reviewing past imports.
 *
 * Renders ImportPanel inline and displays a history of recent imports with status,
 * counts, timestamp, and retry capabilities.
 *
 * @module views/settings/pages/ImportPage
 */
import React, { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCw,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ImportPanel } from "../../../components/ImportPanel";
import { EmptyState } from "../../../components/ui/EmptyState";
import {
  useImports,
  retryImport,
  type ImportRecord,
  type ImportStatus,
} from "../../../api/imports";
import { formatRelative, formatWhen } from "../../../lib/datetime";
import {
  CARD,
  SECTION_HEADING,
  TONE_WASH,
  type Tone,
} from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { SETTINGS_PAGE } from "../layout";

const statusBadges: Record<
  ImportStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: Tone;
  }
> = {
  complete: { label: "Complete", icon: CheckCircle2, tone: "success" },
  failed: { label: "Failed", icon: AlertCircle, tone: "error" },
  running: { label: "Running", icon: Loader2, tone: "primary" },
  imported: { label: "Checking", icon: Clock, tone: "warning" },
};

export const ImportPage = () => {
  const { data: imports = [], isLoading } = useImports();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleRetry = async (id: string) => {
    if (retryingId) return;
    setRetryingId(id);
    try {
      const result = await retryImport(id);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["imports"] }),
        queryClient.invalidateQueries({ queryKey: ["contacts"] }),
      ]);
      toast(
        `Retried import: ${result.imported} imported, ${result.failed} failed`,
      );
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className={cn(SETTINGS_PAGE, "space-y-8")}>
      <div className="space-y-1">
        <p className="text-sm text-on-surface-variant">
          Bring in contacts from vCard, CSV, Google, LinkedIn or Apple.
        </p>
      </div>

      <div className={cn(CARD, "p-4 sm:p-6")}>
        <ImportPanel />
      </div>

      {/* Recent imports */}
      <section className="space-y-3" aria-label="Recent imports">
        <h2 className={SECTION_HEADING}>Recent imports</h2>

        {isLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : imports.length === 0 ? (
          <EmptyState
            icon={UploadCloud}
            title="No recent imports"
            body="Files you import will show up here with their status, counts, and retry options."
          />
        ) : (
          <div className="space-y-3">
            {imports.map((item: ImportRecord) => {
              const badge = statusBadges[item.status] ?? statusBadges.complete;
              const Icon = badge.icon;
              const canRetry = item.status === "failed" || item.failed > 0;
              const isRetrying = retryingId === item.id;

              return (
                <div
                  key={item.id}
                  className={cn(
                    CARD,
                    "p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4",
                  )}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold",
                          TONE_WASH[badge.tone],
                        )}
                      >
                        <Icon
                          className={cn(
                            "w-3 h-3 shrink-0",
                            item.status === "running" && "animate-spin",
                          )}
                        />
                        {badge.label}
                      </span>
                      <span
                        className="text-xs text-on-surface-variant"
                        title={formatWhen(item.createdAt)}
                      >
                        {formatRelative(item.createdAt)}
                      </span>
                    </div>

                    <div className="text-sm font-medium text-on-surface flex items-center gap-2 flex-wrap">
                      <span>{item.imported} imported</span>
                      {item.failed > 0 && (
                        <span className="text-error font-bold">
                          · {item.failed} failed
                        </span>
                      )}
                      {item.summary?.autoMerged !== undefined &&
                        item.summary.autoMerged > 0 && (
                          <span className="text-on-surface-variant text-xs">
                            · {item.summary.autoMerged} merged
                          </span>
                        )}
                      {item.summary?.needsReview !== undefined &&
                        item.summary.needsReview > 0 && (
                          <span className="text-warning text-xs font-bold">
                            · {item.summary.needsReview} need review
                          </span>
                        )}
                    </div>

                    {item.error && (
                      <p className="text-xs text-error">{item.error}</p>
                    )}
                  </div>

                  {canRetry && (
                    <div className="shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRetry(item.id)}
                        disabled={isRetrying}
                        className="btn-secondary btn-sm"
                      >
                        <RotateCw
                          className={cn(
                            "w-3.5 h-3.5",
                            isRetrying && "animate-spin",
                          )}
                        />
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default ImportPage;
