// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DuplicatesPage } from "../../src/views/settings/pages/DuplicatesPage";
import * as api from "../../src/api";
import * as prefContext from "../../src/contexts/PreferencesContext";

vi.mock("../../src/api", () => ({
  useDedupeCount: vi.fn(),
}));

vi.mock("../../src/views/dedupe", () => ({
  DedupeView: () => <div data-testid="dedupe-engine">DedupeView Mock</div>,
}));

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));

describe("DuplicatesPage", () => {
  let queryClient: QueryClient;
  const mockSetPreference = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    vi.mocked(prefContext.usePreferences).mockReturnValue({
      preferences: {
        dedupePreset: "default",
        dedupeOnCreate: true,
        dedupeOnImport: true,
      },
      stored: [],
      changed: [],
      resetPreference: vi.fn(),
      setPreference: mockSetPreference,
    } as unknown as ReturnType<typeof prefContext.usePreferences>);
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DuplicatesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("renders review strip when dedupeCount > 0", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 7,
    } as unknown as ReturnType<typeof api.useDedupeCount>);

    renderComponent();
    const reviewLink = screen.getByRole("link", { name: /Review them/i });
    expect(reviewLink).toBeTruthy();
    expect(reviewLink.getAttribute("href")).toBe("/pulse/duplicates");
  });

  it("omits review strip when dedupeCount is 0", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);

    renderComponent();
    expect(screen.queryByText(/possible duplicates/i)).toBeNull();
  });

  it("renders sensitivity and automatic check switches and toggles them", () => {
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);

    renderComponent();
    expect(screen.getByText("Auto-merge sensitivity")).toBeTruthy();
    expect(screen.getByText("Check new contacts automatically")).toBeTruthy();
    expect(screen.getByText("Check imports automatically")).toBeTruthy();

    const onCreateSwitch = screen.getByRole("switch", {
      name: "Check new contacts automatically",
    });
    fireEvent.click(onCreateSwitch);
    expect(mockSetPreference).toHaveBeenCalledWith("dedupeOnCreate", false);

    const onImportSwitch = screen.getByRole("switch", {
      name: "Check imports automatically",
    });
    fireEvent.click(onImportSwitch);
    expect(mockSetPreference).toHaveBeenCalledWith("dedupeOnImport", false);
  });
});

describe("DuplicatesPage, the order of the page", () => {
  beforeEach(() => {
    vi.mocked(prefContext.usePreferences).mockReturnValue({
      preferences: {
        dedupePreset: "default",
        dedupeOnCreate: true,
        dedupeOnImport: true,
      },
      stored: [],
      changed: [],
      resetPreference: vi.fn(),
      setPreference: vi.fn(),
    } as unknown as ReturnType<typeof prefContext.usePreferences>);
    vi.mocked(api.useDedupeCount).mockReturnValue({
      data: 0,
    } as unknown as ReturnType<typeof api.useDedupeCount>);
  });

  const renderPage = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DuplicatesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("puts the tool first and what runs by itself under it", () => {
    renderPage();
    const tool = screen.getByTestId("dedupe-engine");
    const section = screen.getByRole("heading", {
      level: 2,
      name: "Automatic merging",
    });
    expect(
      tool.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      section.compareDocumentPosition(
        screen.getByText("Auto-merge sensitivity"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens Merge activity from one button, at every width", () => {
    renderPage();
    expect(
      screen.queryByRole("button", { name: "Duplicates actions" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Merge activity" }).className,
    ).toContain("btn-icon");
  });

  it("writes its lines without a closing period", () => {
    renderPage();
    expect(
      screen.getByText(/^Merges a pair by itself at 93% confidence or more/)
        .textContent,
    ).not.toMatch(/\.$/);
  });
});
