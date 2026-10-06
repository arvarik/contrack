/**
 * What the Ask page shows while a model checks the answer. The bird in the
 * search box flies (`flyCorvid({ kind: "search" })`) in the margins and the
 * band above the box, never over the search column, so the answer appears
 * where the bird is not. `recallCorvid()` lands it back in the box.
 *
 * At corvid level "full" the bird flies. At "subtle" and "off", or with no
 * room round the column (`canHunt`), a larger bird sits in the stage.
 *
 * A quick answer shows nothing: the stage waits {@link STAGE_DELAY_MS} and
 * the bird {@link TAKEOFF_DELAY_MS} more, so a local hit never blinks.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CorvidThinking } from "../../components/brand/CorvidThinking";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import {
  CORVID_AWAY_EVENT,
  CORVID_HOME_EVENT,
  flyCorvid,
  recallCorvid,
  type CorvidPerchDetail,
} from "../../lib/corvid";
import {
  canHunt,
  searchGround,
  type FlightBox,
  type FlightPerch,
} from "../../lib/corvidFlight";

/** How long a search runs before the stage appears, in ms. */
export const STAGE_DELAY_MS = 150;
/** How long the stage stands before the bird takes off, in ms. */
export const TAKEOFF_DELAY_MS = 200;

interface CorvidSearchFlight {
  /** The search box's bird: the perch the flight leaves and lands on. */
  perchRef: React.RefObject<HTMLSpanElement | null>;
  /** The search box. The column from its top down is a no-fly zone. */
  fieldRef: React.RefObject<HTMLFormElement | null>;
  /** The scroll container the bird hunts in. Without it, the window. */
  pageRef: React.RefObject<HTMLDivElement | null>;
  staged: boolean;
  /** No flight here: the stage holds a larger bird. */
  still: boolean;
  /** The search box shows the bird: it will fly, it is flying, or it lands. */
  perched: boolean;
}

const boxOf = (rect: DOMRect): FlightBox => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

interface Hunt {
  perch: HTMLSpanElement;
  area: FlightBox;
  avoid: FlightBox;
  room: boolean;
}

/** Null while the search box or its bird has no box to measure. */
function measureHunt(
  perch: HTMLSpanElement | null,
  field: HTMLElement | null,
  page: HTMLElement | null,
): Hunt | null {
  const fieldRect = field?.getBoundingClientRect();
  const perchRect = perch?.getBoundingClientRect();
  if (!perch || !fieldRect || fieldRect.width <= 0) return null;
  if (!perchRect || perchRect.width <= 0) return null;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const pageRect = page?.getBoundingClientRect();
  const area =
    pageRect && pageRect.width > 0
      ? boxOf(pageRect)
      : { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  // The column runs past the page bottom: the results fill it as they arrive.
  const avoid = {
    left: fieldRect.left,
    top: fieldRect.top,
    right: fieldRect.right,
    bottom: Math.max(area.bottom, viewport.height),
  };
  const home: FlightPerch = {
    left: perchRect.left,
    top: perchRect.top,
    size: perchRect.width,
  };
  return {
    perch,
    area,
    avoid,
    room: canHunt(searchGround(viewport, area, avoid, home)),
  };
}

/** Runs the search flight while `searching`, and calls it home after. */
export function useCorvidSearchFlight(searching: boolean): CorvidSearchFlight {
  const level = useCorvidLevel();
  const perchRef = useRef<HTMLSpanElement | null>(null);
  const departedPerchRef = useRef<Element | null>(null);
  const fieldRef = useRef<HTMLFormElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [staged, setStaged] = useState(false);
  const [out, setOut] = useState(false);
  /** Measured, and no room round the column: the bird stays home. */
  const [grounded, setGrounded] = useState(false);
  const flies = level === "full";

  useEffect(() => {
    if (!searching) {
      setStaged(false);
      return;
    }
    const timer = setTimeout(() => setStaged(true), STAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searching]);

  // Measured before the first paint, so a window too small for a flight
  // never shows the bird in the box first.
  useLayoutEffect(() => {
    if (!searching || !flies) {
      setGrounded(false);
      return;
    }
    const hunt = measureHunt(
      perchRef.current,
      fieldRef.current,
      pageRef.current,
    );
    setGrounded(hunt !== null && !hunt.room);
  }, [searching, flies]);

  useEffect(() => {
    const onAway = (event: Event) => {
      const perch = (event as CustomEvent<CorvidPerchDetail>).detail?.perch;
      if (perch && perch === perchRef.current) {
        departedPerchRef.current = perch;
        setOut(true);
      }
    };
    const onHome = (event: Event) => {
      const perch = (event as CustomEvent<CorvidPerchDetail>).detail?.perch;
      // Switching to Notes removes the search box before the bird lands.
      // Match the departure, not the current ref, which can now be null.
      if (perch && perch === departedPerchRef.current) {
        departedPerchRef.current = null;
        setOut(false);
      }
    };
    window.addEventListener(CORVID_AWAY_EVENT, onAway);
    window.addEventListener(CORVID_HOME_EVENT, onHome);
    return () => {
      window.removeEventListener(CORVID_AWAY_EVENT, onAway);
      window.removeEventListener(CORVID_HOME_EVENT, onHome);
    };
  }, []);

  // Measure again at takeoff: the coverage row under the box can arrive late
  // and move things.
  useEffect(() => {
    if (!searching || !staged || !flies || grounded) return;
    const timer = setTimeout(() => {
      const hunt = measureHunt(
        perchRef.current,
        fieldRef.current,
        pageRef.current,
      );
      if (!hunt) return;
      if (!hunt.room) {
        setGrounded(true);
        return;
      }
      flyCorvid({
        kind: "search",
        perch: hunt.perch,
        area: hunt.area,
        avoid: hunt.avoid,
      });
    }, TAKEOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searching, staged, flies, grounded]);

  useEffect(() => {
    if (!searching && out) recallCorvid();
  }, [searching, out]);

  return {
    perchRef,
    fieldRef,
    pageRef,
    staged,
    still: !flies || grounded,
    perched: flies && !grounded && (searching || out),
  };
}

interface SearchingStageProps {
  /** No flight: show a larger bird in the middle of the stage. */
  still: boolean;
  /** False when the account uses local search without an AI provider. */
  aiAllowed?: boolean;
}

/** The page's status region says the same, so these words are not announced. */
export const SearchingStage = ({
  still,
  aiAllowed = true,
}: SearchingStageProps) => (
  <div
    data-testid="searching-stage"
    className="fade-enter flex flex-col items-center justify-center gap-2 text-center min-h-60 sm:min-h-72 px-4"
  >
    {still && (
      <CorvidThinking decorative size={64} className="mb-2 text-primary" />
    )}
    <p className="text-sm font-semibold text-on-surface">
      Searching your network…
    </p>
    <p className="text-xs text-on-surface-variant">
      {aiAllowed
        ? "AI is checking who fits your question"
        : "Finding people who fit your question"}
    </p>
  </div>
);
