// @vitest-environment jsdom
/**
 * The two measurements the contact page lays itself out by.
 *
 * `useElementWidth` picks the wide or the narrow layout from the pane's own
 * width. `useFitsHeight` keeps the Details column sticky only while it fits
 * the view. jsdom lays nothing out, so each test gives the elements their
 * sizes and drives a stand-in ResizeObserver by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useCallback, useState } from "react";
import {
  useElementWidth,
  useElementWidthAtLeast,
} from "../../src/hooks/useElementWidth";
import { useFitsHeight } from "../../src/hooks/useFitsHeight";

/** Every observer made during a test, so a test can call it. */
let observers: {
  callback: ResizeObserverCallback;
  targets: Element[];
  disconnected: boolean;
}[] = [];

class FakeResizeObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: ResizeObserverCallback) {
    this.record = { callback, targets: [], disconnected: false };
    observers.push(this.record);
  }
  observe(target: Element) {
    this.record.targets.push(target);
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

/** Give an element a fixed box, as a browser would after layout. */
function sized(el: HTMLElement, width: number, height: number) {
  el.getBoundingClientRect = () => new DOMRect(0, 0, width, height);
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => height,
  });
}

/** Call every live observer, as a browser does after a resize. */
function resize(width: number) {
  act(() => {
    for (const observer of observers.filter((o) => !o.disconnected)) {
      observer.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
    }
  });
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useElementWidth", () => {
  const Probe = ({ width }: { width: number }) => {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const measured = useElementWidth(el);
    return (
      <div
        ref={(node) => {
          if (node) sized(node, width, 10);
          setEl(node);
        }}
        data-testid="probe"
      >
        {measured === null ? "none" : String(measured)}
      </div>
    );
  };

  it("reads the width before paint, then follows the element", () => {
    const { getByTestId } = render(<Probe width={866} />);
    expect(getByTestId("probe").textContent).toBe("866");
    expect(observers).toHaveLength(1);

    resize(610);
    expect(getByTestId("probe").textContent).toBe("610");
  });

  it("stops watching when the element goes", () => {
    const { unmount } = render(<Probe width={500} />);
    unmount();
    expect(observers.every((o) => o.disconnected)).toBe(true);
  });

  it("returns null with nothing to measure, and one reading without an observer", () => {
    const Empty = () => <p>{String(useElementWidth(null))}</p>;
    const { container } = render(<Empty />);
    expect(container.textContent).toBe("null");

    cleanup();
    vi.stubGlobal("ResizeObserver", undefined);
    const { getByTestId } = render(<Probe width={900} />);
    expect(getByTestId("probe").textContent).toBe("900");
  });
});

describe("useElementWidthAtLeast", () => {
  let renders = 0;
  const Probe = ({ width }: { width: number }) => {
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const wide = useElementWidthAtLeast(el, 768);
    renders += 1;
    // A stable ref, so a render does not detach and attach the element,
    // which would add a render of its own to the count.
    const measure = useCallback(
      (node: HTMLDivElement | null) => {
        if (node) sized(node, width, 10);
        setEl(node);
      },
      [width],
    );
    return (
      <div ref={measure} data-testid="probe">
        {wide === null ? "none" : String(wide)}
      </div>
    );
  };

  it("renders again only when the width crosses the line", () => {
    renders = 0;
    const { getByTestId } = render(<Probe width={900} />);
    expect(getByTestId("probe").textContent).toBe("true");
    const beforeDrag = renders;

    // A drag: five widths on the same side of 768 px. A kept width rendered
    // five times. React may call the component once to see that nothing
    // changed, and then it skips it and its children.
    for (const width of [880, 850, 820, 790, 768]) resize(width);
    expect(getByTestId("probe").textContent).toBe("true");
    expect(renders - beforeDrag).toBeLessThanOrEqual(1);

    const beforeCrossing = renders;
    resize(767);
    expect(getByTestId("probe").textContent).toBe("false");
    expect(renders).toBe(beforeCrossing + 1);
  });
});

describe("useFitsHeight", () => {
  const Column = ({
    column,
    view,
    margin,
  }: {
    column: number;
    view: number;
    margin: number;
  }) => {
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
    const [el, setEl] = useState<HTMLDivElement | null>(null);
    const fits = useFitsHeight(el, scroller, margin);
    return (
      <div
        ref={(node) => {
          if (node) sized(node, 800, view);
          setScroller(node);
        }}
      >
        <div
          ref={(node) => {
            if (node) sized(node, 300, column);
            setEl(node);
          }}
          data-testid="column"
          data-fits={String(fits)}
        />
      </div>
    );
  };

  it("fits when the column and its margin are no taller than the view", () => {
    const { getByTestId } = render(
      <Column column={652} view={700} margin={48} />,
    );
    expect(getByTestId("column").dataset.fits).toBe("true");
    // It watches both boxes.
    expect(observers[0]?.targets).toHaveLength(2);
  });

  it("does not fit when the column is taller, and answers again on a resize", () => {
    const { getByTestId } = render(
      <Column column={900} view={700} margin={48} />,
    );
    const column = getByTestId("column");
    expect(column.dataset.fits).toBe("false");

    // The column loses a field and fits again.
    sized(column, 300, 400);
    resize(300);
    expect(column.dataset.fits).toBe("true");
  });

  it("says it fits while either element is missing", () => {
    const Missing = () => <p>{String(useFitsHeight(null, null))}</p>;
    const { container } = render(<Missing />);
    expect(container.textContent).toBe("true");
  });
});
