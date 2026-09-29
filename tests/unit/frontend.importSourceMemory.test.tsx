// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportPanel } from "../../src/components/ImportPanel";

/** Where the panel keeps the last source. A literal, so a rename fails here. */
const SOURCE_KEY = "contrack.import.lastSource";

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ user: { id: "acct-test" } }),
}));

vi.mock("motion/react", async () => {
  const ReactModule = await import("react");
  const MOTION_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "variants",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)),
    );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => (props: Record<string, unknown>) =>
          ReactModule.createElement(tag, strip(props)),
      },
    ),
  };
});

describe("Import source memory", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("ImportPanel integration", () => {
    const renderPanel = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ImportPanel />
          </MemoryRouter>
        </QueryClientProvider>,
      );

    const saved = (value: string) => () =>
      localStorage.setItem(SOURCE_KEY, value);

    it.each<[string, string, () => void]>([
      ["Apple", "nothing is saved", () => {}],
      ["Google", "google is saved", saved("google")],
      ["LinkedIn", "linkedin is saved", saved("linkedin")],
      ["Facebook", "facebook is saved", saved("facebook")],
      ["Apple", "apple is saved", saved("apple")],
      ["Apple", "an unknown source is saved", saved("unknown-format")],
      ["Apple", "an empty value is saved", saved("")],
      [
        "Apple",
        "localStorage throws on a read",
        () => {
          vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("QuotaExceededError");
          });
        },
      ],
    ])("opens on %s when %s", (tab, _when, arrange) => {
      arrange();
      renderPanel();

      expect(
        screen
          .getAllByRole("tab", { selected: true })
          .map((selected) => selected.textContent),
      ).toEqual([tab]);
    });

    it("persists tab switch to localStorage", () => {
      renderPanel();

      const linkedinTab = screen.getByRole("tab", { name: "LinkedIn" });
      fireEvent.click(linkedinTab);

      expect(localStorage.getItem(SOURCE_KEY)).toBe("linkedin");
      expect(linkedinTab.getAttribute("aria-selected")).toBe("true");
    });

    it("works normally when localStorage throws on switch", () => {
      renderPanel();

      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });

      const facebookTab = screen.getByRole("tab", { name: "Facebook" });
      // A throw in the click handler reaches the window as an uncaught
      // error, and Vitest fails the run on it.
      fireEvent.click(facebookTab);
      expect(facebookTab.getAttribute("aria-selected")).toBe("true");
    });
  });
});
