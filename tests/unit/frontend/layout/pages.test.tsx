// @vitest-environment jsdom
// =============================================================================
// The lazy pages start loading before their link is pressed
// =============================================================================
// Map, Pulse and Ask Contrack are each their own chunk. A first visit showed
// a skeleton for 300 ms even when the chunk took 5 ms, and Pulse then showed
// its own skeleton while its data arrived. `views/pages.ts` loads the code in
// idle moments and when a link is pointed at, and Pulse's data with it.
// These tests pin what is loaded, when, and in what order.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const idle = vi.hoisted(() => ({
  tasks: [] as Array<() => void>,
  cancelled: 0,
}));
vi.mock("../../../../src/lib/idle", () => ({
  whenIdle: (task: () => void) => {
    idle.tasks.push(task);
    return () => {
      idle.cancelled += 1;
      const index = idle.tasks.indexOf(task);
      if (index >= 0) idle.tasks.splice(index, 1);
    };
  },
}));

const prefetchPulse = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/api/dashboard", () => ({ prefetchPulse }));

// The real pages pull in MapLibre, which jsdom cannot run.
vi.mock("../../../../src/views/map", () => ({ MapView: () => <p>map</p> }));
vi.mock("../../../../src/views/pulse", () => ({
  PulseView: () => <p>pulse</p>,
}));
vi.mock("../../../../src/views/SearchView", () => ({
  SearchView: () => <p>ask</p>,
}));

import {
  askPage,
  mapPage,
  pageAt,
  pulsePage,
  usePageLinkWarm,
  warmPage,
  warmPages,
} from "../../../../src/views/pages";
import type { Preloadable } from "../../../../src/lib/preloadable";

/** Lets the promise chains that follow a load run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Runs the oldest idle task, as the browser would in its next idle moment. */
async function nextIdle() {
  const task = idle.tasks.shift();
  task?.();
  await flush();
}

/** A page whose load a test can watch. */
function fakePage(name: string, order: string[]) {
  const load = vi.fn(async () => {
    order.push(name);
    return { default: () => null };
  });
  return { load } as unknown as Preloadable<object>;
}

beforeEach(() => {
  idle.tasks.length = 0;
  idle.cancelled = 0;
  prefetchPulse.mockClear();
});

afterEach(cleanup);

describe("pageAt", () => {
  it("names the lazy page at each address, and none for the first bundle", () => {
    expect(pageAt("/map")).toBe(mapPage);
    expect(pageAt("/map/contact/c1")).toBe(mapPage);
    expect(pageAt("/pulse")).toBe(pulsePage);
    expect(pageAt("/pulse/duplicates")).toBe(pulsePage);
    expect(pageAt("/search")).toBe(askPage);
    expect(pageAt("/")).toBeNull();
    expect(pageAt("/contact/c1")).toBeNull();
    expect(pageAt("/settings")).toBeNull();
  });
});

describe("warmPage", () => {
  it("loads Pulse's code and starts its data", async () => {
    const client = new QueryClient();
    warmPage("/pulse", client);
    await flush();
    expect(pulsePage.loaded()).not.toBeNull();
    expect(prefetchPulse).toHaveBeenCalledWith(client);
  });

  it("loads the map's code and asks for no data", async () => {
    warmPage("/map", new QueryClient());
    await flush();
    expect(mapPage.loaded()).not.toBeNull();
    expect(prefetchPulse).not.toHaveBeenCalled();
  });

  it("loads only the code with no query client", async () => {
    warmPage("/pulse");
    await flush();
    expect(prefetchPulse).not.toHaveBeenCalled();
  });
});

describe("warmPages", () => {
  it("loads one page per idle moment, in order", async () => {
    const order: string[] = [];
    warmPages([
      fakePage("map", order),
      fakePage("pulse", order),
      fakePage("ask", order),
    ]);
    expect(order).toEqual([]);
    await nextIdle();
    expect(order).toEqual(["map"]);
    await nextIdle();
    await nextIdle();
    expect(order).toEqual(["map", "pulse", "ask"]);
    expect(idle.tasks).toHaveLength(0);
  });

  it("loads nothing more once stopped", async () => {
    const order: string[] = [];
    const stop = warmPages([fakePage("map", order), fakePage("pulse", order)]);
    await nextIdle();
    stop();
    await nextIdle();
    expect(order).toEqual(["map"]);
    expect(idle.cancelled).toBe(1);
  });

  it("goes on to the next page when a download fails", async () => {
    const order: string[] = [];
    const broken = {
      load: vi.fn(async () => {
        throw new Error("offline");
      }),
    } as unknown as Preloadable<object>;
    warmPages([broken, fakePage("ask", order)]);
    await nextIdle();
    await nextIdle();
    expect(order).toEqual(["ask"]);
  });
});

describe("usePageLinkWarm", () => {
  function PulseLink() {
    return (
      <a href="/pulse" {...usePageLinkWarm("/pulse")}>
        Pulse
      </a>
    );
  }

  it("starts Pulse's data when the link is pointed at, focused or pressed", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <PulseLink />
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: "Pulse" });
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.pointerDown(link);
    expect(prefetchPulse).toHaveBeenCalledTimes(3);
    expect(prefetchPulse).toHaveBeenCalledWith(client);
  });

  it("warms only the code outside a query client", () => {
    render(<PulseLink />);
    fireEvent.pointerEnter(screen.getByRole("link", { name: "Pulse" }));
    expect(prefetchPulse).not.toHaveBeenCalled();
  });
});
