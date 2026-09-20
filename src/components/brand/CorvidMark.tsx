/**
 * CorvidMark: the corvid as an inline SVG.
 *
 * Two variants of one drawing. `mark` is the whole bird, for 24 px and up.
 * `glyph` is the crown, the beak and the wing at a heavier stroke, for 16
 * and 32 px, where the chest and the tail would smear. Both stroke with
 * `currentColor`, so a mark on `text-primary` follows the accent a person
 * chose in Settings. The eye does not: it fills with `--color-corvid-eye`,
 * so a rose bird keeps its cyan eye.
 *
 * Decorative by default. The page title already names the app, and a
 * picture that repeats it is noise to a screen reader, so the SVG is
 * `aria-hidden` unless `decorative={false}` asks for `role="img"` with the
 * name "Contrack". It is never focusable.
 *
 * Every part carries an id, `<prefix>-wing`, `<prefix>-eye` and so on, so a
 * stylesheet can move one feather without touching the rest. The prefix is
 * unique per instance unless the caller sets it: the sidebar perch passes
 * `idPrefix="corvid"`, which is the one the motion keyframes target.
 *
 * Every part also carries `data-part`, which is the same name without the
 * prefix. An id is unique per instance and so cannot appear in a stylesheet;
 * `.corvid-flying [data-part="wing"]` reaches the wing of whichever bird is
 * flying, which is what the keyframes in `index.css` need.
 */
import React, { useEffect, useId, useRef } from "react";
import {
  HOP_CLASS,
  HOP_MS,
  playCorvidBeat,
  useCorvidIdle,
} from "../../hooks/useCorvidIdle";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import {
  CORVID_EYE,
  CORVID_PART_ORDER,
  CORVID_PATHS,
  CORVID_VIEWBOX,
  GLYPH_EYE_R,
  GLYPH_PARTS,
  GLYPH_STROKE,
  MARK_STROKE,
} from "../../assets/corvidPaths";

export type CorvidVariant = "mark" | "glyph";

export interface CorvidMarkProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  "width" | "height" | "viewBox" | "role" | "aria-hidden" | "aria-label" | "ref"
> {
  /** Rendered width and height, in CSS pixels. */
  size?: number;
  variant?: CorvidVariant;
  /** `true` hides the SVG from assistive tech. `false` names it "Contrack". */
  decorative?: boolean;
  /**
   * What a named mark is called. "Contrack" unless the bird is standing for
   * something else, as `CorvidThinking` does with "Thinking". Ignored while
   * the mark is decorative, which is the default.
   */
  label?: string;
  /** A native tooltip, for a mark that stands where a word used to. */
  title?: string;
  /** The stem of every part's id. Unique per instance when not given. */
  idPrefix?: string;
  /**
   * Blink now and then. Off by default: most marks on a page are furniture,
   * and one timer each would be a lot of timers for nothing. A mark under
   * 24 px ignores this, because a blink is invisible at that size.
   */
  idle?: boolean;
  /**
   * One hop when the mark appears, for a bird that is the good news itself:
   * the "All reviewed" state of the duplicates queue.
   */
  hop?: boolean;
}

/** React's ids carry punctuation that a CSS selector would have to escape. */
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export const CorvidMark = ({
  size = 32,
  variant = "mark",
  decorative = true,
  label = "Contrack",
  title,
  idPrefix,
  idle = false,
  hop = false,
  className,
  ...rest
}: CorvidMarkProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const generated = useId();
  const prefix = idPrefix ?? `corvid-${cleanId(generated)}`;
  const parts =
    variant === "glyph"
      ? CORVID_PART_ORDER.filter((part) => GLYPH_PARTS.includes(part))
      : CORVID_PART_ORDER;
  const stroke = variant === "glyph" ? GLYPH_STROKE : MARK_STROKE;
  const eyeRadius = variant === "glyph" ? GLYPH_EYE_R : CORVID_EYE.r;

  // The level is read here rather than by each caller, so a surface that
  // asks for motion cannot forget that the account, or the operating system,
  // may have asked for none.
  const level = useCorvidLevel();
  const moves = level !== "off";

  useCorvidIdle(svgRef, { enabled: idle && moves, size });

  useEffect(() => {
    if (!hop || !moves) return;
    return playCorvidBeat(svgRef.current, HOP_CLASS, HOP_MS);
  }, [hop, moves]);

  return (
    <svg
      ref={svgRef}
      viewBox={CORVID_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden={decorative ? "true" : undefined}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      data-variant={variant}
      className={className}
      {...rest}
    >
      {title && <title>{title}</title>}
      {parts.map((part) => (
        <path
          key={part}
          id={`${prefix}-${part}`}
          data-part={part}
          d={CORVID_PATHS[part]}
        />
      ))}
      <circle
        id={`${prefix}-eye`}
        data-part="eye"
        cx={CORVID_EYE.cx}
        cy={CORVID_EYE.cy}
        r={eyeRadius}
        fill="var(--color-corvid-eye)"
        stroke="none"
      />
    </svg>
  );
};
