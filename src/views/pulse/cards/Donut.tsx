import React from "react";

export interface DonutSlice {
  label: string;
  count: number;
  color: string;
}

export interface DonutProps {
  slices: DonutSlice[];
  total: number;
  size?: number;
}

export const Donut: React.FC<DonutProps> = ({ slices, total, size = 120 }) => {
  const radius = 44;
  const strokeWidth = 16;
  const circumference = 2 * Math.PI * radius;

  let accumulatedOffset = 0;

  return (
    <div className="relative flex items-center justify-center shrink-0">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        className="transform -rotate-90"
        role="img"
        aria-label={`Donut chart with ${slices.length} categories, total ${total} contacts`}
      >
        {/* Track background */}
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--color-surface-container-high)"
          strokeWidth={strokeWidth}
        />

        {/* Donut Slices */}
        {total > 0 &&
          slices.map((slice, idx) => {
            const percentage = slice.count / total;
            const strokeLength = percentage * circumference;
            const strokeDasharray = `${strokeLength} ${circumference - strokeLength}`;
            const strokeDashoffset = -accumulatedOffset;
            accumulatedOffset += strokeLength;

            const pctFormatted = Math.round(percentage * 100);

            return (
              <circle
                key={idx}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-300"
              >
                <title>
                  {`${slice.label}: ${slice.count} (${pctFormatted}%)`}
                </title>
              </circle>
            );
          })}
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
        <span className="text-sm font-bold text-on-surface leading-tight">
          {total}
        </span>
        <span className="text-[11px] uppercase font-bold tracking-wider text-on-surface-variant">
          Total
        </span>
      </div>
    </div>
  );
};
