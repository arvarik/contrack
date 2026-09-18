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
 * @module views/settings/NeedsAttention
 */
import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Copy, Sparkles, UploadCloud } from "lucide-react";
import { useDedupeCount, useContacts } from "../../api";
import { useImports } from "../../api/imports";
import { SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";

export const NeedsAttention = () => {
  const { data: dedupeData } = useDedupeCount();
  const dedupeCount =
    typeof dedupeData === "number" ? dedupeData : (dedupeData?.count ?? 0);
  const { data: contacts = [] } = useContacts();
  const { data: imports = [] } = useImports();

  const thirtyDaysAgo = Date.now() - 30 * 86400 * 1000;
  const failedImportCount = imports.filter(
    (imp) =>
      new Date(imp.createdAt).getTime() >= thirtyDaysAgo &&
      (imp.status === "failed" || imp.failed > 0),
  ).length;

  const neverEnrichedCount = contacts.filter(
    (c) => !c.aiHydratedAt && !c.isArchived && !c.isGhost,
  ).length;

  const items: {
    path: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [];

  if (dedupeCount > 0) {
    items.push({
      path: "/settings/duplicates",
      label: `Review ${dedupeCount} possible duplicate${dedupeCount === 1 ? "" : "s"}`,
      icon: Copy,
    });
  }

  if (neverEnrichedCount > 0) {
    items.push({
      path: "/settings/enrichment",
      label: `Enrich ${neverEnrichedCount} contact${neverEnrichedCount === 1 ? "" : "s"}`,
      icon: Sparkles,
    });
  }

  if (failedImportCount > 0) {
    items.push({
      path: "/settings/import",
      label: `Retry ${failedImportCount} failed import${failedImportCount === 1 ? "" : "s"}`,
      icon: UploadCloud,
    });
  }

  if (items.length === 0) {
    return null;
  }

  return (
    <section aria-label="Needs attention" className="space-y-2.5">
      <h2 className={cn(SECTION_HEADING, "px-1")}>Needs attention</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 p-3.5 rounded-xl bg-primary/10 hover:bg-primary/15 text-on-surface transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[44px]",
              )}
            >
              <span className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                <Icon className="w-4 h-4" />
              </span>
              <span className="font-semibold text-sm truncate flex-1">
                {item.label}
              </span>
              <ChevronRight className="w-4 h-4 text-primary shrink-0" />
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default NeedsAttention;
