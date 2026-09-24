/**
 * corvid.ts — the seam between whatever wants the bird to move and the birds
 * that move.
 *
 * Nothing here imports React. A view that wants something from the corvid
 * calls one of three functions and forgets about it:
 *
 * - `flyCorvid()` asks for a flight. `CorvidFlight`, mounted once in `App`,
 *   is the only listener, so two birds are never in the air at once.
 * - `corvidReact()` asks the perched bird for one small act: a nod when a
 *   follow-up is done, a hop for a new contact. The bird on the sidebar
 *   perch, the one that is always there, is the listener.
 * - `noteCorvidActivity()` counts a finished API request. About once a
 *   hundred requests, or once every six to twelve AI answers, the bird
 *   notices the work going on and does something of its own: a preen, a
 *   stretch, now and then a short flight near home. `apiFetch` calls it, so
 *   no view has to.
 *
 * Every one of these is silent when the account, the Motion row or the
 * operating system asked for no motion: the listeners read the level, and
 * the level is `motionLevel()` below and nothing else.
 *
 * @module lib/corvid
 */
import type { MascotMotion, MotionPreference } from "../api/preferences";
import type { CorvidReaction } from "./corvidBrain";
import { between, type Rng } from "./corvidMotion";
import type { FlightKind } from "./corvidFlight";

export type { CorvidReaction } from "./corvidBrain";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Someone asked the corvid to fly. Owned by `CorvidFlight`. */
export const CORVID_FLY_EVENT = "contrack:corvid-fly";
/** Someone asked the perched corvid for one act. */
export const CORVID_REACT_EVENT = "contrack:corvid-react";
/** The app is busy: the perched corvid may do something of its own. */
export const CORVID_STIR_EVENT = "contrack:corvid-stir";
/** The bird left this perch. The perch stops moving its hidden bird. */
export const CORVID_AWAY_EVENT = "contrack:corvid-away";
/** The bird is back on this perch. */
export const CORVID_HOME_EVENT = "contrack:corvid-home";

export type CorvidFlightKind = FlightKind;

/** The payload {@link CORVID_FLY_EVENT} carries. */
export interface CorvidFlyDetail {
  kind: CorvidFlightKind;
  /**
   * The perch to leave from and land on: the element round a living mark,
   * whose bird is hidden while it is out. Omitted means the perch on
   * screen, which the overlay finds for itself.
   */
  perch?: Element | null;
  /**
   * A rectangle to start and land at instead, with no bird of its own to
   * hide: a flypast of something that is not a perch.
   */
  from?: DOMRect;
}

/** The payload {@link CORVID_REACT_EVENT} carries. */
export interface CorvidReactDetail {
  reaction: CorvidReaction;
  /**
   * The perch that should answer. Omitted means the one bird that listens to
   * the whole app, on the sidebar perch.
   */
  target?: Element | null;
}

/** The payload of the away and home events: which perch. */
export interface CorvidPerchDetail {
  perch: Element;
}

const emit = <T>(name: string, detail?: T) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
};

/** Ask the corvid to fly. Silent when no overlay is mounted. */
export const flyCorvid = (detail: Partial<CorvidFlyDetail> = {}): void =>
  emit<CorvidFlyDetail>(CORVID_FLY_EVENT, {
    kind: detail.kind ?? "loop",
    perch: detail.perch,
    from: detail.from,
  });

/**
 * The shortest time between two of the same reaction, in ms. Ten follow-ups
 * done in a row get a nod or two, not ten.
 */
export const REACTION_GAP = 4_000;
const lastReaction = new Map<CorvidReaction, number>();

