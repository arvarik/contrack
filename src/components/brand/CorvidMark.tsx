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
 */
import React, { useId } from "react";
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
  "width" | "height" | "viewBox" | "role" | "aria-hidden" | "aria-label"
> {
  /** Rendered width and height, in CSS pixels. */
  size?: number;
  variant?: CorvidVariant;
  /** `true` hides the SVG from assistive tech. `false` names it "Contrack". */
  decorative?: boolean;
  /** A native tooltip, for a mark that stands where a word used to. */
  title?: string;
  /** The stem of every part's id. Unique per instance when not given. */
  idPrefix?: string;
}

/** React's ids carry punctuation that a CSS selector would have to escape. */
const cleanId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "");

export const CorvidMark = ({
  size = 32,
  variant = "mark",
  decorative = true,
  title,
  idPrefix,
  className,
  ...rest
}: CorvidMarkProps) => {
  const generated = useId();
  const prefix = idPrefix ?? `corvid-${cleanId(generated)}`;
  const parts =
    variant === "glyph"
      ? CORVID_PART_ORDER.filter((part) => GLYPH_PARTS.includes(part))
      : CORVID_PART_ORDER;
  const stroke = variant === "glyph" ? GLYPH_STROKE : MARK_STROKE;
  const eyeRadius = variant === "glyph" ? GLYPH_EYE_R : CORVID_EYE.r;

  return (
    <svg
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
      aria-label={decorative ? undefined : "Contrack"}
      data-variant={variant}
      className={className}
      {...rest}
    >
      {title && <title>{title}</title>}
      {parts.map((part) => (
        <path key={part} id={`${prefix}-${part}`} d={CORVID_PATHS[part]} />
      ))}
      <circle
        id={`${prefix}-eye`}
        cx={CORVID_EYE.cx}
        cy={CORVID_EYE.cy}
        r={eyeRadius}
        fill="var(--color-corvid-eye)"
        stroke="none"
      />
    </svg>
  );
};
