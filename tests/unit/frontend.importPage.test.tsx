// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportPage } from "../../src/views/settings/pages/ImportPage";
import * as importsApi from "../../src/api/imports";

vi.mock("../../src/api/imports", () => ({
  useImports: vi.fn(),
  retryImport: vi.fn(),
}));

vi.mock("../../src/components/ImportPanel", () => ({
  ImportPanel: () => <div data-testid="import-panel">ImportPanel Mock</div>,
}));

describe("ImportPage", () => {
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
          <ImportPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  it("renders ImportPanel and empty state when no imports", () => {
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(screen.getByTestId("import-panel")).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "No recent imports" }),
    ).toBeTruthy();
  });

  it("renders recent imports with counts and status badges", () => {
    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [
        {
          id: "imp-1",
          status: "complete",
          imported: 42,
          failed: 0,
          createdAt: new Date().toISOString(),
          summary: { autoMerged: 5, needsReview: 2 },
        },
        {
          id: "imp-2",
          status: "failed",
          imported: 10,
          failed: 3,
          createdAt: new Date().toISOString(),
          error: "Corrupt file",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    expect(screen.getByText("42 imported")).toBeTruthy();
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("· 5 merged")).toBeTruthy();
    expect(screen.getByText("· 2 need review")).toBeTruthy();

    expect(screen.getByText("10 imported")).toBeTruthy();
    expect(screen.getByText("· 3 failed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Corrupt file")).toBeTruthy();
  });

  it("allows retrying failed imports", async () => {
    vi.mocked(importsApi.retryImport).mockResolvedValue({
      importId: "imp-2",
      status: "complete",
      retried: 3,
      imported: 3,
      failed: 0,
    });

    vi.mocked(importsApi.useImports).mockReturnValue({
      data: [
        {
          id: "imp-2",
          status: "failed",
          imported: 10,
          failed: 3,
          createdAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof importsApi.useImports>);

    renderComponent();
    const retryBtn = screen.getByRole("button", { name: /Retry/i });
    expect(retryBtn).toBeTruthy();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(importsApi.retryImport).toHaveBeenCalledWith("imp-2");
    });
  });
});
