/**
 * SearchingStage — what the Ask page shows while a model checks the answer.
 *
 * With AI at work the page does not show the local list that streams first:
 * it waits for the answer AI verified. Meanwhile the corvid hunts for it.
 * The bird in the search box takes off, grows to its flying size, and
 * wanders at random beside the search column and above it: the page's
 * empty margins to the left and right, and the band over the search box.
 * It never flies over the search box or the results under it, so the
 * answer appears in a column the bird is not crossing. When the answer
 * arrives it is called home round the column and lands back in the search
 * box from above, while the results fade in under it.
 *
 * The flight is the app's one flying bird (`CorvidFlight`), asked for with
 * `flyCorvid({ kind: "search" })` and ended with `recallCorvid()`. It follows
 * the account's corvid motion level, like every other flight:
 *
 * - "full": the flight. The stage holds only its words.
 * - "subtle" and "off": no flight. A larger bird sits in the middle of the
 *   stage, tilting its head at "subtle" and still at "off".
 *
 * A window with no room round the column to hunt in (`canHunt`) gets the
 * larger bird too, at every level.
 *
 * An answer that comes quickly shows nothing at all: the stage waits
 * {@link STAGE_DELAY_MS}, and the bird waits {@link TAKEOFF_DELAY_MS} more,
 * so a name found locally never blinks a loading screen.
 *
 * @module views/search/SearchingStage
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
  /**
   * The search box. From its top down, between its sides, is the column
   * the bird keeps out of: the box and the results under it.
   */
  fieldRef: React.RefObject<HTMLFormElement | null>;
  /**
   * The page the bird hunts in: the scroll container beside the nav rail.
   * Without it, the window.
   */
  pageRef: React.RefObject<HTMLDivElement | null>;
  /** The stage is up. */
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
  /** There is room round the column to hunt in. */
  room: boolean;
}

/**
 * The page, the column, and whether there is room to hunt round it, as the
 * page is laid out now. Null while the search box or its bird has no box to
 * measure.
 */
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
  // The column runs from the search box down past the bottom of the page:
  // the results fill it as they arrive.
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

/** Run the search flight while `searching` is true, and call it home after. */
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

  // The stage comes up only for a search that takes a moment.
  useEffect(() => {
    if (!searching) {
      setStaged(false);
      return;
    }
    const timer = setTimeout(() => setStaged(true), STAGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searching]);

  // Is there room to hunt? Measured before the first paint of a search, so
  // a window too small for a flight never shows the bird in the box first.
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

  // The overlay says when the bird leaves this perch and when it is back.
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

  // Off to hunt, once the stage has stood a moment. The page and the
  // column are measured again at takeoff: the coverage row under the box
  // can arrive late and move things.
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

  // The answer is here: home, by the short way round the column.
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

/**
 * The words for what is happening, where the answer will appear. The bird
 * hunts round this, never over it. The page's status region says the same,
 * so the words here are not announced.
 */
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
