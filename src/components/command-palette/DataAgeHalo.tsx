/**
 * DataAgeHalo — Freshness indicator ring around contact avatars.
 *
 * Wraps an avatar image with a colored ring indicating data freshness:
 *   🟢 Fresh  — updatedAt < 3 months ago (ring-emerald-400)
 *   🟡 Aging  — updatedAt 3-6 months ago (ring-amber-400)
 *   🔴 Stale  — updatedAt > 6 months ago (ring-rose-400)
 *
 * A tooltip provides the exact last update time on hover.
 *
 * @module src/components/command-palette/DataAgeHalo
 */
import React from "react";
import { formatDistanceToNow } from "date-fns";

interface DataAgeHaloProps {
  updatedAt: string | null | undefined;
  /** Size class for the outer ring container (matches the avatar size + ring padding) */
  size?: "sm" | "md";
  children: React.ReactNode;
}

type FreshnessLevel = "fresh" | "aging" | "stale";

const RING_COLORS: Record<FreshnessLevel, string> = {
  fresh: "ring-emerald-400/60",
  aging: "ring-amber-400/60",
  stale: "ring-rose-400/60",
};

function getFreshness(updatedAt: string | null | undefined): FreshnessLevel {
  if (!updatedAt) return "stale";

  const ms = Date.now() - new Date(updatedAt).getTime();
  const months = ms / (1000 * 60 * 60 * 24 * 30);

  if (months < 3) return "fresh";
  if (months < 6) return "aging";
  return "stale";
}

function getTooltip(
  updatedAt: string | null | undefined,
  level: FreshnessLevel,
): string {
  if (!updatedAt) return "No update date available";

  try {
    const distance = formatDistanceToNow(new Date(updatedAt), {
      addSuffix: true,
    });
    if (level === "stale") return `Data may be stale — updated ${distance}`;
    return `Updated ${distance}`;
  } catch {
    return "Unknown update date";
  }
}

export const DataAgeHalo = ({
  updatedAt,
  size = "md",
  children,
}: DataAgeHaloProps) => {
  const level = getFreshness(updatedAt);
  const tooltip = getTooltip(updatedAt, level);
  const ringClass = RING_COLORS[level];

  return (
    <div
      title={tooltip}
      className={`relative shrink-0 rounded-full ring-2 ${ringClass} ${size === "sm" ? "" : "mt-0.5"}`}
    >
      {children}
    </div>
  );
};
