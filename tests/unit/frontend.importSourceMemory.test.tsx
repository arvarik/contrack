// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ImportPanel,
  IMPORT_LAST_SOURCE_KEY,
  readInitialSource,
  persistSource,
} from "../../src/components/ImportPanel";

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

  describe("readInitialSource", () => {
    it("defaults to apple when localStorage is empty", () => {
      expect(readInitialSource()).toBe("apple");
    });

    it("returns saved source when valid", () => {
      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "google");
      expect(readInitialSource()).toBe("google");

      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "linkedin");
      expect(readInitialSource()).toBe("linkedin");

      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "facebook");
      expect(readInitialSource()).toBe("facebook");

      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "apple");
      expect(readInitialSource()).toBe("apple");
    });

    it("defaults to apple when saved value is unknown or corrupt", () => {
      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "unknown-format");
      expect(readInitialSource()).toBe("apple");

      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "");
      expect(readInitialSource()).toBe("apple");
    });

    it("handles localStorage.getItem throwing gracefully", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
      expect(readInitialSource()).toBe("apple");
    });
  });

  describe("persistSource", () => {
    it("persists source into localStorage key", () => {
      persistSource("linkedin");
      expect(localStorage.getItem(IMPORT_LAST_SOURCE_KEY)).toBe("linkedin");
    });

    it("handles localStorage.setItem throwing without uncaught exceptions", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });
      expect(() => persistSource("google")).not.toThrow();
    });
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

    it("initializes active tab from saved source", () => {
      localStorage.setItem(IMPORT_LAST_SOURCE_KEY, "google");
      renderPanel();

      const googleTab = screen.getByRole("tab", { name: "Google" });
      expect(googleTab.getAttribute("aria-selected")).toBe("true");

      const appleTab = screen.getByRole("tab", { name: "Apple" });
      expect(appleTab.getAttribute("aria-selected")).toBe("false");
    });

    it("persists tab switch to localStorage", () => {
      renderPanel();

      const linkedinTab = screen.getByRole("tab", { name: "LinkedIn" });
      fireEvent.click(linkedinTab);

      expect(localStorage.getItem(IMPORT_LAST_SOURCE_KEY)).toBe("linkedin");
      expect(linkedinTab.getAttribute("aria-selected")).toBe("true");
    });

    it("works normally when localStorage throws on switch", () => {
      renderPanel();

      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("SecurityError");
      });

      const facebookTab = screen.getByRole("tab", { name: "Facebook" });
      expect(() => fireEvent.click(facebookTab)).not.toThrow();
      expect(facebookTab.getAttribute("aria-selected")).toBe("true");
    });
  });
});
