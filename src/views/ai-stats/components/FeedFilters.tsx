/**
 * FeedFilters — the cache filter and the sort toggle for the AI Stats
 * activity feed. The cache filter is a `Segmented`, so it is one radio group
 * with arrow keys for a screen reader and a keyboard, not three loose
 * buttons. The sort toggle is a flat button with the state layer, as tall as
 * the trough beside it.
 */
import React from "react";
import { cn } from "../../../lib/utils";
import { ArrowUpDown } from "lucide-react";
import { Segmented } from "../../../components/ui/Segmented";

interface FeedFiltersProps {
  cacheFilter: "all" | "fresh" | "cached";
  onCacheFilterChange: (f: "all" | "fresh" | "cached") => void;
  sort: "newest" | "oldest";
  onSortChange: (s: "newest" | "oldest") => void;
}

const CACHE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "fresh", label: "Fresh" },
  { value: "cached", label: "Cached" },
] as const;

export const FeedFilters = ({
  cacheFilter,
  onCacheFilterChange,
  sort,
  onSortChange,
}: FeedFiltersProps) => {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* `w-auto` keeps the trough to its options on a phone, so the sort
          toggle still fits on the same row. */}
      <Segmented
        label="Cache"
        options={CACHE_OPTIONS}
        value={cacheFilter}
        onChange={onCacheFilterChange}
        className="w-auto"
      />

      {/* Sort toggle */}
      <button
        onClick={() => onSortChange(sort === "newest" ? "oldest" : "newest")}
        className={cn(
          "hit-area ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-bold",
          "state-layer bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors",
        )}
      >
        <ArrowUpDown className="w-3 h-3" />
        {sort === "newest" ? "Newest" : "Oldest"}
      </button>
    </div>
  );
};
