/**
 * CompositionCard: who the network is made of, by industry, role or place.
 *
 * Last in the Intelligence column and compact: a 96 px donut in one hue and
 * a text legend beside it, each entry a link to the list filtered to that
 * group. "Other" opens the full breakdown, as does See all. No other page
 * has a home for this chart yet, and customize mode can hide it.
 */
import React, { useState, useMemo, Suspense } from "react";
import { Link } from "react-router-dom";
import { CardFrame } from "../components/CardFrame";
import {
  Segmented,
  type SegmentedOption,
} from "../../../components/ui/Segmented";
import { Donut, type DonutSlice } from "./Donut";
import { BTN_QUIET } from "../../../lib/styles";
import { cn } from "../../../lib/utils";
import { COMPOSITION_RAMP, PULSE_TYPE } from "../lib/pulseStyles";
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

/** The six largest groups get a slice each. The rest are "Other". */
const TOP_SLICES = COMPOSITION_RAMP.opacities.length;

export interface CompositionCardProps {
  dashboard?: DashboardPayload;
}

/** The legend's dot, in the slice's own fill and opacity. */
const LEGEND_ROW =
  "hit-area flex items-center gap-2 min-w-0 w-full rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-surface-container-low transition-colors text-left";

export const CompositionCard = ({ dashboard }: CompositionCardProps) => {
  const [tab, setTab] = useState<CompositionTab>("industry");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const rawEntries = useMemo(() => {
    if (!dashboard) return [];
    if (tab === "industry") return dashboard.industryComposition || [];
    if (tab === "role") return dashboard.roleComposition || [];
    return dashboard.locationComposition || [];
  }, [dashboard, tab]);

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
    const top = valid.slice(0, TOP_SLICES);
    const otherCount = valid
      .slice(TOP_SLICES)
      .reduce((sum, item) => sum + item.count, 0);

    const topSlices: DonutSlice[] = top.map((item, idx) => ({
      label: item.label,
      count: item.count,
      color: COMPOSITION_RAMP.color,
      opacity: COMPOSITION_RAMP.opacities[idx],
    }));
    if (otherCount > 0) {
      topSlices.push({
        label: "Other",
        count: otherCount,
        color: COMPOSITION_RAMP.other,
      });
    }
    return { slices: topSlices, totalCount: total };
  }, [rawEntries]);

  return (
    <>
      <CardFrame
        cardId="composition"
        title="Composition"
        compact
        headerAction={
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className={cn(BTN_QUIET, "cursor-pointer")}
          >
            See all
          </button>
        }
      >
        <div className="flex flex-col gap-4">
          <Segmented
            label="Composition dimension"
            options={TAB_OPTIONS}
            value={tab}
            onChange={setTab}
          />

          {totalCount === 0 ? (
            <p className={cn(PULSE_TYPE.meta, "py-2")}>
              No {tab} recorded yet.
            </p>
          ) : (
            // The donut over the legend, not beside it: the Intelligence
            // column is three of twelve at xl, and a legend squeezed beside
            // a 96 px ring cut "Music Streaming" to "Music Stream…".
            <div className="flex flex-col items-center gap-4 min-w-0">
              <Donut
                slices={slices}
                total={totalCount}
                label={`${totalCount} contacts by ${tab}, ${slices.length} ${
                  slices.length === 1 ? "group" : "groups"
                }`}
              />

              {/* The legend: one line per group, the count at the right.
                  A list of words wraps and never scrolls sideways. */}
              <ul
                className={cn(PULSE_TYPE.meta, "w-full min-w-0 flex flex-col")}
              >
                {slices.map((slice) => {
                  const dot = (
                    <span
                      aria-hidden="true"
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: slice.color,
                        opacity: slice.opacity ?? 1,
                      }}
                    />
                  );
                  const words = (
                    <>
                      <span className="truncate text-on-surface">
                        {slice.label}
                      </span>{" "}
                      <span className="ml-auto tabular-nums shrink-0">
                        {slice.count}
                      </span>
                    </>
                  );
                  if (slice.label === "Other") {
                    return (
                      <li key="other">
                        <button
                          type="button"
                          onClick={() => setIsModalOpen(true)}
                          className={cn(LEGEND_ROW, "cursor-pointer")}
                        >
                          {dot}
                          {words}
                        </button>
                      </li>
                    );
                  }
                  return (
                    <li key={slice.label}>
                      <Link
                        to={`/?q=${tab}:${encodeURIComponent(slice.label)}`}
                        className={LEGEND_ROW}
                      >
                        {dot}
                        {words}
                      </Link>
                    </li>
                  );
                })}
              </ul>
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
