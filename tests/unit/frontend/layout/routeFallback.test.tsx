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
  RouteFallback,
  type RouteFallbackVariant,
} from "../../../../src/components/layout/RouteFallback";

afterEach(cleanup);

describe("RouteFallback", () => {
  it.each<RouteFallbackVariant>(["pulse", "search", "settings", "map"])(
    "draws the %s silhouette",
    (variant) => {
      const { container } = render(<RouteFallback variant={variant} />);
      expect(container.querySelector(".animate-pulse")).toBeTruthy();
    },
  );
});
