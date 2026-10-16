// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportPanel } from "../../../../src/components/ImportPanel";
import { ImportPage } from "../../../../src/views/settings/pages/ImportPage";
import { DuplicateCheck } from "../../../../src/views/dedupe/components/DuplicateCheck";
import { AISearchView } from "../../../../src/views/ai-search/AISearchView";
import * as api from "../../../../src/api";
import * as importsApi from "../../../../src/api/imports";
import * as aiSettingsApi from "../../../../src/api/aiSettings";
import * as dedupeCtx from "../../../../src/contexts/DedupeContext";
import * as aiSearchCtx from "../../../../src/contexts/AISearchContext";
import * as aiAllowedHook from "../../../../src/hooks/useAiAllowed";
import * as authGate from "../../../../src/components/auth/AuthGate";

vi.mock("../../../../src/api", () => ({
  useDedupeCount: vi.fn(),
  useContacts: vi.fn(),
}));

vi.mock("../../../../src/api/imports", () => ({
  useImports: vi.fn(),
  retryImport: vi.fn(),
}));

vi.mock("../../../../src/api/aiSettings", () => ({
  useInstanceAi: vi.fn(),
  useAISettings: vi.fn(),
  useSetWebSearch: vi.fn(),
}));

vi.mock("../../../../src/contexts/DedupeContext", () => ({
  useDedupe: vi.fn(),
}));

vi.mock("../../../../src/contexts/AISearchContext", () => ({
  useAISearch: vi.fn(),
}));

vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: vi.fn(),
}));

