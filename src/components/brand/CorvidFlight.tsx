/**
 * CorvidFlight — the one place the bird leaves its ring.
 *
 * Mounted once, beside the Toaster, and silent until something calls
 * `flyCorvid()`. One overlay rather than an animation per surface: two birds
 * in the air at once would be a bug, and a component that owns the whole
 * flight can cancel it on a route change without every caller remembering to.
 *
 * How a flight runs:
 *
 * 1. The event arrives. At level "off" nothing happens. At "subtle" the
 *    bird on the perch flutters its wings and stays in its ring. Otherwise:
 * 2. `planFlight` draws a new route: a lap, an outing or a celebration pass,
 *    each one different (see `lib/corvidFlight.ts`).
 * 3. The perch's bird is hidden, and only the bird: the ring stays where it
 *    is, empty. In the same frame a bird drawn by the same rig takes its
 *    place, in the same pose, at the same size, so the swap cannot be seen.
 * 4. Each frame paints the plan's pose and places the bird with one
 *    transform on a fixed, `aria-hidden`, `pointer-events-none` layer at
 *    `z-[60]`. The layer sits under the contact overlay and the palette
 *    (`z-[100]`) and under `Modal` (`z-[200]`): a flight never covers a
 *    control, and it could not swallow a click if it did.
 * 5. The bird lands back in its ring as the logo, the overlay goes, and the
 *    perch's own bird is shown again.
 *
 * A second press while it is out asks it home by a short way. Escape and a
 * route change land it at once. Nothing here announces: the bird is
 * decoration, and a screen reader that said "Contrack" every time somebody
 * pressed the logo would be worse than saying nothing.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import { bodyCentre } from "../../assets/corvidRig";
import {
  BIRD_PART_ORDER,
  CORVID_EYE,
  MARK_STROKE,
} from "../../assets/corvidPaths";
import { birdElements, paintPose, type BirdElements } from "./corvidDom";
import {
  CORVID_AWAY_EVENT,
  CORVID_FLY_EVENT,
  CORVID_HOME_EVENT,
  CORVID_STIR_EVENT,
  corvidReact,
  type CorvidFlyDetail,
  type CorvidPerchDetail,
} from "../../lib/corvid";
import {
  planFlight,
  type FlightFrame,
  type FlightPlan,
} from "../../lib/corvidFlight";

/** The perch marks itself with this, so the overlay can find it. */
export const PERCH_ATTRIBUTE = "data-corvid-perch";

/** Spread this on the element around the mark the bird leaves from. */
export const perchProps = { [PERCH_ATTRIBUTE]: "" } as const;

/**
 * The perch that is actually on screen.
 *
 * There is more than one. The sidebar's stays in the DOM below `md`, hidden
 * by CSS rather than unmounted, and the Settings footer carries a second one
 * that only exists below `md`. A plain `querySelector` would hand back the
 * sidebar's on a phone: a rectangle of zeros, so the bird would leave from
 * the top left corner and land back there.
 *
 * A hidden element has no layout box, so its width is the test. Exported for
 * the test that holds this rule.
 */
export function findPerch(): HTMLElement | null {
  const perches = [
    ...document.querySelectorAll<HTMLElement>(`[${PERCH_ATTRIBUTE}]`),
  ];
  return (
    perches.find((perch) => perch.getBoundingClientRect().width > 0) ??
    perches[0] ??
    null
  );
}

/**
 * The flying bird's canvas: the rig's 100-unit box with room round it for a
 * raised wing, a trailing tail and a roll.
 */
const PAD = 40;
const CANVAS = 100 + 2 * PAD;

/** The bird's elements, painted by the rig. No ring: the ring stays home. */
const FlyingBird = () => (
  <g data-bird="">
    <path data-part="nape" d="" />
    {BIRD_PART_ORDER.map((part) => (
      <path key={part} data-part={part} d="" />
    ))}
    <ellipse
      data-part="eye"
      cx={CORVID_EYE.cx}
      cy={CORVID_EYE.cy}
      rx={CORVID_EYE.r}
      ry={CORVID_EYE.r}
      fill="var(--color-corvid-eye)"
      stroke="none"
    />
  </g>
);

interface Flight {
  plan: FlightPlan;
  start: number;
  /** The perch's bird, hidden while it is out, or null for a flypast. */
  hidden: SVGGElement | null;
  perch: HTMLElement | null;
}

