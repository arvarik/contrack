/**
 * CorvidFlight — the one place the bird leaves its perch.
 *
 * Mounted once, beside the Toaster, and silent until something calls
 * `flyCorvid()`. One overlay rather than an animation per surface: two birds
 * in the air at once would be a bug, and a component that owns the whole
 * flight can cancel it on a route change without every caller remembering to.
 *
 * How a flight runs:
 *
 * 1. The event arrives. If the level is not "full", or the browser has no
 *    `offset-path`, the perch plays a hop and that is the whole answer.
 * 2. The perch is measured and hidden with `visibility`, not `display`, so
 *    the sidebar does not reflow around the gap.
 * 3. A fixed, `aria-hidden`, `pointer-events-none` layer at `z-[60]` holds a
 *    48 px mark riding `offset-path` with `offset-rotate: auto`, so the bird
 *    faces where it is going. The layer sits under the contact overlay and
 *    the palette (`z-[100]`) and under `Modal` (`z-[200]`): a flight never
 *    covers a control, and it could not swallow a click if it did.
 * 4. The wing flaps for the first and last third and glides through the
 *    middle. Landing unmounts the overlay, shows the perch again and blinks.
 *
 * Nothing here announces. The bird is decoration, and a screen reader that
 * said "Contrack" every time somebody clicked the logo would be worse than
 * saying nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { CorvidMark } from "./CorvidMark";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import {
  BLINK_CLASS,
  BLINK_MS,
  HOP_CLASS,
  HOP_MS,
  playCorvidBeat,
} from "../../hooks/useCorvidIdle";
import {
  CORVID_FLY_EVENT,
  FLIGHT_SIZE,
  buildFlightPath,
  buildHomePath,
  flightSeconds,
  offscreenStart,
  supportsOffsetPath,
  HOMING_SECONDS,
  type CorvidFlyDetail,
} from "../../lib/corvid";
import { cn } from "../../lib/utils";

/** The sidebar mark marks itself with this, so the overlay can find it. */
export const PERCH_ATTRIBUTE = "data-corvid-perch";

/** Spread this on the element the overlay should hide while the bird is out. */
export const perchProps = { [PERCH_ATTRIBUTE]: "" } as const;

/**
 * The perch that is actually on screen.
 *
 * There is more than one. The sidebar's stays in the DOM below `md`, hidden
 * by CSS rather than unmounted, and the Settings footer carries a second one
 * that only exists below `md`. A plain `querySelector` would hand back the
 * sidebar's on a phone: a rectangle of zeros, so the bird would leave from
 * the top left corner and land back there, and the perch a person pressed
 * would never go dark.
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

/** How long the bird takes to grow to size and to shrink back, in seconds. */
const RESIZE_SECONDS = 0.3;

interface Flight {
  /** A new id per flight, so React remounts and the animation restarts. */
  id: number;
  /** The `offset-path` curve, in viewport pixels. */
  d: string;
  seconds: number;
  /** The size it leaves at, as a fraction of 48. The perch is smaller. */
  fromScale: number;
  /** The size it lands at. Always the perch's, so the swap is invisible. */
  toScale: number;
}

