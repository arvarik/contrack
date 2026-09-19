/**
 * SelectionOverlay — SVG overlay for box (Shift+drag) and lasso (L) selection.
 *
 * Requirements:
 * - Draws Shift+drag box or freehand lasso shape in --color-primary at 15% fill.
 * - Stops pointer events while drawing so the map does not pan.
 * - Touch devices never trigger drag selection.
 * - Unprojects screen coordinates to geographical coordinates on release.
 * - Entire SVG is aria-hidden="true" (selection results are announced separately).
 *
 * @module views/map/SelectionOverlay
 */
import React, { useEffect, useState, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Point } from "./mapMath";

export interface SelectionOverlayProps {
  map: MapLibreMap | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onSelectBox: (
    bounds: [west: number, south: number, east: number, north: number],
  ) => void;
  onSelectLasso: (ring: Point[]) => void;
  isLassoMode: boolean;
  onExitLassoMode: () => void;
}

export const SelectionOverlay: React.FC<SelectionOverlayProps> = ({
  map,
  containerRef,
  onSelectBox,
  onSelectLasso,
  isLassoMode,
  onExitLassoMode,
}) => {
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [boxCurrent, setBoxCurrent] = useState<{ x: number; y: number } | null>(
    null,
  );

  const [isDrawingLasso, setIsDrawingLasso] = useState(false);
  const [lassoPoints, setLassoPoints] = useState<[number, number][]>([]);

  const isLassoModeRef = useRef(isLassoMode);
  isLassoModeRef.current = isLassoMode;

  // Escape key cancels lasso mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isLassoModeRef.current) {
        onExitLassoMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onExitLassoMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !map) return;

    const onPointerDown = (e: PointerEvent) => {
      // Touch devices never draw selection
      if (e.pointerType === "touch") return;

      const isShift = e.shiftKey;
      const isLasso = isLassoModeRef.current;
      if (!isShift && !isLasso) return;

      // Don't intercept clicks on markers, popups, or controls
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          ".maplibregl-marker, .maplibregl-popup, button, a, [role='dialog'], [role='menu'], input",
        )
      ) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      e.preventDefault();
      e.stopPropagation();

      if (isLasso) {
        setIsDrawingLasso(true);
        setLassoPoints([[x, y]]);
      } else {
        setIsDrawingBox(true);
        setBoxStart({ x, y });
        setBoxCurrent({ x, y });
      }
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      container.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
    };
  }, [containerRef, map]);

  // Window pointermove and pointerup listeners while drawing
  useEffect(() => {
    if (!isDrawingBox && !isDrawingLasso) return;
    const container = containerRef.current;
    if (!container || !map) return;

    const onPointerMove = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

      if (isDrawingBox) {
        setBoxCurrent({ x, y });
      } else if (isDrawingLasso) {
        setLassoPoints((prev) => [...prev, [x, y]]);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isDrawingBox && boxStart && boxCurrent) {
        const minX = Math.min(boxStart.x, boxCurrent.x);
        const maxX = Math.max(boxStart.x, boxCurrent.x);
        const minY = Math.min(boxStart.y, boxCurrent.y);
        const maxY = Math.max(boxStart.y, boxCurrent.y);

        // Require at least a 4px drag
        if (maxX - minX > 4 || maxY - minY > 4) {
          const nw = map.unproject([minX, minY]);
          const se = map.unproject([maxX, maxY]);
          const west = Math.min(nw.lng, se.lng);
          const east = Math.max(nw.lng, se.lng);
          const south = Math.min(nw.lat, se.lat);
          const north = Math.max(nw.lat, se.lat);

          onSelectBox([west, south, east, north]);
        }
      } else if (isDrawingLasso && lassoPoints.length >= 3) {
        const geoRing: Point[] = lassoPoints.map(([px, py]) => {
          const coord = map.unproject([px, py]);
          return { lng: coord.lng, lat: coord.lat };
        });
        onSelectLasso(geoRing);
        onExitLassoMode();
      }

      setIsDrawingBox(false);
      setBoxStart(null);
      setBoxCurrent(null);
      setIsDrawingLasso(false);
      setLassoPoints([]);
    };

    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });

    return () => {
      window.removeEventListener("pointermove", onPointerMove, {
        capture: true,
      });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
    };
  }, [
    isDrawingBox,
    isDrawingLasso,
    boxStart,
    boxCurrent,
    lassoPoints,
    map,
    containerRef,
    onSelectBox,
    onSelectLasso,
    onExitLassoMode,
  ]);

  const boxRect =
    isDrawingBox && boxStart && boxCurrent
      ? {
          x: Math.min(boxStart.x, boxCurrent.x),
          y: Math.min(boxStart.y, boxCurrent.y),
          width: Math.abs(boxCurrent.x - boxStart.x),
          height: Math.abs(boxCurrent.y - boxStart.y),
        }
      : null;

  return (
    <div
      className={`absolute inset-0 pointer-events-none z-30 ${
        isLassoMode ? "cursor-crosshair" : ""
      }`}
    >
      <svg
        aria-hidden="true"
        className="w-full h-full pointer-events-none"
        style={{ overflow: "visible" }}
      >
        {boxRect && (
          <rect
            x={boxRect.x}
            y={boxRect.y}
            width={boxRect.width}
            height={boxRect.height}
            fill="var(--color-primary, #6750a4)"
            fillOpacity={0.15}
            stroke="var(--color-primary, #6750a4)"
            strokeWidth={2}
            strokeDasharray="4 2"
          />
        )}
        {isDrawingLasso && lassoPoints.length >= 2 && (
          <polygon
            points={lassoPoints.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="var(--color-primary, #6750a4)"
            fillOpacity={0.15}
            stroke="var(--color-primary, #6750a4)"
            strokeWidth={2}
          />
        )}
      </svg>
    </div>
  );
};
