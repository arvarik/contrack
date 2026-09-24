// @vitest-environment jsdom
/**
 * The silhouettes a lazy route shows while its chunk downloads. Each one
 * mirrors its page, so the page lands once: these pin the parts this
 * release moved.
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  PulseHeaderSkeleton,
  RouteFallback,
  type RouteFallbackVariant,
} from "../../src/components/layout/RouteFallback";
import { ASK_COLUMN } from "../../src/lib/styles";

afterEach(cleanup);

describe("RouteFallback", () => {
  it.each<RouteFallbackVariant>(["pulse", "search", "settings", "map"])(
    "draws the %s silhouette",
    (variant) => {
      const { container } = render(<RouteFallback variant={variant} />);
      expect(container.querySelector(".animate-pulse")).toBeTruthy();
    },
  );

  it("draws Ask Contrack in the page's column, with the History button in the corner and no rail", () => {
    const { container } = render(<RouteFallback variant="search" />);
    const column = container.querySelector(".mx-auto")!;
    for (const name of ASK_COLUMN.split(" ")) {
      expect(column.classList.contains(name)).toBe(true);
    }
    // From lg the History button's square sits in the top-right corner,
    // over the page. No rail takes a lane of the layout, and no pane
    // pushes the column.
    expect(
      container.querySelector(".lg\\:block.absolute.right-4.w-10"),
    ).toBeTruthy();
    expect(container.querySelector(".lg\\:block.w-16")).toBeNull();
    expect(container.querySelector('[class*="w-[320px]"]')).toBeNull();
    // Below lg History is a header button.
    expect(container.querySelector(".lg\\:hidden")).toBeTruthy();
  });

  it("draws Pulse's masthead without the Ask field under it", () => {
    const { container } = render(<PulseHeaderSkeleton />);
    // The title, the day and the sentence, and Log note and More: no row
    // of an input and a button under them.
    expect(container.querySelector(".max-w-xl")).toBeNull();
  });
});
