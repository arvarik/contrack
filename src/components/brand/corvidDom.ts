/**
 * corvidDom — putting a posed bird onto the paths of a mark.
 *
 * A living mark and the flying bird both draw with the same few elements:
 * one path per stroke and an ellipse for the eye, found by `data-part`. This
 * paints a pose onto them by writing attributes directly, sixty times a
 * second while something moves, without a React render in between.
 *
 * At rest a mark shows the logo's own path data, not the rig's copy of it.
 * The rig's copy matches it to a tenth of a unit, but the logo is the logo,
 * so a bird that has finished moving is repainted with `CORVID_PATHS`.
 *
 * @module components/brand/corvidDom
 */
import { CORVID_EYE, CORVID_PATHS } from "../../assets/corvidPaths";
import {
  HOME_POSE,
  POSE_KEYS,
  bodyCentre,
  corvidPathData,
  drawCorvid,
  rollDrawing,
  type CorvidPose,
} from "../../assets/corvidRig";

/** The bird's strokes, as a mark or the flying bird draws them. */
export const BIRD_STROKES = [
  "nape",
  "chest",
  "wing",
  "tail1",
  "tail2",
  "head",
] as const;
export type BirdStroke = (typeof BIRD_STROKES)[number];

export interface BirdElements {
  strokes: Partial<Record<BirdStroke, SVGPathElement>>;
  eye: SVGEllipseElement | null;
}

/** The bird's elements inside `root`, by `data-part`. Missing ones are skipped. */
export function birdElements(root: Element): BirdElements {
  const strokes: BirdElements["strokes"] = {};
  for (const stroke of BIRD_STROKES) {
    const el = root.querySelector<SVGPathElement>(`[data-part="${stroke}"]`);
    if (el) strokes[stroke] = el;
  }
  return {
    strokes,
    eye: root.querySelector<SVGEllipseElement>('[data-part="eye"]'),
  };
}

/** Whether a pose is the logo, to within what no eye could see. */
export function isHomePose(pose: CorvidPose): boolean {
  for (const key of POSE_KEYS) {
    if (Math.abs(pose[key] - HOME_POSE[key]) > 1e-3) return false;
  }
  return true;
}

const setD = (el: SVGPathElement | undefined, d: string) => {
  if (el && el.getAttribute("d") !== d) el.setAttribute("d", d);
};

/**
 * Paint a pose. A flying bird in a barrel roll passes `roll`, and turns
 * about the line its flight holds it by.
 */
export function paintPose(
  bird: BirdElements,
  pose: CorvidPose,
  roll: number = 1,
): void {
  const drawing = rollDrawing(drawCorvid(pose), roll, bodyCentre(pose)[1]);
  const paths = corvidPathData(drawing);
  for (const stroke of BIRD_STROKES) setD(bird.strokes[stroke], paths[stroke]);
  if (bird.eye) {
    bird.eye.setAttribute("cx", drawing.eye.cx.toFixed(2));
    bird.eye.setAttribute("cy", drawing.eye.cy.toFixed(2));
    bird.eye.setAttribute("rx", drawing.eye.rx.toFixed(2));
    bird.eye.setAttribute("ry", drawing.eye.ry.toFixed(2));
  }
}

/** Paint the logo, from the mark's own paths. */
export function paintHome(
  bird: BirdElements,
  eyeRadius: number = CORVID_EYE.r,
): void {
  setD(bird.strokes.nape, "");
  for (const stroke of BIRD_STROKES) {
    if (stroke !== "nape") setD(bird.strokes[stroke], CORVID_PATHS[stroke]);
  }
  if (bird.eye) {
    bird.eye.setAttribute("cx", String(CORVID_EYE.cx));
    bird.eye.setAttribute("cy", String(CORVID_EYE.cy));
    bird.eye.setAttribute("rx", String(eyeRadius));
    bird.eye.setAttribute("ry", String(eyeRadius));
  }
}
