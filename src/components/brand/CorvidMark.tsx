/**
 * CorvidMark: the corvid as an inline SVG.
 *
 * Two things in one drawing. The ring is the C the bird sits in, and nothing
 * ever moves it. The bird is everything else, grouped under `[data-bird]`,
 * and it is the only thing any animation touches: a blink, a preen, the
 * thinking tilt, a flight. When the bird flies, the ring stays where it is,
 * empty, until the bird lands in it again.
 *
 * Two variants. `mark` is the logo at its own weight, the one the rig moves.
 * `glyph` is the small optical size (`CORVID_OPTICAL.small`), for a bird at
 * 16 to 20 px: every part, at a heavier stroke and with a larger eye, the
 * same master the favicon draws at 32 px. Both stroke with `currentColor`,
 * so a mark on `text-primary` follows the accent a person chose in Settings.
 * The eye does not: it fills with `--color-corvid-eye`, so a rose bird keeps
 * its cyan eye.
 *
 * Decorative by default. The page title already names the app, and a
 * picture that repeats it is noise to a screen reader, so the SVG is
 * `aria-hidden` unless `decorative={false}` asks for `role="img"` with the
 * name "Contrack". It is never focusable.
 *
 * Every part carries an id, `<prefix>-wing`, `<prefix>-eye` and so on, and a
 * `data-part` with the same name without the prefix. The prefix is unique
 * per instance unless the caller sets it. The sidebar perch passes
 * `idPrefix="corvid"`.
 *
 * `alive` gives the bird a life of its own (see `useCorvidLife`). `hop` plays
 * one hop when the mark appears. Both read the motion level themselves, so a
 * caller may pass either without checking it first.
 */
import React, { useId, useRef } from "react";
import {
  useCorvidLife,
  LIFE_MIN_SIZE,
  type CorvidControls,
} from "../../hooks/useCorvidLife";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import {
  BIRD_PART_ORDER,
  CORVID_EYE,
  CORVID_OPTICAL,
  CORVID_PATHS,
  CORVID_RING,
  CORVID_VIEWBOX,
  MARK_STROKE,
} from "../../assets/corvidPaths";

/** The thinking bird's weight: the favicon's at 32 px. */
const GLYPH = CORVID_OPTICAL.small;

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
   * A life of its own: blinks, looks about, preens, stretches. Off by
   * default: most marks on a page are furniture. A mark under 24 px does not
   * live, because a blink is invisible at that size, but it still answers a
   * reaction sent to it. The whole mark only, not the glyph.
   */
  alive?: boolean;
  /**
   * The app's own bird: it answers `corvidReact()` and the app's activity,
   * watches the pointer and falls asleep when the person goes quiet. Only
   * the sidebar perch.
   */
  primary?: boolean;
  /** "calm" only blinks and looks about, for a bird that is an illustration. */
  temperament?: "lively" | "calm";
  /** More than 1 lives faster: the Appearance preview. */
  tempo?: number;
  /** A handle for the owner to ask for an act, or to say it is hovered. */
  controls?: CorvidControls;
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
  alive = false,
  primary = false,
  temperament = "lively",
  tempo = 1,
  controls,
  hop = false,
  className,
  ...rest
}: CorvidMarkProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const generated = useId();
  const prefix = idPrefix ?? `corvid-${cleanId(generated)}`;
  const glyph = variant === "glyph";
  const birdParts = glyph
    ? BIRD_PART_ORDER.filter((part) => GLYPH.parts.includes(part))
    : BIRD_PART_ORDER;
  const stroke = glyph ? GLYPH.stroke : MARK_STROKE;
  const eyeRadius = glyph ? GLYPH.eye : CORVID_EYE.r;

  // The level is read here rather than by each caller, so a surface that
  // asks for motion cannot forget that the account, or the operating system,
  // may have asked for none.
  const level = useCorvidLevel();
  const lives = alive && !glyph && size >= LIFE_MIN_SIZE;

  useCorvidLife(svgRef, {
    enabled: level !== "off" && !glyph,
    alive: lives,
    reactive: alive && !glyph,
    once: hop ? "hop" : null,
    primary: lives && primary,
    temperament,
    tempo,
    controls,
  });

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
      <path
        id={`${prefix}-${CORVID_RING}`}
        data-part={CORVID_RING}
        d={CORVID_PATHS[CORVID_RING]}
      />
      <g data-bird="">
        {/* The nape: drawn only while the bird is out of the ring. */}
        {!glyph && <path id={`${prefix}-nape`} data-part="nape" d="" />}
        {birdParts.map((part) => (
          <path
            key={part}
            id={`${prefix}-${part}`}
            data-part={part}
            d={CORVID_PATHS[part]}
          />
        ))}
        <ellipse
          id={`${prefix}-eye`}
          data-part="eye"
          cx={CORVID_EYE.cx}
          cy={CORVID_EYE.cy}
          rx={eyeRadius}
          ry={eyeRadius}
          fill="var(--color-corvid-eye)"
          stroke="none"
        />
      </g>
    </svg>
  );
};
