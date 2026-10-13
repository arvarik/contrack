/**
 * Box (Shift+drag) and lasso (L) selection, drawn in an SVG over the map. It
 * stops pointer events while drawing so the map does not pan, and touch
 * never draws. The SVG is aria-hidden: the page announces the selection.
 */
import React, { useCallback, useEffect, useState, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Point } from "./mapMath";

interface SelectionOverlayProps {
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

  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const boxCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const lassoPointsRef = useRef<[number, number][]>([]);
  const onSelectBoxRef = useRef(onSelectBox);
  onSelectBoxRef.current = onSelectBox;
  const onSelectLassoRef = useRef(onSelectLasso);
  onSelectLassoRef.current = onSelectLasso;
  const onExitLassoModeRef = useRef(onExitLassoMode);
  onExitLassoModeRef.current = onExitLassoMode;

  const isLassoModeRef = useRef(isLassoMode);
  isLassoModeRef.current = isLassoMode;

  const resetDrawing = useCallback(() => {
    boxStartRef.current = null;
    boxCurrentRef.current = null;
    lassoPointsRef.current = [];
    setIsDrawingBox(false);
    setBoxStart(null);
    setBoxCurrent(null);
    setIsDrawingLasso(false);
    setLassoPoints([]);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (boxStartRef.current || lassoPointsRef.current.length > 0) {
          resetDrawing();
        }
        if (isLassoModeRef.current) {
          onExitLassoModeRef.current();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetDrawing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !map) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button !== 0) return;

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
        const initial: [number, number][] = [[x, y]];
        lassoPointsRef.current = initial;
        setIsDrawingLasso(true);
        setLassoPoints(initial);
      } else {
        const pt = { x, y };
        boxStartRef.current = pt;
        boxCurrentRef.current = pt;
        setIsDrawingBox(true);
        setBoxStart(pt);
        setBoxCurrent(pt);
      }
    };

    container.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => {
      container.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
    };
  }, [containerRef, map]);

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
        const pt = { x, y };
        boxCurrentRef.current = pt;
        setBoxCurrent(pt);
      } else if (isDrawingLasso) {
        const pts = lassoPointsRef.current;
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last[0], y - last[1]) >= 4) {
          const next: [number, number][] = [...pts, [x, y]];
          lassoPointsRef.current = next;
          setLassoPoints(next);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const start = boxStartRef.current;
      const current = boxCurrentRef.current;
      const points = lassoPointsRef.current;

      if (isDrawingBox && start && current) {
        const minX = Math.min(start.x, current.x);
        const maxX = Math.max(start.x, current.x);
        const minY = Math.min(start.y, current.y);
        const maxY = Math.max(start.y, current.y);

        // A drag of 4 px or less either way selects nothing.
        if (maxX - minX > 4 && maxY - minY > 4) {
          const nw = map.unproject([minX, minY]);
          const se = map.unproject([maxX, maxY]);
          const west = nw.lng;
          const east = se.lng;
          const south = Math.min(nw.lat, se.lat);
          const north = Math.max(nw.lat, se.lat);

          onSelectBoxRef.current([west, south, east, north]);
        }
      } else if (isDrawingLasso && points.length >= 3) {
        const geoRing: Point[] = points.map(([px, py]) => {
          const coord = map.unproject([px, py]);
          return { lng: coord.lng, lat: coord.lat };
        });
        onSelectLassoRef.current(geoRing);
        onExitLassoModeRef.current();
      }

      resetDrawing();
    };

    const onCancel = () => {
      resetDrawing();
    };

    window.addEventListener("pointermove", onPointerMove, { capture: true });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onCancel, { capture: true });
    window.addEventListener("blur", onCancel);

    return () => {
      window.removeEventListener("pointermove", onPointerMove, {
        capture: true,
      });
      window.removeEventListener("pointerup", onPointerUp, { capture: true });
      window.removeEventListener("pointercancel", onCancel, { capture: true });
      window.removeEventListener("blur", onCancel);
    };
  }, [isDrawingBox, isDrawingLasso, map, containerRef, resetDrawing]);

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
