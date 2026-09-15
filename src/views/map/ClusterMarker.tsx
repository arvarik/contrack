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
export function clusterLabel(count: number): string {
  return `${count} ${count === 1 ? "contact" : "contacts"}, zoom in`;
}

interface ClusterMarkerProps {
  cluster: ClusterFeature;
  onExpand: (cluster: ClusterFeature) => void;
}

export const ClusterMarker = memo(function ClusterMarker({
  cluster,
  onExpand,
}: ClusterMarkerProps) {
  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      anchor="center"
    >
      <button
        type="button"
        aria-label={clusterLabel(cluster.count)}
        onClick={() => onExpand(cluster)}
        className="flex items-center justify-center w-12 h-12 rounded-full cursor-pointer bg-surface-container-lowest text-primary text-lg font-extrabold shadow-md ring-[3px] ring-primary transition-transform duration-200 hover:scale-105"
      >
        {cluster.count}
      </button>
    </Marker>
  );
});
