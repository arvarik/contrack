// @vitest-environment jsdom
// ScoreBreakdown opens inside the window. On the contact header the ring sits
// at the pane's left edge, so the 288 px panel would run past the pane and be
// clipped. It opens in the browser's top layer, placed from the trigger by
// `usePanelPlacement`. jsdom has no layout, so the boxes are stubbed: a
// trigger 96 px wide at 24 px from the window's left edge, like the header
// ring.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ScoreBreakdown } from "../../../../src/components/ScoreBreakdown";

vi.mock("../../../../src/api/client", () => ({
  apiFetch: vi.fn(async () => ({
    json: async () => ({
      score: 72,
      components: [
        {
          key: "recency",
          label: "Recency",
          value: 80,
          weight: 0.3,
          detail: "Last spoke 9 days ago",
        },
      ],
    }),
  })),
}));

const PANEL_WIDTH = 288;
const PANEL_HEIGHT = 320;

/** A box, as `getBoundingClientRect` returns it. */
const box = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

type Popover = HTMLElement & { showPopover?: () => void };
const showPopover = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  (HTMLElement.prototype as Popover).showPopover = showPopover;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("role") === "dialog") {
        return box(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
      }
      if (this.tagName === "BUTTON") return box(24, 120, 96, 96);
      return box(0, 0, 0, 0);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // jsdom has no `showPopover` of its own, so the stub goes again.
  Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
  showPopover.mockClear();
});

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ScoreBreakdown contactId="c1" score={72}>
        <span>72</span>
      </ScoreBreakdown>
    </QueryClientProvider>,
  );
}

describe("the score breakdown panel", () => {
  it("opens in the top layer, inside the window, from a ring at the left edge", async () => {
    mount();
    fireEvent.click(
      screen.getByRole("button", { name: /Relationship score 72/ }),
    );

    // jsdom styles `[popover]` as hidden, and its stubbed `showPopover`
    // cannot open it, so the queries include hidden elements.
    const panel = screen.getByRole("dialog", { hidden: true });
    expect(panel.getAttribute("aria-label")).toBe(
      "How this score was calculated",
    );
    expect(panel.getAttribute("popover")).toBe("manual");
    expect(showPopover).toHaveBeenCalled();
    // Lined up with the trigger's right edge, it would start at
    // 24 + 96 - 288 = -168 px. It lines up with the left edge instead.
    expect(panel.style.left).toBe("24px");
    expect(panel.style.top).toBe(`${120 + 96 + 4}px`);

    await waitFor(() =>
      expect(panel.textContent).toContain("Last spoke 9 days ago"),
    );
  });

  it("closes on Escape and gives focus back to the ring", () => {
    mount();
    const trigger = screen.getByRole("button", {
      name: /Relationship score 72/,
    });
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { hidden: true });
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
