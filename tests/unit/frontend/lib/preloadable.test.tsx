// @vitest-environment jsdom
// preloadable: a lazy component that renders at once when its code is here.
// `React.lazy` suspends on its first render even with the module in memory,
// and React then holds a new Suspense boundary's content for 300 ms. These
// tests pin the three rules: one download, a component that renders at once
// once it is loaded, and a pick that never changes while mounted.
import React, { Suspense, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { preloadable } from "../../../../src/lib/preloadable";

afterEach(cleanup);

interface CounterProps {
  label: string;
}

/** A module whose component counts its clicks, so a remount shows. */
const counterModule = () => ({
  default: function Counter({ label }: CounterProps) {
    const [count, setCount] = useState(0);
    return (
      <button type="button" onClick={() => setCount((n) => n + 1)}>
        {label} {count}
      </button>
    );
  },
});

describe("preloadable", () => {
  it("downloads once, however many times it is asked", async () => {
    const factory = vi.fn(async () => counterModule());
    const page = preloadable<CounterProps>(factory);
    const [a, b] = await Promise.all([page.load(), page.load()]);
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed download, so the next ask tries again", async () => {
    const factory = vi
      .fn<() => Promise<ReturnType<typeof counterModule>>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(counterModule());
    const page = preloadable<CounterProps>(factory);
    await expect(page.load()).rejects.toThrow("offline");
    await expect(page.load()).resolves.toBeDefined();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("renders at once, with no fallback, when the code is already here", async () => {
    const page = preloadable<CounterProps>(async () => counterModule());
    await page.load();
    render(
      <Suspense fallback={<p>Loading…</p>}>
        <page.Component label="Clicks" />
      </Suspense>,
    );
    // Synchronously: no fallback was ever drawn.
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByRole("button", { name: "Clicks 0" })).toBeTruthy();
  });

  it("suspends while the code is on its way, and keeps its pick once it is mounted", async () => {
    let resolve!: (module: ReturnType<typeof counterModule>) => void;
    const page = preloadable<CounterProps>(
      () =>
        new Promise<ReturnType<typeof counterModule>>((r) => {
          resolve = r;
        }),
    );
    const Parent = ({ tick }: { tick: number }) => (
      <Suspense fallback={<p>Loading…</p>}>
        <page.Component label={`Clicks (${tick})`} />
      </Suspense>
    );
    const { rerender } = render(<Parent tick={1} />);
    expect(screen.getByText("Loading…")).toBeTruthy();

    await act(async () => resolve(counterModule()));
    const button = await screen.findByRole("button", {
      name: "Clicks (1) 0",
    });
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Clicks (1) 1" })).toBeTruthy();

    // The code is now loaded. A re-render keeps the component the page
    // mounted with, so its state survives.
    rerender(<Parent tick={2} />);
    expect(screen.getByRole("button", { name: "Clicks (2) 1" })).toBeTruthy();
  });
});