/** Ask the perched corvid for one act. Repeats close together are dropped. */
export function corvidReact(
  reaction: CorvidReaction,
  target?: Element | null,
): void {
  if (typeof window === "undefined") return;
  const now = performance.now();
  if (!target) {
    if (now - (lastReaction.get(reaction) ?? -Infinity) < REACTION_GAP) return;
    lastReaction.set(reaction, now);
  }
  emit<CorvidReactDetail>(CORVID_REACT_EVENT, { reaction, target });
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * Requests that mean a model did some work. The client side of
 * `AI_COST_PATTERNS` in `server/middleware/rateLimit.ts`, less the two that
 * only fetch: the link preview and the embedding backfill.
 */
const AI_PATHS: readonly RegExp[] = [
  /^\/search\/semantic/,
  /^\/search\/synthesize/,
  /^\/parse-contact/,
  /^\/contacts\/[^/]+\/enrich/,
  /^\/contacts\/[^/]+\/briefing/,
  /^\/ai-search$/,
  /^\/dedupe\/scan/,
  /^\/dashboard\/insight/,
];

/** Whether an `apiFetch` path is a request a model answers. */
export const isAiPath = (path: string): boolean => {
  const bare = path.split("?")[0]!.toLowerCase();
  return AI_PATHS.some((pattern) => pattern.test(bare));
};

/** How many requests pass between two stirs: about a hundred. */
export const API_STIR_EVERY: readonly [number, number] = [70, 130];
/** How many AI answers: six to twelve. */
export const AI_STIR_EVERY: readonly [number, number] = [6, 12];

export interface ActivityCounter {
  /** Count one request. Returns its kind when that kind's count came due. */
  note(kind: "api" | "ai"): "api" | "ai" | null;
}

/**
 * Two counts, each with its own random threshold, drawn again every time it
 * comes due, so the bird never keeps a rhythm anyone could learn.
 */
export function createActivityCounter(rng: Rng): ActivityCounter {
  const due = {
    api: between(rng, ...API_STIR_EVERY),
    ai: between(rng, ...AI_STIR_EVERY),
  };
  const seen = { api: 0, ai: 0 };
  return {
    note(kind) {
      seen[kind] += 1;
      if (seen[kind] < due[kind]) return null;
      seen[kind] = 0;
      due[kind] = between(
        rng,
        ...(kind === "ai" ? AI_STIR_EVERY : API_STIR_EVERY),
      );
      return kind;
    },
  };
}

/** A stir at most this often, in ms, however busy the app is. */
export const STIR_GAP = 20_000;
/** A flight of its own at most this often. */
export const SORTIE_GAP = 180_000;
/** How often a stir is a short flight rather than an act on the perch. */
export const SORTIE_CHANCE = { api: 0.15, ai: 0.35 } as const;

let counter = createActivityCounter(Math.random);
let lastStir = -Infinity;
let lastSortie = -Infinity;

/** For tests: start counting again, with this random source. */
export function resetCorvidActivity(rng: Rng = Math.random): void {
  counter = createActivityCounter(rng);
  lastStir = -Infinity;
  lastSortie = -Infinity;
  lastReaction.clear();
}

/** Whether a dialog, a menu or the palette is open over the page. */
export function overlayIsOpen(): boolean {
  if (typeof document === "undefined") return true;
  return !!document.querySelector(
    '[role="dialog"], [role="menu"], [cmdk-dialog]',
  );
}

/**
 * Whether the page is in no state for a bird to cross it: a dialog, a menu or
 * the palette is open, or the person is typing in a field.
 */
export function pageIsBusy(): boolean {
  if (typeof document === "undefined") return true;
  if (overlayIsOpen()) return true;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return (
    active.isContentEditable ||
    active.tagName === "INPUT" ||
    active.tagName === "TEXTAREA" ||
    active.tagName === "SELECT"
  );
}

/**
 * Count one finished request. `apiFetch` calls this for every response that
 * came back OK. Almost always it only counts. When the bird is stirred, it is
 * told after the request has gone back to its caller, never on the way.
 */
export function noteCorvidActivity(path: string): void {
  if (typeof window === "undefined") return;
  const crossed = counter.note(isAiPath(path) ? "ai" : "api");
  if (!crossed) return;
  const now = performance.now();
  if (now - lastStir < STIR_GAP || document.hidden) return;
  lastStir = now;
  const sortie =
    !pageIsBusy() &&
    now - lastSortie >= SORTIE_GAP &&
    Math.random() < SORTIE_CHANCE[crossed];
  if (sortie) lastSortie = now;
  setTimeout(() => {
    if (sortie) flyCorvid({ kind: "sortie" });
    else emit(CORVID_STIR_EVENT);
  }, 0);
}

/** How long a celebration waits for a dialog to close before it lets go. */
export const CELEBRATION_WAIT = 20_000;

/**
 * Ask for a flight the page can see: at once, or as soon as no dialog, menu
 * or palette covers the page. An import finishes inside its dialog, and a
 * celebration flown behind the dialog's backdrop is a celebration nobody
 * sees, with the sidebar's ring empty meanwhile. If the page is still
 * covered after twenty seconds, the moment has passed and nothing flies.
 */
export function flyWhenClear(detail: Partial<CorvidFlyDetail> = {}): void {
  if (typeof window === "undefined") return;
  if (!overlayIsOpen()) {
    flyCorvid(detail);
    return;
  }
  const until = performance.now() + CELEBRATION_WAIT;
  const check = () => {
    if (!overlayIsOpen()) flyCorvid(detail);
    else if (performance.now() < until) setTimeout(check, 400);
  };
  setTimeout(check, 400);
}

// ---------------------------------------------------------------------------
// The level
// ---------------------------------------------------------------------------

/** How much the corvid is allowed to move, once every input has had its say. */
export type MotionLevel = MascotMotion;

/**
 * What the bird may do, from the account's choice and the two ways a person
 * can ask for less motion.
 *
 * Either reduced input wins over the preference. Someone who turned reduced
 * motion on in their operating system did not turn it on for every app except
 * this one, and the Appearance page says so under the row.
 */
export function motionLevel(
  mascotMotion: MascotMotion,
  prefersReducedMotion: boolean,
  motionPreference: MotionPreference = "system",
): MotionLevel {
  if (prefersReducedMotion) return "off";
  if (motionPreference === "reduced") return "off";
  return mascotMotion;
}