export const CorvidFlight = () => {
  const level = useCorvidLevel();
  const location = useLocation();
  const [flying, setFlying] = useState(0);

  const flight = useRef<Flight | null>(null);
  const last = useRef<FlightFrame | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const bird = useRef<BirdElements | null>(null);
  const raf = useRef(0);
  const shown = useRef(0);

  /** Give the perch its bird back, however the flight ended. */
  const land = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    const current = flight.current;
    flight.current = null;
    last.current = null;
    if (!current) return;
    if (current.hidden) current.hidden.style.visibility = "";
    if (current.perch) {
      window.dispatchEvent(
        new CustomEvent<CorvidPerchDetail>(CORVID_HOME_EVENT, {
          detail: { perch: current.perch },
        }),
      );
    }
    setFlying(0);
  }, []);

  /** Put the bird where the plan says, in the pose it says. */
  const place = useCallback((frame: FlightFrame) => {
    const el = holder.current;
    const canvas = svg.current;
    if (!el || !canvas) return;
    if (!bird.current) bird.current = birdElements(canvas);
    const k = frame.size / 100;
    const [cx, cy] = bodyCentre(frame.pose);
    el.style.transform =
      `translate3d(${frame.x.toFixed(2)}px, ${frame.y.toFixed(2)}px, 0) ` +
      `rotate(${frame.rotate.toFixed(2)}deg) scale(1, ${frame.roll.toFixed(3)}) ` +
      `translate(${(-(cx + PAD) * k).toFixed(2)}px, ${(-(cy + PAD) * k).toFixed(2)}px)`;
    const px = CANVAS * k;
    if (Math.abs(px - shown.current) > 0.25) {
      canvas.setAttribute("width", px.toFixed(2));
      canvas.setAttribute("height", px.toFixed(2));
      shown.current = px;
    }
    paintPose(bird.current, frame.pose);
    last.current = frame;
  }, []);

  const step = useCallback(() => {
    raf.current = 0;
    const current = flight.current;
    if (!current) return;
    const t = performance.now() - current.start;
    place(current.plan.frame(t));
    if (t >= current.plan.duration) {
      land();
      return;
    }
    raf.current = requestAnimationFrame(step);
  }, [land, place]);

  useEffect(() => {
    const onFly = (event: Event) => {
      const detail = (event as CustomEvent<CorvidFlyDetail>).detail ?? {
        kind: "loop" as const,
      };
      if (level === "off") return;

      const found =
        (detail.perch as HTMLElement | null | undefined) ?? findPerch();
      const foundRect = found?.getBoundingClientRect();
      // A perch that CSS has hidden has no layout box. The sidebar's stays
      // in the DOM below `md`, so "there is a perch" and "the perch is on
      // screen" are two different questions.
      const perch = foundRect && foundRect.width > 0 ? found : null;

      // "subtle" keeps the bird in its ring: a flutter answers a press or a
      // celebration, and an outing of its own becomes an act on the perch.
      if (level === "subtle") {
        if (detail.kind === "sortie")
          window.dispatchEvent(new CustomEvent(CORVID_STIR_EVENT));
        else corvidReact("flutter", perch);
        return;
      }

      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const rect = detail.from ?? (perch ? foundRect : undefined);
      // No rectangle to leave from. A lap or an outing has nowhere to go and
      // nothing to land on, so it does not happen. A swoop is a flypast
      // rather than a bird leaving its ring, so it comes in from off screen:
      // that is Pulse on a phone, where the page carries no perch at all.
      if (!rect && detail.kind !== "swoop") return;
      const home = rect
        ? { left: rect.left, top: rect.top, size: Math.max(rect.width, 1) }
        : null;

      // Already out: a second press asks it home by a short way.
      const current = flight.current;
      if (current) {
        const at = last.current;
        if (!at || !current.plan.lands || !home) return;
        current.plan = planFlight({
          kind: "loop",
          viewport,
          perch: home,
          rng: Math.random,
          airborne: {
            x: at.x,
            y: at.y,
            facing: at.pose.headFacing >= 0 ? 1 : -1,
          },
        });
        current.start = performance.now();
        return;
      }

      const plan = planFlight({
        kind: detail.kind,
        viewport,
        perch: home,
        rng: Math.random,
      });
      const leaving = detail.from ? null : perch;
      const hidden = leaving?.querySelector<SVGGElement>("[data-bird]") ?? null;
      flight.current = {
        plan,
        start: performance.now(),
        hidden,
        perch: leaving,
      };
      if (leaving) {
        window.dispatchEvent(
          new CustomEvent<CorvidPerchDetail>(CORVID_AWAY_EVENT, {
            detail: { perch: leaving },
          }),
        );
      }
      setFlying((n) => n + 1);
    };

    window.addEventListener(CORVID_FLY_EVENT, onFly);
    return () => window.removeEventListener(CORVID_FLY_EVENT, onFly);
  }, [level]);

  // The overlay is in the DOM now: hide the perch's bird and paint the first
  // frame before the browser paints, so nothing blinks.
  useLayoutEffect(() => {
    const current = flight.current;
    if (!flying || !current) return;
    bird.current = null;
    shown.current = 0;
    place(current.plan.frame(0));
    if (current.hidden) current.hidden.style.visibility = "hidden";
    if (!raf.current) raf.current = requestAnimationFrame(step);
  }, [flying, place, step]);

  /** Escape lands the bird at once, wherever it is. */
  useEffect(() => {
    if (!flying) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") land();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flying, land]);

  /** A new page is a new perch. Land rather than fly to a stale rectangle. */
  useEffect(() => {
    if (flight.current) land();
    // Only the path matters: a query change is the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  /** Reduced motion arriving mid-flight lands it too. */
  useEffect(() => {
    if (level !== "full" && flight.current) land();
  }, [level, land]);

  /** Nothing is left running, and nothing is left hidden, on unmount. */
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      const current = flight.current;
      flight.current = null;
      if (current?.hidden) current.hidden.style.visibility = "";
    },
    [],
  );

  if (!flying) return null;

  return (
    <div
      ref={layer}
      className="fixed inset-0 z-[60] pointer-events-none overflow-hidden"
      aria-hidden="true"
      data-corvid-flight=""
    >
      <div
        ref={holder}
        className="corvid-flying absolute top-0 left-0 text-primary"
        style={{ transformOrigin: "0 0" }}
      >
        <svg
          ref={svg}
          viewBox={`${-PAD} ${-PAD} ${CANVAS} ${CANVAS}`}
          width={0}
          height={0}
          fill="none"
          stroke="currentColor"
          strokeWidth={MARK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
          className="block overflow-visible"
        >
          <FlyingBird />
        </svg>
      </div>
    </div>
  );
};

export default CorvidFlight;
