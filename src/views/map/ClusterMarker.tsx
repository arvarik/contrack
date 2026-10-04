/**
 * A group of contacts too close to tell apart at this zoom.
 *
 * A button with the count, named for what a click does: "12 contacts, zoom
 * in". The click zooms to the level where the group splits. A hover or focus
 * previews who is in it.
 *
 * @module views/map/ClusterMarker
 */
import { memo, useId } from "react";
import { Marker } from "@vis.gl/react-maplibre";
import type { ClusterFeature } from "./useClusterFeatures";
import { OverdueDot, type PinEvent } from "./ContactMarker";
import { clusterCardId } from "./MapHoverCard";

/** The cluster's accessible name, which says what a click does. */
function clusterLabel(count: number, selected = 0, stacked = false): string {
  const word = count === 1 ? "contact" : "contacts";
  const what = stacked
    ? `${count} ${word} at one place, list them`
    : `${count} ${word}, zoom in`;
  return selected > 0 ? `${selected} of ${count} selected, ${what}` : what;
}

interface ClusterMarkerProps {
  cluster: ClusterFeature;
  selectedCount?: number;
  onExpand: (cluster: ClusterFeature) => void;
  onCard?: (cluster: ClusterFeature, event: PinEvent) => void;
  /** The preview is open, and describes the cluster. */
  described?: boolean;
  /** No zoom splits it, so a click lists its people. */
  stacked?: boolean;
  /** How many of its people have a follow-up overdue: a red dot. */
  overdue?: number;
  /** It holds the open contact, a card's or a list row's: the pin's halo. */
  halo?: boolean;
  /** Another contact is open, so this cluster steps back. */
  dimmed?: boolean;
}

export const ClusterMarker = memo(function ClusterMarker({
  cluster,
  selectedCount = 0,
  onExpand,
  onCard,
  described = false,
  stacked = false,
  overdue = 0,
  halo = false,
  dimmed = false,
}: ClusterMarkerProps) {
  const hasSelected = selectedCount > 0;
  const overdueId = useId();

  return (
    <Marker
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      anchor="center"
      style={halo ? { zIndex: 2 } : undefined}
    >
      {/*
        The count is text, and scaling text blurs it, so a hover lifts the
        cluster the way it lifts a pin instead of growing it. The hairline
        edge keeps the white disc apart from a pale basemap.
      */}
      <button
        type="button"
        aria-label={clusterLabel(cluster.count, selectedCount, stacked)}
        aria-describedby={
          [overdue > 0 && overdueId, described && clusterCardId(cluster.key)]
            .filter(Boolean)
            .join(" ") || undefined
        }
        data-halo={halo || undefined}
        data-dimmed={dimmed || undefined}
        onClick={() => onExpand(cluster)}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onCard?.(cluster, "enter");
        }}
        onPointerLeave={() => onCard?.(cluster, "leave")}
        onFocus={() => onCard?.(cluster, "focus")}
        onBlur={() => onCard?.(cluster, "blur")}
        className={`map-pin relative flex items-center justify-center w-12 h-12 rounded-full cursor-pointer bg-surface-container-lowest text-primary text-lg font-extrabold shadow-md transition-[translate,opacity] hover:-translate-y-1 ${
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
        {overdue > 0 && (
          <OverdueDot
            id={overdueId}
            label={`${overdue} ${overdue === 1 ? "follow-up" : "follow-ups"} overdue`}
          />
        )}
      </button>
    </Marker>
  );
});
