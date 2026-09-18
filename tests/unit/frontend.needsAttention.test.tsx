// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NeedsAttention } from "../../src/views/settings/NeedsAttention";
import * as api from "../../src/api";
import * as importsApi from "../../src/api/imports";

vi.mock("../../src/api", () => ({
  useDedupeCount: vi.fn(),
  useContacts: vi.fn(),
}));

vi.mock("../../src/api/imports", () => ({
  useImports: vi.fn(),
}));

describe("NeedsAttention", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NeedsAttention />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("renders nothing when all counts are zero", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [{ id: "c1", aiHydratedAt: "2026-01-01" }],
    } as unknown as ReturnType<typeof api.useContacts>);
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [
        {
          id: "i1",
          status: "complete",
          failed: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    } as unknown as ReturnType<typeof importsApi.useImports>);

    const { container } = renderComponent();
    expect(container.firstChild).toBeNull();
  });

  it("renders review duplicates link when dedupeCount > 0", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 5,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(
      screen.getByRole("region", { name: "Needs attention" }),
    ).toBeTruthy();
    expect(screen.getByText("Review 5 possible duplicates")).toBeTruthy();
    const link = screen.getByRole("link", {
      name: /Review 5 possible duplicates/i,
    });
    expect(link.getAttribute("href")).toBe("/settings/duplicates");
  });

  it("renders enrich contacts link when contacts have never been enriched", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [
        { id: "c1", aiHydratedAt: null, isArchived: false, isGhost: false },
        { id: "c2", aiHydratedAt: null, isArchived: false, isGhost: false },
        {
          id: "c3",
          aiHydratedAt: "2026-01-01",
          isArchived: false,
          isGhost: false,
        },
      ],
    } as unknown as ReturnType<typeof api.useContacts>);
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(screen.getByText("Enrich 2 contacts")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Enrich 2 contacts/i });
    expect(link.getAttribute("href")).toBe("/settings/enrichment");
  });

  it("renders retry failed imports link for recent failures", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [
        {
          id: "i1",
          status: "failed",
          failed: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(screen.getByText("Retry 1 failed import")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Retry 1 failed import/i });
    expect(link.getAttribute("href")).toBe("/settings/import");
  });

  it("renders up to 3 links when all have counts", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 12,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [
        { id: "c1", aiHydratedAt: null, isArchived: false, isGhost: false },
      ],
    } as unknown as ReturnType<typeof api.useContacts>);
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [
        {
          id: "i1",
          status: "complete",
          failed: 3,
          createdAt: new Date().toISOString(),
        },
      ],
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(screen.getByText("Review 12 possible duplicates")).toBeTruthy();
    expect(screen.getByText("Enrich 1 contact")).toBeTruthy();
    expect(screen.getByText("Retry 1 failed import")).toBeTruthy();
  });
});
