import React, { useState, useMemo, Suspense } from "react";
import { Link } from "react-router-dom";
import { PieChart } from "lucide-react";
import { CardFrame } from "../components/CardFrame";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { Donut, type DonutSlice } from "./Donut";
import { filterPill } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import type { DashboardPayload } from "../../../api";

const NetworkCompositionModal = React.lazy(() =>
  import("../NetworkCompositionModal").then((m) => ({
    default: m.NetworkCompositionModal,
  })),
);

export type CompositionTab = "industry" | "role" | "location";

const TAB_OPTIONS: readonly SegmentedOption<CompositionTab>[] = [
  { value: "industry", label: "Industry" },
  { value: "role", label: "Role" },
  { value: "location", label: "Location" },
];

const SLICE_COLORS = [
  "var(--color-primary)",
  "var(--color-info)",
  "var(--color-ai)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-secondary)",
  "var(--color-on-surface-variant)", // for Other
];

export interface CompositionCardProps {
  dashboard?: DashboardPayload;
}

export const CompositionCard = ({ dashboard }: CompositionCardProps) => {
  const [tab, setTab] = useState<CompositionTab>("industry");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Extract raw entries based on selected tab
  const rawEntries = useMemo(() => {
    if (!dashboard) return [];
    if (tab === "industry") return dashboard.industryComposition || [];
    if (tab === "role") return dashboard.roleComposition || [];
    return dashboard.locationComposition || [];
  }, [dashboard, tab]);

  // Aggregate top 6 + Other
  const { slices, totalCount } = useMemo(() => {
    const valid = rawEntries
      .map((entry) => {
        const rec = entry as Record<string, unknown>;
        const labelKey = Object.keys(rec).find((k) => k !== "count") || "";
        const label = String(rec[labelKey] || "").trim();
        return { label, count: Number(entry.count) || 0 };
      })
      .filter((item) => item.label.length > 0 && item.count > 0)
      .sort((a, b) => b.count - a.count);

    const total = valid.reduce((sum, item) => sum + item.count, 0);

    const top6 = valid.slice(0, 6);
    const remainder = valid.slice(6);
    const otherCount = remainder.reduce((sum, item) => sum + item.count, 0);

    const topSlices: DonutSlice[] = top6.map((item, idx) => ({
      label: item.label,
      count: item.count,
      color: SLICE_COLORS[idx % (SLICE_COLORS.length - 1)],
    }));

    if (otherCount > 0) {
      topSlices.push({
        label: "Other",
        count: otherCount,
        color: SLICE_COLORS[SLICE_COLORS.length - 1],
      });
    }

    return { slices: topSlices, totalCount: total };
  }, [rawEntries]);

  const seeAllButton = (
    <button
      type="button"
      onClick={() => setIsModalOpen(true)}
      className="hit-area text-xs font-semibold text-primary hover:underline transition-all cursor-pointer"
    >
      See all
    </button>
  );

  return (
    <>
      <CardFrame
        cardId="composition"
        title="Composition"
        icon={PieChart}
        headerAction={seeAllButton}
        compact
      >
        <div className="flex flex-col gap-4">
          {/* Segmented dimension switch */}
          <div className="w-full">
            <Segmented
              label="Composition dimension"
              options={TAB_OPTIONS}
              value={tab}
              onChange={setTab}
            />
          </div>

          {totalCount === 0 ? (
            <div className="p-6 text-center text-xs text-on-surface-variant italic">
              No {tab} data recorded yet
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
              {/* Donut Chart */}
              <Donut slices={slices} total={totalCount} size={120} />

              {/* Legend with filterPill links */}
              <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1">
                {slices.map((slice) => {
                  if (slice.label === "Other") {
                    return (
                      <button
                        key="other"
                        type="button"
                        onClick={() => setIsModalOpen(true)}
                        className={cn(
                          filterPill(false),
                          "hit-area cursor-pointer",
                        )}
                        title="View full network composition"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span>Other</span>
                        <span className="text-[11px] font-normal">
                          ({slice.count})
                        </span>
                      </button>
                    );
                  }

                  const query = `${tab}:${encodeURIComponent(slice.label)}`;

                  return (
                    <Link
                      key={slice.label}
                      to={`/?q=${query}`}
                      className={cn(filterPill(false), "hit-area")}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: slice.color }}
                      />
                      <span className="truncate max-w-[120px]">
                        {slice.label}
                      </span>
                      <span className="text-[11px] font-normal">
                        ({slice.count})
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </CardFrame>

      {isModalOpen && dashboard && (
        <Suspense fallback={null}>
          <NetworkCompositionModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            composition={dashboard}
          />
        </Suspense>
      )}
    </>
  );
};
