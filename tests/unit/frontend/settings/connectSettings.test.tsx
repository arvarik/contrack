// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { CalendarFormModal } from "../../../../src/views/settings/connectors/CalendarFormModal";
import { CarddavFormModal } from "../../../../src/views/settings/connectors/CarddavFormModal";
import { ImapFormModal } from "../../../../src/views/settings/connectors/ImapFormModal";
import { CorrespondentsView } from "../../../../src/views/settings/connectors/CorrespondentsView";
import { McpView } from "../../../../src/views/settings/mcp/McpView";
import { findRows } from "../../../../src/views/settings/registry";
import * as connectorsApi from "../../../../src/api/connectors";
import * as contactsApi from "../../../../src/api/contacts";
import * as authApi from "../../../../src/api/auth";
import * as authGate from "../../../../src/components/auth/AuthGate";
import type { Correspondent } from "../../../../shared/connectors";

vi.mock("../../../../src/api/connectors", () => ({
  useConnectorKinds: vi.fn(),
  useConnectors: vi.fn(),
  useCreateConnector: vi.fn(),
  useTestConnector: vi.fn(),
  useUpdateConnector: vi.fn(),
  useDeleteConnector: vi.fn(),
  useSyncConnector: vi.fn(),
  useConnectorRuns: vi.fn(),
  useCorrespondents: vi.fn(),
  useIgnoreCorrespondent: vi.fn(),
}));

vi.mock("../../../../src/api/contacts", () => ({
  useCreateContact: vi.fn(),
}));

vi.mock("../../../../src/api/auth", () => ({
  createApiToken: vi.fn(),
}));

