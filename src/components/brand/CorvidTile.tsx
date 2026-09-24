/**
 * CorvidTile: the app icon, inline.
 *
 * The gradient rounded square with the white corvid on it, in fixed brand
 * colours, for the places in the app that show the app's icon rather than
 * its mark: an "installed" card, an about row, a list of instances. It does
 * not follow the accent, on purpose. The tab strip and a home screen cannot
 * follow it either, and this is their picture.
 *
 * The bird is the optical size for the tile's size (`opticalSize`), the
 * master the favicon or the launcher icon of that size draws. The geometry
 * is `TILE`, `CORVID_OPTICAL` and `fitMark` from `src/assets/corvidPaths.ts`,
 * which `scripts/brand/build-icons.ts` also reads to write `public/`.
 */
import React, { useId } from "react";
import {
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PATHS,
  TILE,
  fitMark,
  opticalSize,
} from "../../assets/corvidPaths";

export interface CorvidTileProps {
  /** Rendered width and height, in CSS pixels. */
  size?: number;
  /** `true` hides the SVG from assistive tech. `false` names it "Contrack". */
  decorative?: boolean;
  className?: string;
}

export const CorvidTile = ({
  size = 32,
  decorative = true,
  className,
}: CorvidTileProps) => {
  const gradientId = `tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const master = CORVID_OPTICAL[opticalSize(size)];
  const placement = fitMark(master, TILE.box, master.tileInset);
  return (
    <svg
      viewBox={`0 0 ${TILE.box} ${TILE.box}`}
      width={size}
      height={size}
      focusable="false"
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Contrack"}
      className={className}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={TILE.gradientFrom} />
          <stop offset="1" stopColor={TILE.gradientTo} />
        </linearGradient>
      </defs>
      <rect
        width={TILE.box}
        height={TILE.box}
        rx={TILE.radius}
        fill={`url(#${gradientId})`}
      />
      <g
        transform={`translate(${placement.tx} ${placement.ty}) scale(${placement.scale})`}
        fill="none"
        stroke={TILE.ink}
        strokeWidth={master.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {master.parts.map((part) => (
          <path key={part} d={CORVID_PATHS[part]} />
        ))}
        {master.eye > 0 && (
          <circle
            cx={CORVID_EYE.cx}
            cy={CORVID_EYE.cy}
            r={master.eye}
            fill={TILE.eye}
            stroke="none"
          />
        )}
      </g>
    </svg>
  );
};
