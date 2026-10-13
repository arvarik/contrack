// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NeedsAttention } from "../../../../src/views/settings/NeedsAttention";
import * as api from "../../../../src/api";
import * as importsApi from "../../../../src/api/imports";

vi.mock("../../../../src/api", () => ({ useDedupeCount: vi.fn() }));
vi.mock("../../../../src/api/imports", () => ({ useImports: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

let currentPath = "";
const PathProbe = () => {
  currentPath = useLocation().pathname;
  return null;
};

const counts = (duplicates: number, failed: number) => {
  vi.mocked(api.useDedupeCount).mockReturnValue({
    data: duplicates,
  } as unknown as ReturnType<typeof api.useDedupeCount>);
  vi.mocked(importsApi.useImports).mockReturnValue({
    data: Array.from({ length: failed }, (_, i) => ({
      id: `i${i}`,
      status: "failed",
      failed: 0,
      createdAt: new Date().toISOString(),
    })),
  } as unknown as ReturnType<typeof importsApi.useImports>);
  return render(
    <MemoryRouter initialEntries={["/settings"]}>
      <NeedsAttention />
      <PathProbe />
    </MemoryRouter>,
  );
};

describe("NeedsAttention", () => {
  it("draws nothing while nothing waits", () => {
    expect(counts(0, 0).container.firstChild).toBeNull();
  });

  it("links each count to the page that settles it", () => {
    counts(12, 1);
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]);
    expect(hrefs).toEqual([
      ["Review 12 possible duplicates", "/pulse/duplicates"],
      ["Retry 1 failed import", "/settings/import"],
    ]);
  });

  it("skips View Transition on touch devices when navigating to /pulse/duplicates", () => {
    const startViewTransition = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition =
      startViewTransition;
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query === "(pointer: coarse)",
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );

    counts(5, 0);
    fireEvent.click(
      screen.getByRole("link", { name: "Review 5 possible duplicates" }),
    );
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(currentPath).toBe("/pulse/duplicates");
  });
});
