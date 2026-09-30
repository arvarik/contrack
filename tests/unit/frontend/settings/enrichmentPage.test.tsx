// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnrichmentPage } from "../../../../src/views/settings/pages/EnrichmentPage";
import * as api from "../../../../src/api";
import * as enrichmentApi from "../../../../src/api/enrichment";
import * as prefContext from "../../../../src/contexts/PreferencesContext";
import * as authGate from "../../../../src/components/auth/AuthGate";

vi.mock("../../../../src/api", () => ({
  useContacts: vi.fn(),
}));

vi.mock("../../../../src/api/enrichment", () => ({
  useGroundingCapacity: vi.fn(),
}));

vi.mock("../../../../src/views/ai-search", () => ({
  AISearchView: (props: Record<string, unknown>) => (
    <div data-testid="ai-search-view" data-props={Object.keys(props).join()} />
  ),
}));

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
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
      changed: [],
      resetPreference: vi.fn(),
      setPreference: mockSetPreference,
    } as unknown as ReturnType<typeof prefContext.usePreferences>);
    vi.mocked(enrichmentApi.useGroundingCapacity).mockReturnValue({
      data: { hasCapacity: true, provider: "gemini", researchRuns24h: 12 },
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

  it("has no never-enriched banner and no Select them button", () => {
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
      ],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(screen.queryByText(/never been enriched/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Select them/i })).toBeNull();
    // The page gives the list no selection to start from, and no request to
    // show the never-researched.
    expect(screen.getByTestId("ai-search-view").dataset.props).toBe(
      "hideHeaderDescription",
    );
  });

  it("renders autoEnrich switch and the admin's research count", () => {
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(screen.getByText("Enrich new contacts automatically")).toBeTruthy();
    expect(screen.getByText("Research runs, last 24 hours")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    const autoEnrichSwitch = screen.getByRole("switch", {
      name: "Enrich new contacts automatically",
    });
    fireEvent.click(autoEnrichSwitch);
    expect(mockSetPreference).toHaveBeenCalledWith("autoEnrich", true);
  });

  it("hides the research count from members", () => {
    vi.mocked(authGate.useAuth).mockReturnValue({
      isAdmin: false,
      authRequired: true,
    } as unknown as ReturnType<typeof authGate.useAuth>);
    vi.mocked(api.useContacts).mockReturnValue({
      data: [],
    } as unknown as ReturnType<typeof api.useContacts>);

    renderComponent();
    expect(screen.queryByText(/Research runs/i)).toBeNull();
  });
});
