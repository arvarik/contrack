/**
 * The landing strip of possible duplicates and failed imports, hidden when
 * both are zero. Contacts never enriched are listed on the Contact
 * enrichment page instead.
 */
import React, { useMemo } from "react";
import { ChevronRight, Copy, UploadCloud } from "lucide-react";
import { useDedupeCount } from "../../api";
import { useImports } from "../../api/imports";
import { TONE_WASH } from "../../lib/styles";
import { cn, plural } from "../../lib/utils";
import { SETTINGS_SECTION_HEADING } from "./layout";
import { SlideLink } from "./slide";

const FAILED_IMPORT_WINDOW_MS = 30 * 86_400_000;

/** Shared by the landing strip and the rail's count pills. */
export function useAttentionCounts() {
  const { data: dedupeData } = useDedupeCount();
  const { data: imports = [] } = useImports();

  const duplicates =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);

  const failedImports = useMemo(() => {
    const since = Date.now() - FAILED_IMPORT_WINDOW_MS;
    return imports.filter(
      (imp) =>
        new Date(imp.createdAt).getTime() >= since &&
        (imp.status === "failed" || imp.failed > 0),
    ).length;
  }, [imports]);

  return { duplicates, failedImports };
}

export const NeedsAttention = () => {
  const { duplicates, failedImports } = useAttentionCounts();

  const items: {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [];

  if (duplicates > 0) {
    items.push({
      path: "/pulse/duplicates",
      label: `Review ${plural(duplicates, "possible duplicate", "possible duplicates")}`,
      icon: Copy,
    });
  }

  if (failedImports > 0) {
    items.push({
      path: "/settings/import",
      label: `Retry ${plural(failedImports, "failed import", "failed imports")}`,
      icon: UploadCloud,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-label="Needs attention">
      <h2 className={SETTINGS_SECTION_HEADING}>Needs attention</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <SlideLink
              key={item.path}
              to={item.path}
              className="lift state-layer flex items-center gap-3 p-3.5 rounded-xl bg-primary/10 text-on-surface min-h-[44px]"
            >
              <span
                className={cn("p-2 rounded-lg shrink-0", TONE_WASH.primary)}
              >
                <Icon className="w-4 h-4" />
              </span>
              {/* Wraps rather than cuts: the count is the point of the tile. */}
              <span className="font-semibold text-sm text-pretty min-w-0 flex-1">
                {item.label}
              </span>
              <ChevronRight className="w-4 h-4 text-primary shrink-0" />
            </SlideLink>
          );
        })}
      </div>
    </section>
  );
};
