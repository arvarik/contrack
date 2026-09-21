// @vitest-environment jsdom
// =============================================================================
// ScoreRingAvatar: the ring around an avatar shows the relationship score
// =============================================================================
// The ring used to be the contact's theme colour, and people read a red ring
// as trouble. It now says one thing. The arc length is the score, the colour
// is the band from shared/scoreBand, and the words say the same so colour is
// never the only sign.
//
// A score belongs to a contact somebody tracks. So the ring has three states,
// and `scoreView` decides between them: no ring at all for a contact nobody
// tracks, the empty track for a tracked contact with nothing logged, and the
// arc for a tracked contact with a score.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  RING_WIDTH,
  ScoreRingAvatar,
  type ScoreRingAvatarProps,
} from "../../src/components/ScoreRingAvatar";

afterEach(() => {
  cleanup();
});

/** A contact last seen in September, so the stored score counts. */
function person(
  overrides: Partial<ScoreRingAvatarProps["contact"]> = {},
): ScoreRingAvatarProps["contact"] {
  return {
    name: "Betty Clark",
    avatarUrl: null,
    isTracked: true,
    relationshipScore: 72,
    lastContactedAt: "2026-09-10T05:33:50.000Z",
    ...overrides,
  };
}

function mount(props: Partial<ScoreRingAvatarProps> = {}) {
  const { container } = render(
    <ScoreRingAvatar contact={person()} size={48} {...props} />,
  );
  const root = container.firstElementChild as HTMLElement;
  return {
    root,
    arc: container.querySelector<SVGCircleElement>("[data-ring-arc]"),
    circles: Array.from(container.querySelectorAll("circle")),
    svg: container.querySelector("svg"),
    picture: container.querySelector("img")!.parentElement as HTMLElement,
  };
}

describe("the arc", () => {
  it("draws the score as a share of the circle", () => {
    const { arc } = mount();
    expect(arc).not.toBeNull();
    // A 48 px ring with a 2 px stroke has a radius of 22.
    const circumference = 2 * Math.PI * (48 / 2 - RING_WIDTH.list);
    expect(Number(arc!.getAttribute("stroke-dasharray"))).toBeCloseTo(
      circumference,
      6,
    );
    expect(Number(arc!.getAttribute("stroke-dashoffset"))).toBeCloseTo(
      circumference * (1 - 72 / 100),
      6,
    );
  });

  it.each([
    [100, "success"],
    [70, "success"],
    [69, "warning"],
    [40, "warning"],
    [39, "error"],
    [5, "error"],
  ])("colours a score of %i with the %s token", (score, token) => {
    const { arc, root } = mount({
      contact: person({ relationshipScore: score }),
    });
    expect(arc!.getAttribute("stroke")).toBe(`var(--color-${token})`);
    expect(root.getAttribute("data-score-band")).toBe(
      { success: "strong", warning: "fading", error: "at-risk" }[token],
    );
  });

  it("draws no arc and says so when there is no logged interaction", () => {
    // The column defaults to 50, so a never-contacted person still carries a
    // score. It is a placeholder, not a judgement.
    const { arc, circles, root } = mount({
      contact: person({ relationshipScore: 50, lastContactedAt: null }),
    });
    expect(arc).toBeNull();
    // The track still shows, so the ring reads as empty and not missing.
    expect(circles).toHaveLength(1);
    expect(root.getAttribute("data-score-band")).toBe("unscored");
    const ring = screen.getByRole("img", { name: "No interactions yet" });
    expect(ring.getAttribute("title")).toBe("No interactions yet");
  });

  it("draws no arc for a score of 0 but still says the score", () => {
    const { arc } = mount({ contact: person({ relationshipScore: 0 }) });
    expect(arc).toBeNull();
    expect(screen.getByRole("img", { name: "Score 0, at risk" })).toBeDefined();
  });
});

describe("a contact nobody tracks", () => {
  it("draws no ring at all, not even the track", () => {
    // An empty ring reads as a bad score. A person who never asked to keep
    // up with this contact is told nothing, and sees the picture.
    const { arc, circles, svg } = mount({
      contact: person({ isTracked: false }),
    });
    expect(arc).toBeNull();
    expect(circles).toHaveLength(0);
    expect(svg).toBeNull();
  });

  it("says nothing, and is hidden from a screen reader", () => {
    const { root } = mount({ contact: person({ isTracked: false }) });
    expect(screen.queryByRole("img")).toBeNull();
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.hasAttribute("title")).toBe(false);
    expect(root.getAttribute("data-score-band")).toBe("untracked");
  });

  it("gives the whole box to the picture", () => {
    // With a ring the picture is inset by two strokes on each side. Without
    // one it fills the box, so a list of faces stays a list of faces.
    const withRing = mount().picture;
    expect(withRing.style.width).toBe(`${48 - RING_WIDTH.list * 4}px`);
    cleanup();

    const plain = mount({ contact: person({ isTracked: false }) }).picture;
    expect(plain.style.width).toBe("48px");
    expect(plain.style.height).toBe("48px");
  });
});

describe("the words", () => {
  it("names the ring and gives it the same tooltip", () => {
    mount();
    const ring = screen.getByRole("img", { name: "Score 72, strong" });
    expect(ring.getAttribute("title")).toBe("Score 72, strong");
    // The picture says nothing more, because the name is printed beside it.
    expect(ring.querySelector("img")!.getAttribute("alt")).toBe("");
    expect(ring.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("hides the ring and drops the tooltip when it is decorative", () => {
    const { root } = mount({ decorative: true });
    expect(screen.queryByRole("img")).toBeNull();
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.hasAttribute("title")).toBe(false);
    expect(root.hasAttribute("aria-label")).toBe(false);
  });
});

describe("the size", () => {
  it("draws a 3.5 px ring in the header and a 2 px ring in a list", () => {
    const header = mount({ ring: "header" });
    for (const circle of header.circles) {
      expect(circle.getAttribute("stroke-width")).toBe("3.5");
    }
    cleanup();

    const list = mount({ ring: "list" });
    for (const circle of list.circles) {
      expect(circle.getAttribute("stroke-width")).toBe("2");
    }
  });
});

describe("the tint behind the picture", () => {
  it("shows a photo on no tint", () => {
    const { picture } = mount({
      contact: person({ avatarUrl: "https://example.com/betty.jpg" }),
    });
    expect(picture.className).not.toContain("bg-surface-container-highest");
  });

  it("puts a drawn avatar on the tint", () => {
    const { picture } = mount({
      contact: person({ avatarUrl: "/api/avatar/avataaars?seed=Betty" }),
    });
    expect(picture.className).toContain("bg-surface-container-highest");
  });

  it("puts the fallback on the tint when there is no avatar at all", () => {
    const { picture } = mount({ contact: person({ avatarUrl: null }) });
    expect(picture.className).toContain("bg-surface-container-highest");
    expect(picture.querySelector("img")!.getAttribute("src")).toMatch(
      /^\/api\/avatar\//,
    );
  });
});
