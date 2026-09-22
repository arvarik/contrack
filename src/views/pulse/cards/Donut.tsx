/**
 * Donut: the composition of the network as a ring, 96 px, in one hue.
 *
 * Each slice is the primary colour at a step of opacity, the largest slice
 * darkest, so the ring reads as one thing shaded rather than six colours
 * fighting. "Other" is the neutral track tone. The total sits in the
 * middle. A slice carries its words in a `<title>` for a pointer.
 */
import React from "react";

export interface DonutSlice {
  label: string;
  count: number;
  /** A CSS colour, a `var(--color-…)` token. */
  color: string;
  /** The stroke's opacity, 0 to 1. Default 1. */
  opacity?: number;
}

export interface DonutProps {
  slices: DonutSlice[];
  total: number;
  size?: number;
  strokeWidth?: number;
  /** The accessible name. Default names the count of groups and contacts. */
  label?: string;
}

export const Donut: React.FC<DonutProps> = ({
  slices,
  total,
  size = 96,
  strokeWidth = 12,
  label,
}) => {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return (
    <div
      className="relative flex items-center justify-center shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        role="img"
        aria-label={
          label ??
          `${slices.length} ${slices.length === 1 ? "group" : "groups"}, ${total} contacts`
        }
      >
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--color-surface-container-high)"
          strokeWidth={strokeWidth}
        />
        {total > 0 &&
          slices.map((slice) => {
            const fraction = slice.count / total;
            const length = fraction * circumference;
            const dasharray = `${length} ${circumference - length}`;
            const dashoffset = -accumulated;
            accumulated += length;
            return (
              <circle
                key={slice.label}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeOpacity={slice.opacity ?? 1}
                strokeWidth={strokeWidth}
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                className="transition-all duration-(--dur-slow)"
              >
                <title>
                  {`${slice.label}: ${slice.count} (${Math.round(fraction * 100)}%)`}
                </title>
              </circle>
            );
          })}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-base font-bold tabular-nums text-on-surface pointer-events-none"
      >
        {total}
      </span>
    </div>
  );
};
