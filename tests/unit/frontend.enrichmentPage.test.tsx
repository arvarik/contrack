// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnrichmentPage } from "../../src/views/settings/pages/EnrichmentPage";
import * as api from "../../src/api";
import * as enrichmentApi from "../../src/api/enrichment";
import * as prefContext from "../../src/contexts/PreferencesContext";
import * as authGate from "../../src/components/auth/AuthGate";

vi.mock("../../src/api", () => ({
  useContacts: vi.fn(),
}));

vi.mock("../../src/api/enrichment", () => ({
  useGroundingCapacity: vi.fn(),
}));

vi.mock("../../src/views/ai-search", () => ({
  AISearchView: ({ selectedIds }: { selectedIds?: Set<string> }) => (
    <div data-testid="ai-search-view">
      Selected: {selectedIds ? Array.from(selectedIds).join(",") : "none"}
    </div>
  ),
}));

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: vi.fn(),
}));

describe("EnrichmentPage", () => {
  let queryClient: QueryClient;
  const mockSetPreference = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    vi.mocked(authGate.useAuth).mockReturnValue({
      isAdmin: true,
      authRequired: true,
    } as unknown as ReturnType<typeof authGate.useAuth>);
    vi.mocked(prefContext.usePreferences).mockReturnValue({
      preferences: {
        autoEnrich: false,
      },
      stored: [],
      resetPreference: vi.fn(),
      setPreference: mockSetPreference,
    } as unknown as ReturnType<typeof prefContext.usePreferences>);
    vi.mocked(enrichmentApi.useGroundingCapacity).mockReturnValue({
      data: { hasCapacity: true, remaining: 88, limit: 100 },
    } as unknown as ReturnType<typeof enrichmentApi.useGroundingCapacity>);
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <EnrichmentPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("renders never-enriched banner and clicking Select them selects those contacts", () => {
    vi.mocked(api.useContacts).mockReturnValue({
      data: [
        {
          id: "c1",
          name: "Alice",
          aiHydratedAt: null,
          isArchived: false,
          isGhost: false,
        },
        {
          id: "c2",
          name: "Bob",
          aiHydratedAt: null,
          isArchived: false,
          isGhost: false,
        },
        {
          id: "c3",
          name: "Charlie",
          aiHydratedAt: "2026-01-01",
          isArchived: false,
          isGhost: false,
        },
      ],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(
      screen.getByText("2 contacts have never been enriched"),
    ).toBeTruthy();
    const enrichBtn = screen.getByRole("button", { name: /Select them/i });
    expect(enrichBtn).toBeTruthy();

    fireEvent.click(enrichBtn);
    expect(screen.getByText("Selected: c1,c2")).toBeTruthy();
  });

  it("renders autoEnrich switch and admin grounding meter", () => {
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(screen.getByText("Enrich new contacts automatically")).toBeTruthy();
    expect(screen.getByText("Web searches today")).toBeTruthy();
    expect(screen.getByText("12 of 100")).toBeTruthy();

    const autoEnrichSwitch = screen.getByRole("switch", {
      name: "Enrich new contacts automatically",
    });
    fireEvent.click(autoEnrichSwitch);
    expect(mockSetPreference).toHaveBeenCalledWith("autoEnrich", true);
  });

  it("hides grounding meter for non-admin members", () => {
    vi.mocked(authGate.useAuth).mockReturnValue({
      isAdmin: false,
      authRequired: true,
    } as unknown as ReturnType<typeof authGate.useAuth>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(screen.queryByText(/Web searches today/i)).toBeNull();
  });
});
