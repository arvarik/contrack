/**
 * A group of contacts too close to tell apart at this zoom.
 *
 * A button with the count, named for what a click does: "12 contacts, zoom
 * in". The click zooms to the level where the group splits.
 *
 * @module views/map/ClusterMarker
 */
import { memo } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import type { ClusterFeature } from "./useClusterFeatures";

/** The cluster's accessible name. */
function clusterLabel(count: number, selected = 0): string {
  const word = count === 1 ? "contact" : "contacts";
  if (selected > 0) {
    return `${selected} of ${count} selected, ${count} ${word}, zoom in`;
  }
  return `${count} ${word}, zoom in`;
}

interface ClusterMarkerProps {
  cluster: ClusterFeature;
  selectedCount?: number;
  onExpand: (cluster: ClusterFeature) => void;
}

export const ClusterMarker = memo(function ClusterMarker({
  cluster,
  selectedCount = 0,
  onExpand,
}: ClusterMarkerProps) {
  const hasSelected = selectedCount > 0;

  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      anchor="center"
    >
      {/*
        The count is text, and scaling text blurs it, so a hover lifts the
        cluster the way it lifts a pin instead of growing it. The hairline
        edge keeps the white disc apart from a pale basemap.
      */}
      <button
        type="button"
        aria-label={clusterLabel(cluster.count, selectedCount)}
        onClick={() => onExpand(cluster)}
        className={`flex items-center justify-center w-12 h-12 rounded-full cursor-pointer bg-surface-container-lowest text-primary text-lg font-extrabold shadow-md transition-transform hover:-translate-y-1 ${
          hasSelected ? "ring-2 ring-primary" : "ring-1 ring-outline-variant"
        }`}
      >
        {hasSelected ? (
          <span className="text-[11px] leading-tight font-extrabold text-center px-1">
            {selectedCount} of {cluster.count} selected
          </span>
        ) : (
          cluster.count
        )}
      </button>
    </Marker>
  );
});