describe("Tools Settings & Embedded Views Hardening", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    vi.mocked(authGate.useAuth).mockReturnValue({
      user: { id: "u-1", email: "user@example.com", name: "User" },
      isAdmin: true,
      accountCount: 1,
    } as unknown as ReturnType<typeof authGate.useAuth>);
  });

  const wrap = (ui: React.ReactElement) =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );

  describe("ImportPanel", () => {
    it("rejects empty files and clears the error when switching source tabs", async () => {
      const { container } = wrap(<ImportPanel />);
      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      expect(input).toBeTruthy();

      const emptyFile = new File([""], "empty.vcf", { type: "text/vcard" });
      fireEvent.change(input, { target: { files: [emptyFile] } });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain("The chosen file is empty");

      // Switching source tab clears the stale error banner
      fireEvent.click(screen.getByRole("tab", { name: "Google" }));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("rejects files larger than 50 MB before parsing or uploading", async () => {
      const { container } = wrap(<ImportPanel />);
      const input = container.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      const bigFile = new File(["x"], "huge.csv", { type: "text/csv" });
      Object.defineProperty(bigFile, "size", { value: 51 * 1024 * 1024 });

      fireEvent.change(input, { target: { files: [bigFile] } });

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(
        "File is too large. Choose a file under 50 MB",
      );
    });
  });

  describe("ImportPage", () => {
    it("disables all Try again buttons while a retry is in flight", async () => {
      let resolveRetry: () => void = () => {};
      vi.mocked(importsApi.retryImport).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRetry = () =>
              resolve({
                importId: "imp-1",
                status: "complete",
                retried: 2,
                imported: 2,
                failed: 0,
              });
          }),
      );
      vi.mocked(importsApi.useImports).mockReturnValue({
        data: [
          {
            id: "imp-1",
            source: "apple",
            fileName: "first.vcf",
            status: "failed",
            total: 2,
            created: 0,
            merged: 0,
            skipped: 0,
            failed: 2,
            error: "Network error",
            startedAt: 1000,
            completedAt: 1500,
          },
          {
            id: "imp-2",
            source: "google",
            fileName: "second.csv",
            status: "complete",
            total: 5,
            created: 4,
            merged: 0,
            skipped: 0,
            failed: 1,
            error: null,
            startedAt: 2000,
            completedAt: 2500,
          },
        ],
      } as unknown as ReturnType<typeof importsApi.useImports>);

      wrap(<ImportPage />);

      const retryButtons = screen.getAllByRole("button", {
        name: "Try again",
      });
      expect(retryButtons).toHaveLength(2);

      fireEvent.click(retryButtons[0]);

      await waitFor(() => {
        const allTryAgain = screen.getAllByRole("button", {
          name: "Try again",
        });
        expect(allTryAgain[0].hasAttribute("disabled")).toBe(true);
        expect(allTryAgain[1].hasAttribute("disabled")).toBe(true);
      });

      resolveRetry();
      await waitFor(() => {
        const allTryAgain = screen.getAllByRole("button", {
          name: "Try again",
        });
        expect(allTryAgain[0].hasAttribute("disabled")).toBe(false);
        expect(allTryAgain[1].hasAttribute("disabled")).toBe(false);
      });
    });
  });

  describe("DuplicateCheck", () => {
    it("disables Check again when a check is queued after a completed scan", () => {
      const startScan = vi.fn();
      vi.mocked(dedupeCtx.useDedupe).mockReturnValue({
        scan: {
          phase: "complete",
          mode: "deep",
          totalContacts: 12,
          contactsScanned: 12,
          autoMerged: 0,
        },
        startScan,
        isStarting: false,
        isScanning: false,
        isQueued: true,
        reset: vi.fn(),
      } as unknown as ReturnType<typeof dedupeCtx.useDedupe>);
      vi.mocked(aiAllowedHook.useAiAllowed).mockReturnValue(true);
      vi.mocked(aiSettingsApi.useInstanceAi).mockReturnValue({
        data: { aiEnabled: true, configured: { chat: true } },
      } as unknown as ReturnType<typeof aiSettingsApi.useInstanceAi>);
      vi.mocked(api.useDedupeCount).mockReturnValue({
        data: { count: 2 },
      } as unknown as ReturnType<typeof api.useDedupeCount>);

      wrap(<DuplicateCheck />);

      const checkAgainBtn = screen.getByRole("button", {
        name: "Check again",
      }) as HTMLButtonElement;
      expect(checkAgainBtn.disabled).toBe(true);
      fireEvent.click(checkAgainBtn);
      expect(startScan).not.toHaveBeenCalled();
    });
  });

  describe("AISearchView", () => {
    it("shows Clear filters when text search yields 0 contacts and resets the search input", () => {
      vi.mocked(api.useContacts).mockReturnValue({
        data: [
          {
            id: "c-10",
            name: "Ada Lovelace",
            title: "Mathematician",
            company: "Analytical Engine",
            email: "ada@example.com",
            completeness: 40,
          },
          {
            id: "c-20",
            name: "Grace Hopper",
            title: "Rear Admiral",
            company: "US Navy",
            email: "grace@example.com",
            completeness: 80,
          },
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof api.useContacts>);
      vi.mocked(aiSearchCtx.useAISearch).mockReturnValue({
        startSearch: vi.fn(),
        batch: null,
        isVisible: false,
        isMinimized: false,
        isStarting: false,
        runsEngine: "provider",
        depthFiguresApply: false,
        limitMessage: null,
        clearLimit: vi.fn(),
        webSearchProvider: "Google Gemini",
        toggleMinimize: vi.fn(),
        dismiss: vi.fn(),
        cancel: vi.fn(),
      } as unknown as ReturnType<typeof aiSearchCtx.useAISearch>);

      wrap(<AISearchView />);

      // Search for a non-existent contact and verify Clear filters resets the search input
      const searchInput = screen.getByPlaceholderText(
        "Filter contacts…",
      ) as HTMLInputElement;
      fireEvent.change(searchInput, { target: { value: "Nonexistent" } });
      expect(
        screen.getByText("No contacts match the current filter"),
      ).toBeTruthy();

      const clearBtn = screen.getByRole("button", { name: "Clear filters" });
      expect(clearBtn.hasAttribute("disabled")).toBe(false);
      fireEvent.click(clearBtn);

      expect(searchInput.value).toBe("");
      expect(screen.getByText("Grace Hopper")).toBeTruthy();
    });
  });
});