vi.mock("../../../../src/components/auth/AuthGate", () => ({
  useAuth: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("Connect settings hardening", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();

    vi.mocked(authGate.useAuth).mockReturnValue({
      user: { id: "u1", username: "admin", role: "admin", isOwner: true },
      token: "tok",
      role: "admin",
      isAdmin: true,
      isOwner: true,
      authRequired: true,
      publicUrl: "https://crm.example.com",
      mcpOAuth: false,
      needsSetup: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as unknown as ReturnType<typeof authGate.useAuth>);

    vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "conn-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

    vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "conn-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

    vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockResolvedValue({ ok: true, detail: "Connected cleanly" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);

    vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);

    vi.mocked(connectorsApi.useIgnoreCorrespondent).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useIgnoreCorrespondent>);

    vi.mocked(contactsApi.useCreateContact).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "c-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof contactsApi.useCreateContact>);
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithProviders = (ui: React.ReactElement) =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    );

  describe("CalendarFormModal hardening", () => {
    it("normalizes webcal:// URLs to https://, clears stale test results on edit, and formats error toasts", async () => {
      const testMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, detail: "Calendar feed verified" })
        .mockRejectedValueOnce(new Error("403 Forbidden."));
      vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
        mutateAsync: testMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);

      renderWithProviders(
        <CalendarFormModal isOpen={true} onClose={vi.fn()} />,
      );

      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      expect(urlInput.getAttribute("spellcheck")).toBe("false");
      expect(urlInput.getAttribute("autocorrect")).toBe("off");

      // Rejects invalid schemes
      fireEvent.change(urlInput, {
        target: { value: "ftp://example.com/cal.ics" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      expect(
        screen.getByText(
          "Enter a valid https://, http:// or webcal:// calendar URL",
        ),
      ).toBeTruthy();
      expect(testMock).not.toHaveBeenCalled();

      // Normalizes webcal:// to https://
      fireEvent.change(urlInput, {
        target: {
          value: "  webcal://p01-caldav.icloud.com/published/2/cal.ics  ",
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

      await waitFor(() => {
        expect(testMock).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "ics",
            config: expect.objectContaining({
              url: "https://p01-caldav.icloud.com/published/2/cal.ics",
            }),
          }),
        );
        expect(screen.getByText("Calendar feed verified")).toBeTruthy();
      });

      // Changing the URL clears the stale testResult banner
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/other.ics" },
      });
      expect(screen.queryByText("Calendar feed verified")).toBeNull();

      // Error toast uses standardized "Could not test connection: ..." without trailing period
      fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Could not test connection: 403 Forbidden",
        );
      });
    });
  });

  describe("CarddavFormModal hardening", () => {
    it("sets NO_AUTOCORRECT, trims URL and username while preserving password spaces, and validates URL scheme", async () => {
      const createMock = vi.fn().mockResolvedValue({ id: "carddav-1" });
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

      const onClose = vi.fn();
      renderWithProviders(<CarddavFormModal isOpen={true} onClose={onClose} />);

      const urlInput = screen.getByLabelText("Server or address book URL");
      const userInput = screen.getByLabelText("Username / email");
      const passInput = screen.getByLabelText("App password");

      expect(urlInput.getAttribute("autocorrect")).toBe("off");
      expect(userInput.getAttribute("autocorrect")).toBe("off");
      expect(passInput.getAttribute("autocorrect")).toBe("off");

      fireEvent.change(urlInput, {
        target: { value: "ftp://contacts.icloud.com" },
      });
      fireEvent.change(userInput, {
        target: { value: "  ada@example.com  " },
      });
      fireEvent.change(passInput, {
        target: { value: "   " },
      });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(
        screen.getByText("Enter a valid https:// or http:// server URL"),
      ).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();

      fireEvent.change(urlInput, {
        target: { value: "  https://contacts.icloud.com  " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(screen.getByText("Enter your app password")).toBeTruthy();

      fireEvent.change(passInput, {
        target: { value: "abcd-efgh-ijkl-mnop " },
      });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledWith({
          kind: "carddav",
          name: "Personal Contacts",
          config: {
            url: "https://contacts.icloud.com",
            username: "ada@example.com",
            syncDirection: "two_way",
          },
          secret: { password: "abcd-efgh-ijkl-mnop " },
          intervalMinutes: 30,
        });
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  describe("ImapFormModal hardening", () => {
    it("sets NO_AUTOCORRECT on technical fields, normalizes host scheme, preserves password spaces, and validates port range", async () => {
      const createMock = vi.fn().mockResolvedValue({ id: "imap-1" });
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

      renderWithProviders(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      const hostInput = screen.getByLabelText("IMAP host");
      const portInput = screen.getByLabelText("Port");
      const userInput = screen.getByLabelText("Username / email");
      const passInput = screen.getByLabelText("App password");
      const foldersInput = screen.getByLabelText("Folders to sync");
      const aliasesInput = screen.getByLabelText(
        "Also treat these addresses as mine",
      );

      for (const el of [
        hostInput,
        userInput,
        passInput,
        foldersInput,
        aliasesInput,
      ]) {
        expect(el.getAttribute("autocorrect")).toBe("off");
      }

      fireEvent.change(hostInput, {
        target: { value: "  imaps://imap.fastmail.com/  " },
      });
      fireEvent.change(portInput, { target: { value: "70000" } });
      fireEvent.change(userInput, {
        target: { value: "  ada@fastmail.com  " },
      });
      fireEvent.change(passInput, { target: { value: "app-pass-123 " } });

      fireEvent.click(screen.getByRole("button", { name: "Connect" }));
      expect(
        screen.getByText("Enter a valid port between 1 and 65535"),
      ).toBeTruthy();
      expect(createMock).not.toHaveBeenCalled();

      fireEvent.change(portInput, { target: { value: "993" } });
      fireEvent.click(screen.getByRole("button", { name: "Connect" }));

      await waitFor(() => {
        expect(createMock).toHaveBeenCalledWith(
          expect.objectContaining({
            config: expect.objectContaining({
              host: "imap.fastmail.com",
              port: 993,
              username: "ada@fastmail.com",
            }),
            secret: { password: "app-pass-123 " },
          }),
        );
      });
    });
  });

  describe("CorrespondentsView filtering and naming", () => {
    it("shows filter box when >5 correspondents exist and prompts for name with NO_AUTOCORRECT when name is missing", async () => {
      const sixPeople: Correspondent[] = Array.from({ length: 6 }, (_, i) => ({
        connectorId: "conn-1",
        connectorName: "Fastmail",
        kind: "imap",
        externalId: `person${i}@example.com`,
        name: i === 0 ? undefined : `Person ${i}`,
        email:
          i === 0 ? "rowan.vale+news@example.com" : `person${i}@example.com`,
        seenCount: i + 2,
        lastSeenAt: "2026-10-15T12:00:00Z",
        localId: null,
        ignoredAt: null,
      }));

      vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
        data: sixPeople,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);

      renderWithProviders(<CorrespondentsView />);

      const filterInput = screen.getByRole("textbox", {
        name: "Filter correspondents",
      });
      expect(filterInput.getAttribute("autocorrect")).toBe("off");

      fireEvent.change(filterInput, { target: { value: "rowan" } });
      expect(screen.getByText("rowan.vale+news@example.com")).toBeTruthy();
      expect(screen.queryByText("Person 1")).toBeNull();

      // Clicking Add as contact on an address-only correspondent opens the name modal pre-filled
      fireEvent.click(screen.getByRole("button", { name: /Add as contact/i }));
      const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
      expect(nameInput.value).toBe("Rowan Vale");
      expect(nameInput.getAttribute("autocorrect")).toBe("off");
    });
  });

  describe("McpView hardening", () => {
    it("validates pasted tokens, supports Escape to cancel, and formats token creation errors", async () => {
      vi.mocked(authApi.createApiToken).mockRejectedValueOnce(
        new Error("Rate limit exceeded."),
      );

      renderWithProviders(<McpView />);

      expect(screen.getByText("https://crm.example.com/api/mcp")).toBeTruthy();

      // Create token failure uses standardized errorText toast
      fireEvent.click(
        screen.getByRole("button", { name: "Create a token for Claude Code" }),
      );
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Could not create token: Rate limit exceeded",
        );
      });

      // Paste existing token flow
      fireEvent.click(
        screen.getByRole("button", { name: "Use a token I have" }),
      );
      const tokenInput = screen.getByLabelText("Your token");
      expect(tokenInput.getAttribute("autocorrect")).toBe("off");

      // Invalid token shows error hint and keeps snippet placeholder
      fireEvent.change(tokenInput, { target: { value: "bad_token" } });
      expect(tokenInput.getAttribute("aria-invalid")).toBe("true");
      expect(
        screen.getByText(/A Contrack token starts with ctk_/i),
      ).toBeTruthy();

      // Valid token populates setup snippet
      const validToken = "ctk_1234567890abcdefghij12345";
      fireEvent.change(tokenInput, { target: { value: `  ${validToken}  ` } });
      expect(tokenInput.getAttribute("aria-invalid")).toBeNull();
      expect(screen.getByText(new RegExp(`Bearer ${validToken}`))).toBeTruthy();

      // Pressing Escape cancels pasting and resets token draft
      fireEvent.keyDown(tokenInput, { key: "Escape" });
      expect(screen.queryByLabelText("Your token")).toBeNull();
    });
  });

  describe("Connect registry search keywords", () => {
    it.each([
      ["webcal", "/settings/connectors#gallery"],
      ["address book", "/settings/connectors#gallery"],
      ["strangers", "/settings/connectors/people"],
    ])("finds %s at %s", (query, expectedPath) => {
      const paths = findRows(query).map((h) => h.path);
      expect(paths).toContain(expectedPath);
    });

    it("does not match unsupported caldav or map non-Claude MCP clients to Claude rows", () => {
      expect(findRows("caldav")).toHaveLength(0);
      expect(findRows("vscode")).toHaveLength(0);
      expect(findRows("codex")).toHaveLength(0);
    });
  });
});
