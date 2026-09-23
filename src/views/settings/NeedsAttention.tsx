/**
 * NeedsAttention — Landing page strip highlighting items requiring user attention.
 *
 * Displays up to three action links:
 * - "Review N possible duplicates" -> /settings/duplicates
 * - "Enrich N contacts" -> /settings/enrichment
 * - "Retry N failed imports" in the last 30 days -> /settings/import
 *
 * Completely omitted when all three counts are zero.
 *
 * Each item is a tile that opens one page as a whole, so it lifts on hover
 * (`lift`, "Elevation" in `.agent/STYLE.md`) and takes the hover layer on
 * its face. The rail's count pills read the same numbers from
 * `useAttentionCounts`.
 *
 * @module views/settings/NeedsAttention
 */
import React, { useMemo } from "react";
import { ChevronRight, Copy, Sparkles, UploadCloud } from "lucide-react";
import { useDedupeCount, useContacts } from "../../api";
import { useImports } from "../../api/imports";
import { TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { SETTINGS_SECTION_HEADING } from "./layout";
import { SlideLink } from "./slide";

/** Failed imports count for this long. */
const FAILED_IMPORT_WINDOW_MS = 30 * 86_400_000;

/**
 * The three things Settings can ask a person to do: possible duplicates to
 * review, contacts never enriched, and imports that failed in the last 30
 * days. The landing strip and the rail's count pills share them.
 */
export function useAttentionCounts() {
  const { data: dedupeData } = useDedupeCount();
  const { data: contacts = [] } = useContacts();
  const { data: imports = [] } = useImports();

  const duplicates =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);

  const neverEnriched = useMemo(
    () =>
      contacts.filter((c) => !c.aiHydratedAt && !c.isArchived && !c.isGhost)
        .length,
    [contacts],
  );

  const failedImports = useMemo(() => {
    const since = Date.now() - FAILED_IMPORT_WINDOW_MS;
    return imports.filter(
      (imp) =>
        new Date(imp.createdAt).getTime() >= since &&
        (imp.status === "failed" || imp.failed > 0),
    ).length;
  }, [imports]);

  return { duplicates, neverEnriched, failedImports };
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export const NeedsAttention = () => {
  const { duplicates, neverEnriched, failedImports } = useAttentionCounts();

  const items: {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [];

  if (duplicates > 0) {
    items.push({
      path: "/settings/duplicates",
      label: `Review ${plural(duplicates, "possible duplicate", "possible duplicates")}`,
      icon: Copy,
    });
  }

  if (neverEnriched > 0) {
    items.push({
      path: "/settings/enrichment",
      label: `Enrich ${plural(neverEnriched, "contact", "contacts")}`,
      icon: Sparkles,
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
              <span className="font-semibold text-sm truncate flex-1">
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

export default NeedsAttention;
