// @vitest-environment jsdom
/**
 * The corvid noticing the app at work.
 *
 * `apiFetch` counts every request that comes back OK. About once a hundred,
 * or every six to twelve AI answers, the bird does something of its own. The
 * rules that keep that from ever getting in the way are the ones measured:
 *
 * - A model's request is told apart by its path, the same list the server's
 *   AI limiter uses.
 * - The counts come due at random, within their ranges, once per crossing.
 * - At most one stir every twenty seconds, however busy the app is.
 * - A flight of its own only when nothing is open and no field has focus,
 *   and at most one every three minutes.
 * - A reaction repeated in quick succession plays once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_STIR_EVERY,
  API_STIR_EVERY,
  CELEBRATION_WAIT,
  CORVID_FLY_EVENT,
  CORVID_REACT_EVENT,
  CORVID_STIR_EVENT,
  REACTION_GAP,
  SORTIE_GAP,
  STIR_GAP,
  corvidReact,
  createActivityCounter,
  flyWhenClear,
  isAiPath,
  noteCorvidActivity,
  pageIsBusy,
  resetCorvidActivity,
} from "../../src/lib/corvid";
import { createRng } from "../../src/lib/corvidMotion";

const heard = { fly: [] as unknown[], stir: 0, react: [] as unknown[] };
/** The bird is told after the request returns, on the next turn. */
const tick = () => vi.advanceTimersByTime(1);
const onFly = (e: Event) => heard.fly.push((e as CustomEvent).detail);
const onStir = () => (heard.stir += 1);
const onReact = (e: Event) => heard.react.push((e as CustomEvent).detail);

beforeEach(() => {
  vi.useFakeTimers();
  heard.fly = [];
  heard.stir = 0;
  heard.react = [];
  window.addEventListener(CORVID_FLY_EVENT, onFly);
  window.addEventListener(CORVID_STIR_EVENT, onStir);
  window.addEventListener(CORVID_REACT_EVENT, onReact);
});

afterEach(() => {
  window.removeEventListener(CORVID_FLY_EVENT, onFly);
  window.removeEventListener(CORVID_STIR_EVENT, onStir);
  window.removeEventListener(CORVID_REACT_EVENT, onReact);
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetCorvidActivity();
});

describe("which requests a model answers", () => {
  it("knows the AI endpoints, whatever the case and the query", () => {
    for (const path of [
      "/search/semantic",
      "/search/synthesize",
      "/parse-contact",
      "/contacts/abc/enrich",
      "/contacts/abc/briefing",
      "/ai-search",
      "/dedupe/scan",
      "/dashboard/insight?fresh=1",
      "/Dashboard/Insight",
    ]) {
      expect(isAiPath(path), path).toBe(true);
    }
  });

  it("does not count the rest, nor the AI batch's status", () => {
    for (const path of [
      "/contacts",
      "/contacts/abc",
      "/ai-search/status",
      "/link-preview",
      "/search/interactions",
    ]) {
      expect(isAiPath(path), path).toBe(false);
    }
  });
});

describe("the counts", () => {
  it("come due within their ranges, at a different count each time", () => {
    const counter = createActivityCounter(createRng(3));
    const gaps = { api: [] as number[], ai: [] as number[] };
    for (const kind of ["api", "ai"] as const) {
      let since = 0;
      for (let i = 0; i < 5_000; i++) {
        since += 1;
        if (counter.note(kind) === kind) {
          gaps[kind].push(since);
          since = 0;
        }
      }
    }
    for (const gap of gaps.api) {
      expect(gap).toBeGreaterThanOrEqual(Math.ceil(API_STIR_EVERY[0]));
      expect(gap).toBeLessThanOrEqual(Math.ceil(API_STIR_EVERY[1]));
    }
    for (const gap of gaps.ai) {
      expect(gap).toBeGreaterThanOrEqual(Math.ceil(AI_STIR_EVERY[0]));
      expect(gap).toBeLessThanOrEqual(Math.ceil(AI_STIR_EVERY[1]));
    }
    expect(new Set(gaps.api).size).toBeGreaterThan(10);
  });

  it("keeps the two apart: AI answers do not hurry the request count", () => {
    const counter = createActivityCounter(createRng(1));
    for (let i = 0; i < 60; i++) expect(counter.note("api")).toBeNull();
    for (let i = 0; i < 5; i++) expect(counter.note("ai")).toBeNull();
  });
});