export const CorvidFlight = () => {
  const level = useCorvidLevel();
  const location = useLocation();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [flapping, setFlapping] = useState(false);

  /** The perch we hid, so we can show it again however the flight ends. */
  const perchRef = useRef<HTMLElement | null>(null);
  const birdRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  /** Put the perch back, whether the bird landed, was cancelled or escaped. */
  const land = useCallback(
    (blink: boolean) => {
      clearTimers();
      setFlapping(false);
      setFlight(null);
      const perch = perchRef.current;
      perchRef.current = null;
      if (!perch) return;
      perch.style.visibility = "";
      if (blink) playCorvidBeat(perch, BLINK_CLASS, BLINK_MS);
    },
    [clearTimers],
  );

  useEffect(() => {
    const onFly = (event: Event) => {
      const detail = (event as CustomEvent<CorvidFlyDetail>).detail ?? {
        kind: "loop" as const,
      };
      const found = findPerch();
      const foundRect = found?.getBoundingClientRect();
      // A perch that CSS has hidden has no layout box. The sidebar's stays
      // in the DOM below `md`, so "there is a perch" and "the perch is on
      // screen" are two different questions.
      const perch = foundRect && foundRect.width > 0 ? found : null;

      if (level === "off") return;

      // "subtle" keeps the blinks and the hops and drops the flights, and a
      // browser with no `offset-path` gets the same answer: the bird
      // acknowledges the click without going anywhere.
      if (level === "subtle" || !supportsOffsetPath()) {
        playCorvidBeat(perch, HOP_CLASS, HOP_MS);
        return;
      }

      const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      const rect = detail.from ?? (perch ? foundRect : undefined);

      // No rectangle to leave from. A loop has nowhere to go and nothing to
      // land on, so it does not happen. A swoop is a flypast rather than a
      // bird leaving a perch, so it comes in from off screen instead: that
      // is Pulse on a phone, where the page carries no perch at all.
      if (!rect && detail.kind !== "swoop") return;

      const centre = rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : offscreenStart(viewport);
      const perchSize = rect ? Math.max(rect.width, 1) : FLIGHT_SIZE;

      // Already out: a second call asks the bird home rather than sending it
      // round again. It leaves from wherever it is on screen right now.
      if (flight) {
        const bird = birdRef.current?.getBoundingClientRect();
        if (!bird) return;
        clearTimers();
        setFlapping(true);
        setFlight({
          id: (nextId.current += 1),
          d: buildHomePath(viewport, centre, {
            x: bird.left + bird.width / 2,
            y: bird.top + bird.height / 2,
          }),
          seconds: HOMING_SECONDS,
          fromScale: 1,
          toScale: perchSize / FLIGHT_SIZE,
        });
        return;
      }

      if (perch) {
        perchRef.current = perch;
        playCorvidBeat(perch, HOP_CLASS, HOP_MS);
      }

      const seconds = flightSeconds(detail.kind);
      const id = (nextId.current += 1);

      // The hop finishes before the perch goes dark, so the two read as one
      // push-off rather than as a disappearance.
      timers.current.push(
        setTimeout(() => {
          if (perchRef.current) perchRef.current.style.visibility = "hidden";
          setFlapping(true);
          setFlight({
            id,
            d: buildFlightPath(viewport, centre, detail.kind),
            seconds,
            fromScale: perchSize / FLIGHT_SIZE,
            toScale: perchSize / FLIGHT_SIZE,
          });
          // Flap out, glide across the middle, flap home.
          timers.current.push(
            setTimeout(() => setFlapping(false), (seconds * 1000) / 3),
          );
          timers.current.push(
            setTimeout(() => setFlapping(true), (seconds * 1000 * 2) / 3),
          );
        }, HOP_MS),
      );
    };

    window.addEventListener(CORVID_FLY_EVENT, onFly);
    return () => window.removeEventListener(CORVID_FLY_EVENT, onFly);
  }, [clearTimers, flight, level]);

  /** Escape lands the bird at once, wherever it is. */
  useEffect(() => {
    if (!flight) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") land(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flight, land]);

  /** A new page is a new perch. Cancel rather than fly to a stale rectangle. */
  useEffect(() => {
    if (perchRef.current || flight) land(false);
    // Only the path matters: a query change is the same page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  /**
   * Nothing is left running, and nothing is left hidden, when the app
   * unmounts. Setting state from a cleanup is not allowed, so the perch is
   * restored straight on the node: the overlay is going away with the tree,
   * but the sidebar mark it hid may not be.
   */
  useEffect(
    () => () => {
      clearTimers();
      const perch = perchRef.current;
      perchRef.current = null;
      if (perch) perch.style.visibility = "";
    },
    [clearTimers],
  );

  if (!flight) return null;

  const grow = RESIZE_SECONDS / flight.seconds;

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-none"
      aria-hidden="true"
      data-corvid-flight=""
    >
      <motion.div
        key={flight.id}
        ref={birdRef}
        className={cn(
          "corvid-flying absolute top-0 left-0 text-primary",
          flapping && "corvid-flapping",
        )}
        style={{
          offsetPath: `path("${flight.d}")`,
          offsetRotate: "auto",
        }}
        initial={{ offsetDistance: "0%", scale: flight.fromScale }}
        animate={{
          offsetDistance: "100%",
          scale: [flight.fromScale, 1, 1, flight.toScale],
        }}
        transition={{
          offsetDistance: {
            duration: flight.seconds,
            ease: [0.4, 0, 0.3, 1],
          },
          scale: {
            duration: flight.seconds,
            times: [0, grow, 1 - grow, 1],
            ease: "easeOut",
          },
        }}
        onAnimationComplete={() => land(true)}
      >
        <CorvidMark size={FLIGHT_SIZE} />
      </motion.div>
    </div>
  );
};

export default CorvidFlight;
