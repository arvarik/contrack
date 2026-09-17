/**
 * CorvidTile: the favicon, inline.
 *
 * The gradient rounded square with the white glyph on it, in fixed brand
 * colours, for the places in the app that show the app's icon rather than
 * its mark: an "installed" card, an about row, a list of instances. It does
 * not follow the accent, on purpose. The tab strip cannot follow it either,
 * and this is the tab strip's picture.
 *
 * The geometry is `TILE` and `fitGlyph` from `src/assets/corvidPaths.ts`,
 * which `scripts/brand/build-icons.ts` also reads to write `public/favicon.svg`.
 */
import React, { useId } from "react";
import {
  CORVID_EYE,
  CORVID_PATHS,
  GLYPH_EYE_R,
  GLYPH_PARTS,
  GLYPH_STROKE,
  TILE,
  fitGlyph,
} from "../../assets/corvidPaths";

export interface CorvidTileProps {
  /** Rendered width and height, in CSS pixels. */
  size?: number;
  /** `true` hides the SVG from assistive tech. `false` names it "Contrack". */
  decorative?: boolean;
  className?: string;
}

const PLACEMENT = fitGlyph(TILE.box, TILE.glyphInset);

export const CorvidTile = ({
  size = 32,
  decorative = true,
  className,
}: CorvidTileProps) => {
  const gradientId = `tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
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
        transform={`translate(${PLACEMENT.tx} ${PLACEMENT.ty}) scale(${PLACEMENT.scale})`}
        fill="none"
        stroke={TILE.ink}
        strokeWidth={GLYPH_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPH_PARTS.map((part) => (
          <path key={part} d={CORVID_PATHS[part]} />
        ))}
        <circle
          cx={CORVID_EYE.cx}
          cy={CORVID_EYE.cy}
          r={GLYPH_EYE_R}
          fill={TILE.eye}
          stroke="none"
        />
      </g>
    </svg>
  );
};
