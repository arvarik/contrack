// @vitest-environment jsdom
// =============================================================================
// VirtualRows: a long list draws only the rows near the screen
// =============================================================================
// The Duplicates picker and the Enrichment list drew all 5,824 contacts, and
// the Manual merge tab took 44 s to show. Up to 200 rows the list is plain;
// past that it draws what the virtualizer asks for in the nearest scroller.
// jsdom has no layout, so the virtualizer is replaced by one that asks for
// the first ten rows and records the options it was given.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const virtualizer = vi.hoisted(() => ({
  options: [] as Array<Record<string, unknown>>,
}));
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (options: Record<string, unknown>) => {
      virtualizer.options.push(options);
      const count = options.enabled ? (options.count as number) : 0;
      return {
        getTotalSize: () => count * 50,
        getVirtualItems: () =>
          Array.from({ length: Math.min(count, 10) }, (_, index) => ({
            index,
            key: `row-${index}`,
            start: (options.scrollMargin as number) + index * 50,
            size: 50,
            end: (options.scrollMargin as number) + (index + 1) * 50,
          })),
        measureElement: () => undefined,
      };
    },
  };
});

import {
  VIRTUAL_ROWS,
  VirtualRows,
} from "../../../../src/components/ui/VirtualRows";

const items = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Contact ${i}`,
  }));

const list = (count: number, gap?: number) => (
  <VirtualRows
    items={items(count)}
    getKey={(item) => item.id}
    estimateSize={64}
    gap={gap}
    renderRow={(item) => <p data-testid="row">{item.name}</p>}
  />
);

afterEach(() => {
  cleanup();
  virtualizer.options.length = 0;
});

describe("VirtualRows", () => {
  it("draws every row, in order, up to the limit", () => {
    render(list(VIRTUAL_ROWS, 4));
    const rows = screen.getAllByTestId("row");
    expect(rows).toHaveLength(VIRTUAL_ROWS);
    expect(rows[0].textContent).toBe("Contact 0");
    expect(rows.at(-1)!.textContent).toBe(`Contact ${VIRTUAL_ROWS - 1}`);
    // The gap is a flex gap: a margin moves a placed row and not the next.
    expect(rows[0].parentElement!.style.gap).toBe("4px");
  });

  it("past the limit, draws only the rows the virtualizer asks for, in the nearest scroller", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    scroller.scrollTop = 0;
    document.body.appendChild(scroller);
    render(list(5_824, 4), { container: scroller });

    const rows = screen.getAllByTestId("row");
    expect(rows).toHaveLength(10);
    const options = virtualizer.options.at(-1)!;
    expect(options.enabled).toBe(true);
    expect(options.count).toBe(5_824);
    expect(options.gap).toBe(4);
    expect((options.getScrollElement as () => unknown)()).toBe(scroller);
    expect((options.estimateSize as () => number)()).toBe(64);
    expect((options.getItemKey as (i: number) => string)(7)).toBe("c7");
    // The box keeps the whole list's height, so the scrollbar is true.
    const box = rows[0].parentElement!.parentElement!;
    expect(box.style.height).toBe(`${5_824 * 50}px`);
    // Each row is placed by its start, less the list's own offset.
    expect(rows[1].parentElement!.style.transform).toBe("translateY(50px)");
    scroller.remove();
  });

  it("starts from where the scroller already is", () => {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    document.body.appendChild(scroller);
    render(list(300), { container: scroller });
    scroller.scrollTop = 1_234;
    const options = virtualizer.options.at(-1)!;
    expect((options.initialOffset as () => number)()).toBe(1_234);
    scroller.remove();
  });

  it("is a plain list again when nothing around it scrolls", () => {
    render(list(250));
    expect(screen.getAllByTestId("row")).toHaveLength(250);
  });
});
