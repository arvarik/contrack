// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NeedsAttention } from "../../../../src/views/settings/NeedsAttention";
import * as api from "../../../../src/api";
import * as importsApi from "../../../../src/api/imports";

vi.mock("../../../../src/api", () => ({ useDedupeCount: vi.fn() }));
vi.mock("../../../../src/api/imports", () => ({ useImports: vi.fn() }));

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
    <MemoryRouter>
      <NeedsAttention />
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
});
