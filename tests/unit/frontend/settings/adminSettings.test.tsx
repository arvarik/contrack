// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MailView } from "../../../../src/views/settings/admin/MailView";
import { InvitationsView } from "../../../../src/views/settings/admin/InvitationsView";
import { BackupsView } from "../../../../src/views/settings/admin/BackupsView";
import { AuditView } from "../../../../src/views/settings/admin/AuditView";
import { AISettingsView } from "../../../../src/views/ai-settings/AISettingsView";
import { WebSearchSection } from "../../../../src/views/ai-settings/WebSearchSection";
import type { AISettings } from "../../../../src/api/aiSettings";

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

const updateMailMutate = vi.fn();
const sendTestMutate = vi.fn();
const createInviteMutate = vi.fn();
const createBackupMutate = vi.fn();

const mockMailConfig = {
  data: {
    source: "settings" as const,
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "postmaster",
    hasPassword: true,
    from: "noreply@example.com",
    replyTo: "",
    publicUrl: "https://crm.example.com",
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};

const mockAuditLogQuery = {
  data: {
    pages: [
      {
        entries: [
          {
            id: 1,
            action: "auth.login.success",
            actor: { id: "u1", username: "admin" },
            targetType: null,
            targetId: null,
            details: null,
            ip: "127.0.0.1",
            createdAt: "2026-10-16T00:00:00Z",
          },
        ],
        nextCursor: 1,
      },
    ],
  },
  isLoading: false,
  isError: false,
  hasNextPage: true,
  isFetchingNextPage: false,
  isFetchNextPageError: true,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock("../../../../src/api/admin", () => ({
  AUDIT_GROUPS: [
    { key: "auth", label: "Sign-in", actions: ["auth.login.success"] },
  ],
  useAuditLog: () => mockAuditLogQuery,
  useInstanceSettings: () => ({
    data: { mailConfigured: true },
  }),
  useMailConfig: () => mockMailConfig,
  useUpdateMailConfig: () => ({
    mutate: updateMailMutate,
    isPending: false,
  }),
  useDeleteMailConfig: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useSendTestMail: () => ({
    mutate: sendTestMutate,
    isPending: false,
  }),
  useInvitations: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateInvitation: () => ({
    mutate: createInviteMutate,
    isPending: false,
  }),
  useRevokeInvitation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useBackups: () => ({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateBackup: () => ({
    mutate: createBackupMutate,
    isPending: false,
  }),
  downloadFile: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ user: { email: "admin@example.com" } }),
}));

vi.mock("../../../../src/api/connectors", () => ({
  useConnectors: () => ({ data: [] }),
}));

let mockAiSettingsQuery: {
  data: AISettings | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: undefined,
  isLoading: false,
  isError: true,
  refetch: vi.fn(),
};

const setSearxngMutate = vi.fn();

vi.mock("../../../../src/api/aiSettings", () => ({
  useAISettings: () => mockAiSettingsQuery,
  useSetInstanceAi: () => ({ mutate: vi.fn(), isPending: false }),
  useSetSearxng: () => ({ mutate: setSearxngMutate, isPending: false }),
  useSetWebSearch: () => ({ mutate: vi.fn(), isPending: false }),
  useCapabilityModels: () => ({ data: [], isLoading: false }),
  useSetCapability: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("../../../../src/views/settings/EngineChoice", () => ({
  EngineChoice: () => <div data-testid="engine-choice" />,
}));

vi.mock("../../../../src/views/ai-settings/FeatureMap", () => ({
  FeatureMap: () => <div data-testid="feature-map" />,
}));

vi.mock("../../../../src/views/ai-settings/ProvidersSection", () => ({
  ProvidersSection: () => <div data-testid="providers-section" />,
}));

vi.mock("../../../../src/views/ai-settings/ModelsSection", () => ({
  ModelsSection: () => <div data-testid="models-section" />,
}));

const sampleAiSettings: AISettings = {
  instance: { aiOff: false, lockedByEnv: false },
  multipleAccounts: false,
  providers: [],
  availableProviders: [],
  customEndpoints: [],
  capabilities: {},
  reranker: { model: null, source: "default" },
  webSearch: {
    allowed: true,
    engine: "provider",
    engines: {
      provider: { available: true, missing: [] },
      searxng: { available: true, missing: [] },
      combined: { available: true, missing: [] },
    },
    searxng: {
      configured: true,
      url: "http://127.0.0.1:8888",
      source: "setting",
    },
  },
};

describe("Administration settings hardening", () => {
  beforeEach(() => {
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
    updateMailMutate.mockReset();
    sendTestMutate.mockReset();
    createInviteMutate.mockReset();
    createBackupMutate.mockReset();
    setSearxngMutate.mockReset();
  });
  afterEach(cleanup);

  describe("MailView", () => {
    it("applies NO_AUTOCORRECT to technical SMTP fields and validates base-10 integer ports", () => {
      render(<MailView />);

      const hostInput = screen.getByLabelText("Host");
      const portInput = screen.getByLabelText("Port");
      expect(hostInput.getAttribute("spellcheck")).toBe("false");
      expect(hostInput.getAttribute("autocorrect")).toBe("off");
      expect(portInput.getAttribute("autocapitalize")).toBe("off");

      // Non-integer or hex ports are rejected before calling updateMail
      for (const badPort of ["587abc", "0x1BB"]) {
        toastErrorMock.mockReset();
        fireEvent.change(portInput, { target: { value: badPort } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(toastErrorMock).toHaveBeenCalledWith(
          "Enter a port between 1 and 65535",
        );
        expect(updateMailMutate).not.toHaveBeenCalled();
      }

      // Valid port trims fields and submits
      fireEvent.change(hostInput, {
        target: { value: "  mail.example.org  " },
      });
      fireEvent.change(portInput, { target: { value: " 465 " } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(updateMailMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "mail.example.org",
          port: 465,
        }),
        expect.any(Object),
      );
    });
  });

  describe("InvitationsView", () => {
    it("validates optional email format including intranet/localhost addresses before creating an invitation", () => {
      render(<InvitationsView />);
      fireEvent.click(screen.getByRole("button", { name: "New invitation" }));

      const emailInput = screen.getByLabelText(/Email/);
      const submitBtn = screen.getByRole("button", {
        name: "Create invitation",
      });

      // Empty email is allowed (link works for anyone)
      expect(submitBtn.hasAttribute("disabled")).toBe(false);

      // Malformed email disables submit
      fireEvent.change(emailInput, { target: { value: "not-an-email" } });
      expect(submitBtn.hasAttribute("disabled")).toBe(true);

      // Local/intranet email is accepted
      fireEvent.change(emailInput, { target: { value: "ada@intranet" } });
      expect(submitBtn.hasAttribute("disabled")).toBe(false);

      // Standard email trims on submit
      fireEvent.change(emailInput, {
        target: { value: "  ada@example.com  " },
      });
      expect(submitBtn.hasAttribute("disabled")).toBe(false);
      fireEvent.click(submitBtn);
      expect(createInviteMutate).toHaveBeenCalledWith(
        {
          email: "ada@example.com",
          role: "member",
          expiresInDays: 7,
          send: true,
        },
        expect.any(Object),
      );
    });
  });

  describe("BackupsView & AuditView", () => {
    it("points empty state to Settings → Administration → General and formats snapshot errors", () => {
      createBackupMutate.mockImplementation(
        (_vars: undefined, opts: { onError: (err: Error) => void }) => {
          opts.onError(new Error("Disk full"));
        },
      );
      render(<BackupsView />);
      expect(
        screen.getByText(/Settings → Administration → General/),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Snapshot now" }));
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Could not take snapshot: Disk full",
      );
    });

    it("shows an inline error message when Load more fails in AuditView", () => {
      render(<AuditView />);
      expect(screen.getByText("Signed in")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain(
        "Could not load more entries. Try again",
      );
    });
  });

  describe("AISettingsView & WebSearchSection", () => {
    it("renders LoadFailed when initial load fails, but keeps cached settings on a failed background refetch", () => {
      const refetch = vi.fn();
      mockAiSettingsQuery = {
        data: undefined,
        isLoading: false,
        isError: true,
        refetch,
      };
      const { rerender } = render(
        <MemoryRouter>
          <AISettingsView />
        </MemoryRouter>,
      );
      expect(screen.getByText(/Could not load the AI settings/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(refetch).toHaveBeenCalled();

      // Background refetch error with cached settings keeps the page rendered
      mockAiSettingsQuery = {
        data: sampleAiSettings,
        isLoading: false,
        isError: true,
        refetch,
      };
      rerender(
        <MemoryRouter>
          <AISettingsView />
        </MemoryRouter>,
      );
      expect(screen.queryByText(/Could not load the AI settings/)).toBeNull();
      expect(screen.getByText("Use AI on this instance")).toBeTruthy();
    });

    it("keeps SearXNG Save disabled until trimmed URL differs from stored URL", () => {
      render(
        <MemoryRouter>
          <WebSearchSection settings={sampleAiSettings} />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText("SearXNG address");
      const saveBtn = screen.getByRole("button", { name: "Save" });
      expect(input.getAttribute("spellcheck")).toBe("false");
      expect(saveBtn.hasAttribute("disabled")).toBe(true);

      // Adding trailing whitespace does not count as a change
      fireEvent.change(input, {
        target: { value: "http://127.0.0.1:8888   " },
      });
      expect(saveBtn.hasAttribute("disabled")).toBe(true);

      // Changing the host enables Save and submits trimmed URL
      fireEvent.change(input, {
        target: { value: "  http://10.0.0.5:8888  " },
      });
      expect(saveBtn.hasAttribute("disabled")).toBe(false);
      fireEvent.click(saveBtn);
      expect(setSearxngMutate).toHaveBeenCalledWith(
        "http://10.0.0.5:8888",
        expect.any(Object),
      );
    });
  });
});
