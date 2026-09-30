// @vitest-environment jsdom
// =============================================================================
// The sidebar marks the page a person pressed before that page can draw
// =============================================================================
// A navigation is a transition, so while the next page's code is on its way
// the last page stays up and the location keeps its old path. The sidebar and
// the tab bar read the pressed path from `lib/pendingNav`, in the same frame
// as the press.
// =============================================================================
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingNav,
  markPendingNav,
  markPendingNavOnClick,
  usePendingNav,
  useSettlePendingNav,
} from "../../../../src/lib/pendingNav";

afterEach(() => {
  clearPendingNav();
  window.history.replaceState(null, "", "/");
});

describe("pendingNav", () => {
  it("holds the pressed path until the page is on screen", () => {
    const { result } = renderHook(() => usePendingNav());
    expect(result.current).toBeNull();
    act(() => markPendingNav("/map"));
    expect(result.current).toBe("/map");
    act(() => clearPendingNav());
    expect(result.current).toBeNull();
  });

  it("keeps the path of a link that carries a query or a hash", () => {
    const { result } = renderHook(() => usePendingNav());
    act(() => markPendingNav("/pulse?tab=duplicates#top"));
    expect(result.current).toBe("/pulse");
  });

  it("does not render again for the same path", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return usePendingNav();
    });
    act(() => markPendingNav("/search"));
    const afterFirst = renders;
    act(() => markPendingNav("/search"));
    act(() => markPendingNav("/search?q=x"));
    expect(renders).toBe(afterFirst);
  });
});

describe("markPendingNavOnClick", () => {
  function Link() {
    return (
      <a
        href="/map"
        onClick={(event) => {
          markPendingNavOnClick("/map")(event);
          event.preventDefault();
        }}
      >
        Map
      </a>
    );
  }

  it("marks the page on a plain click", () => {
    const { result } = renderHook(() => usePendingNav());
    render(<Link />);
    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "Map" }));
    });
    expect(result.current).toBe("/map");
  });

  // A modified click opens the page in another tab or window, and this tab
  // stays where it is. A mark would be left on the wrong page.
  it.each([
    ["the command key", { metaKey: true }],
    ["the control key", { ctrlKey: true }],
    ["the shift key", { shiftKey: true }],
    ["the option key", { altKey: true }],
    ["the middle button", { button: 1 }],
  ])("marks nothing on a click with %s", (_name, init) => {
    const { result } = renderHook(() => usePendingNav());
    render(<Link />);
    act(() => {
      fireEvent.click(screen.getByRole("link", { name: "Map" }), init);
    });
    expect(result.current).toBeNull();
  });
});

// A mark that no location change clears would stay on the wrong page, and
// paint it for a frame on the next navigation that sets no mark.
describe("a mark that cannot stay behind", () => {
  it("marks nothing for the page already on screen", () => {
    window.history.replaceState(null, "", "/pulse");
    const { result } = renderHook(() => usePendingNav());
    act(() => markPendingNav("/pulse"));
    expect(result.current).toBeNull();
  });

  it("clears on Back or Forward, which can leave the location where it was", () => {
    const { result } = renderHook(() => usePendingNav());
    act(() => markPendingNav("/map"));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBeNull();
  });

  it("clears once a new location is on screen, even at the same path", () => {
    let go: (to: string) => void = () => {};
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={["/map"]}>{children}</MemoryRouter>
    );
    const { result } = renderHook(
      () => {
        useSettlePendingNav();
        const navigate = useNavigate();
        go = navigate;
        return usePendingNav();
      },
      { wrapper },
    );
    act(() => markPendingNav("/pulse"));
    expect(result.current).toBe("/pulse");
    act(() => go("/map"));
    expect(result.current).toBeNull();
  });
});
