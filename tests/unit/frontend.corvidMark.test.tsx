// @vitest-environment jsdom
/**
 * The corvid in the app.
 *
 * What every surface relies on: the mark is silent to a screen reader unless
 * asked to speak, it never takes focus, its eye wears the token rather than
 * the stroke, the glyph drops the chest and the tail, and two birds on one
 * page do not share an id.
 *
 * The motion phase added two more: every part carries `data-part`, which is
 * what the shared keyframes select on, and `idle` starts the blink timer.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CorvidMark } from "../../src/components/brand/CorvidMark";
import { CorvidTile } from "../../src/components/brand/CorvidTile";
import { Wordmark } from "../../src/components/brand/Wordmark";
import {
  CORVID_PART_ORDER,
  GLYPH_PARTS,
  GLYPH_STROKE,
  MARK_STROKE,
  TILE,
} from "../../src/assets/corvidPaths";
import {
  BLINK_CLASS,
  IDLE_MAX_MS,
  IDLE_MIN_MS,
  IDLE_MIN_SIZE,
} from "../../src/hooks/useCorvidIdle";

afterEach(() => {
  cleanup();
});

const svgOf = (container: HTMLElement) => container.querySelector("svg")!;

describe("CorvidMark", () => {
  it("is hidden from assistive tech and never focusable by default", () => {
    const { container } = render(<CorvidMark />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBeNull();
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.getAttribute("tabindex")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("names itself Contrack when it is not decorative", () => {
    const { container } = render(<CorvidMark decorative={false} />);
    expect(screen.getByRole("img", { name: "Contrack" })).toBeTruthy();
    expect(svgOf(container).getAttribute("aria-hidden")).toBeNull();
  });

  it("sizes both dimensions from one prop and takes a title", () => {
    const { container } = render(<CorvidMark size={40} title="Contrack" />);
    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(svg.querySelector("title")?.textContent).toBe("Contrack");
  });

  it("strokes the parts with currentColor and fills the eye with the token", () => {
    const { container } = render(<CorvidMark />);
    const svg = svgOf(container);
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke-width")).toBe(String(MARK_STROKE));
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    const eye = svg.querySelector("circle")!;
    expect(eye.getAttribute("fill")).toBe("var(--color-corvid-eye)");
    expect(eye.getAttribute("stroke")).toBe("none");
  });

  it("draws every part with an id from the prefix", () => {
    render(<CorvidMark idPrefix="corvid" />);
    for (const part of CORVID_PART_ORDER) {
      expect(document.getElementById(`corvid-${part}`)?.tagName).toBe("path");
    }
    expect(document.getElementById("corvid-eye")?.tagName).toBe("circle");
  });

  it("gives two marks on one page different ids", () => {
    const { container } = render(
      <>
        <CorvidMark />
        <CorvidMark />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(ids.length).toBe(2 * (CORVID_PART_ORDER.length + 1));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(/^corvid-[A-Za-z0-9_-]+-[a-z0-9]+$/);
  });

  it("marks every part and the eye with data-part", () => {
    const { container } = render(<CorvidMark />);
    const svg = svgOf(container);
    const parts = [...svg.querySelectorAll("[data-part]")].map((el) =>
      el.getAttribute("data-part"),
    );
    expect(parts).toEqual([...CORVID_PART_ORDER, "eye"]);
    // The keyframes reach the wing and the eye through this attribute,
    // because an id is unique per instance and cannot be in a stylesheet.
    expect(svg.querySelector('[data-part="wing"]')?.tagName).toBe("path");
    expect(svg.querySelector('[data-part="eye"]')?.tagName).toBe("circle");
  });

  it("omits the chest and the tail in the glyph, at the heavier stroke", () => {
    const { container } = render(<CorvidMark variant="glyph" idPrefix="g" />);
    const svg = svgOf(container);
    expect(svg.querySelectorAll("path")).toHaveLength(GLYPH_PARTS.length);
    for (const part of GLYPH_PARTS) {
      expect(document.getElementById(`g-${part}`)).toBeTruthy();
    }
    expect(document.getElementById("g-chest")).toBeNull();
    expect(document.getElementById("g-tail1")).toBeNull();
    expect(document.getElementById("g-tail2")).toBeNull();
    expect(svg.getAttribute("stroke-width")).toBe(String(GLYPH_STROKE));
    expect(svg.getAttribute("data-variant")).toBe("glyph");
  });
});

describe("CorvidMark, idling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("holds still by default", () => {
    render(<CorvidMark size={32} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("blinks when asked, on the eye the keyframe selects", () => {
    const { container } = render(<CorvidMark size={32} idle />);
    const svg = svgOf(container);
    expect(svg.classList.contains(BLINK_CLASS)).toBe(false);

    act(() => {
      vi.advanceTimersByTime(IDLE_MIN_MS + 0.5 * (IDLE_MAX_MS - IDLE_MIN_MS));
    });
    expect(svg.classList.contains(BLINK_CLASS)).toBe(true);
    expect(svg.querySelector('[data-part="eye"]')).toBeTruthy();
  });

  it("does not idle at a size where a blink would be invisible", () => {
    render(<CorvidMark size={IDLE_MIN_SIZE - 1} idle />);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("CorvidTile", () => {
  it("draws the white glyph on the gradient tile in fixed colours", () => {
    const { container } = render(<CorvidTile size={24} />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.querySelector("rect")?.getAttribute("rx")).toBe(
      String(TILE.radius),
    );
    const group = svg.querySelector("g")!;
    expect(group.getAttribute("stroke")).toBe(TILE.ink);
    expect(group.getAttribute("transform")).toMatch(
      /^translate\([\d.]+ [\d.]+\) scale\([\d.]+\)$/,
    );
    expect(svg.querySelectorAll("path")).toHaveLength(GLYPH_PARTS.length);
    expect(svg.querySelector("circle")?.getAttribute("fill")).toBe(TILE.eye);
    expect(container.innerHTML).not.toContain("var(");
  });

  it("uses a gradient id of its own for each instance", () => {
    const { container } = render(
      <>
        <CorvidTile />
        <CorvidTile />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map(
      (el) => el.id,
    );
    expect(new Set(ids).size).toBe(2);
    const fills = [...container.querySelectorAll("rect")].map((el) =>
      el.getAttribute("fill"),
    );
    expect(fills).toEqual(ids.map((id) => `url(#${id})`));
  });
});

describe("Wordmark", () => {
  it("shows the mark beside the name", () => {
    const { container } = render(<Wordmark />);
    expect(screen.getByText("Contrack")).toBeTruthy();
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });
});
