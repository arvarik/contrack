/**
 * SearchingStage — what the Ask page shows while a model checks the answer.
 *
 * With AI at work the page does not show the local list that streams first:
 * it waits for the answer AI verified. Meanwhile the corvid hunts for it.
 * The bird in the search box takes off, grows to its flying size, and
 * wanders at random over the empty space where the results will appear:
 * the stage, and the page below it down to the bottom of the window.
 * When the answer arrives it is called home by the short way and lands back
 * in the search box, while the results fade in under it.
 *
 * The flight is the app's one flying bird (`CorvidFlight`), asked for with
 * `flyCorvid({ kind: "search" })` and ended with `recallCorvid()`. It follows
 * the account's corvid motion level, like every other flight:
 *
 * - "full": the flight. The stage holds only its words, for the bird to
 *   cross.
 * - "subtle" and "off": no flight. A larger bird sits in the middle of the
 *   stage, tilting its head at "subtle" and still at "off".
 *
 * An answer that comes quickly shows nothing at all: the stage waits
 * {@link STAGE_DELAY_MS}, and the bird waits {@link TAKEOFF_DELAY_MS} more,
 * so a name found locally never blinks a loading screen.
 *
 * @module views/search/SearchingStage
 */
import { forwardRef, useEffect, useRef, useState } from "react";
import { CorvidThinking } from "../../components/brand/CorvidThinking";
import { useCorvidLevel } from "../../hooks/useCorvidLevel";
import {
  CORVID_AWAY_EVENT,
  CORVID_HOME_EVENT,
  flyCorvid,
  recallCorvid,
  type CorvidPerchDetail,
} from "../../lib/corvid";

/** How long a search runs before the stage appears, in ms. */
export const STAGE_DELAY_MS = 150;
/** How long the stage stands before the bird takes off, in ms. */
export const TAKEOFF_DELAY_MS = 200;

interface CorvidSearchFlight {
  /** The search box's bird: the perch the flight leaves and lands on. */
  perchRef: React.RefObject<HTMLSpanElement | null>;
  /** The stage: the ground the bird hunts over. */
  areaRef: React.RefObject<HTMLDivElement | null>;
  /** The stage is up. */
  staged: boolean;
  /** No flight at this motion level: the stage holds a larger bird. */
  still: boolean;
  /** The search box shows the bird: it will fly, it is flying, or it lands. */
  perched: boolean;
}

/** Run the search flight while `searching` is true, and call it home after. */
export function useCorvidSearchFlight(searching: boolean): CorvidSearchFlight {
  const level = useCorvidLevel();
  const perchRef = useRef<HTMLSpanElement | null>(null);
  const departedPerchRef = useRef<Element | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [staged, setStaged] = useState(false);
  const [out, setOut] = useState(false);
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

  // Off to hunt, once the stage has stood a moment. The ground runs from
  // the stage down to the bottom of the window, where the results will be.
  // The flight keeps it inside the room: off the phone's tab bar, and in
  // from the edges.
  useEffect(() => {
    if (!searching || !staged || !flies) return;
    const timer = setTimeout(() => {
      const perch = perchRef.current;
      const stage = areaRef.current?.getBoundingClientRect();
      if (!perch || !stage || stage.width <= 0) return;
      flyCorvid({
        kind: "search",
        perch,
        area: {
          left: stage.left,
          top: stage.top,
          right: stage.right,
          bottom: Math.max(stage.bottom, window.innerHeight),
        },
      });
    }, TAKEOFF_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searching, staged, flies]);

  // The answer is here: home, by the short way.
  useEffect(() => {
    if (!searching && out) recallCorvid();
  }, [searching, out]);

  return {
    perchRef,
    areaRef,
    staged,
    still: !flies,
    perched: flies && (searching || out),
  };
}

interface SearchingStageProps {
  /** No flight: show a larger bird in the middle of the stage. */
  still: boolean;
  /** False when the account uses local search without an AI provider. */
  aiAllowed?: boolean;
}

/**
 * The ground the bird hunts over, and the words for what is happening. The
 * page's status region says the same, so the words here are not announced.
 */
export const SearchingStage = forwardRef<HTMLDivElement, SearchingStageProps>(
  function SearchingStage({ still, aiAllowed = true }, ref) {
    return (
      <div
        ref={ref}
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
  },
);
