/**
 * A group of contacts too close to tell apart at this zoom.
 *
 * A button with the count, named for what a click does: "12 contacts, zoom
 * in". The click zooms to the level where the group splits.
 *
 * @module views/map/ClusterMarker
 */
import { memo } from "react";
import { Marker } from "react-map-gl/maplibre";
import type { ClusterFeature } from "./useClusterFeatures";

/** The cluster's accessible name. */
export function clusterLabel(count: number, atRisk = 0): string {
  const word = count === 1 ? "contact" : "contacts";
  return `${count} ${word}, ${atRisk} at risk, zoom in`;
}

interface ClusterMarkerProps {
  cluster: ClusterFeature;
  onExpand: (cluster: ClusterFeature) => void;
}

export const ClusterMarker = memo(function ClusterMarker({
  cluster,
  onExpand,
}: ClusterMarkerProps) {
  const size = 48;
  const strokeWidth = 3;
  const radius = size / 2 - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const atRisk = cluster.atRisk ?? 0;
  const count = cluster.count;
  const errorShare = count > 0 ? Math.min(1, Math.max(0, atRisk / count)) : 0;

  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      anchor="center"
    >
      <button
        type="button"
        aria-label={clusterLabel(cluster.count, atRisk)}
        onClick={() => onExpand(cluster)}
        className="relative flex items-center justify-center w-12 h-12 rounded-full cursor-pointer bg-surface-container-lowest text-primary text-lg font-extrabold shadow-md transition-transform duration-200 hover:scale-105"
      >
        <svg
          width={size}
          height={size}
          aria-hidden="true"
          className="absolute inset-0 -rotate-90 pointer-events-none"
        >
          {/* Track: outline-variant */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-outline-variant, #cac4d0)"
            strokeWidth={strokeWidth}
          />
          {errorShare > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--color-error, #ba1a1a)"
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - errorShare)}
            />
          )}
        </svg>
        <span className="relative z-10">{cluster.count}</span>
      </button>
    </Marker>
  );
});