describe("noticing", () => {
  it("stirs the bird about once a hundred requests, and never twice in twenty seconds", () => {
    resetCorvidActivity(createRng(8));
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    for (let i = 0; i < 130; i++) noteCorvidActivity("/contacts");
    tick();
    expect(heard.stir).toBe(1);
    // Another hundred and thirty at once: the gap holds.
    for (let i = 0; i < 130; i++) noteCorvidActivity("/contacts");
    tick();
    expect(heard.stir).toBe(1);
    vi.advanceTimersByTime(STIR_GAP);
    for (let i = 0; i < 130; i++) noteCorvidActivity("/contacts");
    tick();
    expect(heard.stir).toBe(2);
    expect(heard.fly).toEqual([]);
  });

  it("goes for a short flight now and then, when nothing is in the way", () => {
    resetCorvidActivity(createRng(8));
    vi.spyOn(Math, "random").mockReturnValue(0);
    for (let i = 0; i < 12; i++) noteCorvidActivity("/search/semantic");
    tick();
    expect(heard.fly).toEqual([
      { kind: "sortie", perch: undefined, from: undefined },
    ]);
    // Not again for three minutes: the next due count is a stir instead.
    vi.advanceTimersByTime(STIR_GAP);
    for (let i = 0; i < 12; i++) noteCorvidActivity("/search/semantic");
    tick();
    expect(heard.fly).toHaveLength(1);
    expect(heard.stir).toBe(1);
    vi.advanceTimersByTime(SORTIE_GAP);
    for (let i = 0; i < 12; i++) noteCorvidActivity("/search/semantic");
    tick();
    expect(heard.fly).toHaveLength(2);
  });

  it("never flies while a dialog is open or a field has focus", () => {
    resetCorvidActivity(createRng(8));
    vi.spyOn(Math, "random").mockReturnValue(0);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(pageIsBusy()).toBe(true);
    for (let i = 0; i < 12; i++) noteCorvidActivity("/search/semantic");
    tick();
    expect(heard.fly).toEqual([]);
    expect(heard.stir).toBe(1);

    dialog.remove();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    expect(pageIsBusy()).toBe(true);
    vi.advanceTimersByTime(SORTIE_GAP);
    for (let i = 0; i < 12; i++) noteCorvidActivity("/search/semantic");
    tick();
    expect(heard.fly).toEqual([]);
  });

  it("holds still while the tab is hidden", () => {
    resetCorvidActivity(createRng(8));
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    for (let i = 0; i < 300; i++) noteCorvidActivity("/contacts");
    tick();
    expect(heard.stir).toBe(0);
    expect(heard.fly).toEqual([]);
  });
});

describe("telling the bird", () => {
  it("waits until the request is back with its caller", () => {
    resetCorvidActivity(createRng(8));
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    let crossedAt = -1;
    for (let i = 0; i < 130 && crossedAt < 0; i++) {
      noteCorvidActivity("/contacts");
      if (vi.getTimerCount() > 0) crossedAt = i;
    }
    expect(crossedAt).toBeGreaterThanOrEqual(0);
    // Nothing yet: the stir goes out on the next turn, not on the way.
    expect(heard.stir).toBe(0);
    tick();
    expect(heard.stir).toBe(1);
  });
});

describe("a celebration", () => {
  it("flies at once when nothing covers the page", () => {
    flyWhenClear({ kind: "swoop" });
    expect(heard.fly).toEqual([
      { kind: "swoop", perch: undefined, from: undefined },
    ]);
  });

  it("waits for a dialog to close, then flies", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    flyWhenClear({ kind: "swoop" });
    vi.advanceTimersByTime(2_000);
    expect(heard.fly).toEqual([]);
    dialog.remove();
    vi.advanceTimersByTime(500);
    expect(heard.fly).toHaveLength(1);
  });

  it("lets the moment pass if the dialog stays open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    flyWhenClear({ kind: "swoop" });
    vi.advanceTimersByTime(CELEBRATION_WAIT + 1_000);
    dialog.remove();
    vi.advanceTimersByTime(5_000);
    expect(heard.fly).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("reactions", () => {
  it("plays a repeat once in quick succession, and again after the gap", () => {
    corvidReact("nod");
    corvidReact("nod");
    corvidReact("nod");
    expect(heard.react).toHaveLength(1);
    corvidReact("hop");
    expect(heard.react).toHaveLength(2);
    vi.advanceTimersByTime(REACTION_GAP);
    corvidReact("nod");
    expect(heard.react).toHaveLength(3);
  });

  it("always passes one addressed to a perch", () => {
    const perch = document.createElement("span");
    corvidReact("flutter", perch);
    corvidReact("flutter", perch);
    expect(heard.react).toEqual([
      { reaction: "flutter", target: perch },
      { reaction: "flutter", target: perch },
    ]);
  });
});
