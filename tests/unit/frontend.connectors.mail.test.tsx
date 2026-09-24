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
import { ImapFormModal } from "../../src/views/settings/connectors/ImapFormModal";
import { GoogleFormModal } from "../../src/views/settings/connectors/GoogleFormModal";
import { CorrespondentsView } from "../../src/views/settings/connectors/CorrespondentsView";
import * as connectorsApi from "../../src/api/connectors";
import * as contactsApi from "../../src/api/contacts";
import * as authGate from "../../src/components/auth/AuthGate";
import type { Correspondent, KindInfo } from "../../shared/connectors";

vi.mock("../../src/api/connectors", () => ({
  useConnectorKinds: vi.fn(),
  useConnectors: vi.fn(),
  useConnector: vi.fn(),
  useCreateConnector: vi.fn(),
  useTestConnector: vi.fn(),
  useUpdateConnector: vi.fn(),
  useDeleteConnector: vi.fn(),
  useSyncConnector: vi.fn(),
  useConnectorRuns: vi.fn(),
  useCorrespondents: vi.fn(),
  useIgnoreCorrespondent: vi.fn(),
  connectorKeys: {
    all: ["connectors"],
    kinds: ["connectors", "kinds"],
    lists: () => ["connectors", "list"],
    detail: (id: string) => ["connectors", "detail", id],
    runs: (id: string) => ["connectors", "runs", id],
    correspondents: (limit?: number) => ["connectors", "correspondents", limit],
  },
}));

vi.mock("../../src/api/contacts", () => ({
  useCreateContact: vi.fn(),
}));

vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: vi.fn(),
}));

describe("Frontend Mail & Google Connectors Components", () => {
  let queryClient: QueryClient;

  const mockKinds: KindInfo[] = [
    {
      kind: "imap",
      label: "Mailbox (IMAP)",
      description: "Sync sent and received mail headers from any IMAP account",
      capabilities: { schedule: true },
    },
    {
      kind: "google",
      label: "Google Workspace",
      description: "Sync contacts, mail and calendar with Google",
      capabilities: { schedule: true, oauth: true },
      configured: true,
    },
  ];

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
      needsSetup: false,
      login: vi.fn(),
      logout: vi.fn(),
    } as unknown as ReturnType<typeof authGate.useAuth>);

    vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
      data: mockKinds,
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);

    vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "created-imap-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

    vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "updated-imap-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

    vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockResolvedValue({ ok: true, detail: "IMAP connected successfully" }),
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
      mutateAsync: vi.fn().mockResolvedValue({ id: "c-new" }),
      isPending: false,
    } as unknown as ReturnType<typeof contactsApi.useCreateContact>);
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithClient = (ui: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>,
    );
  };

  // =========================================================================
  // 1. ImapFormModal
  // =========================================================================
  describe("ImapFormModal", () => {
    it("renders create form with default port 993", () => {
      renderWithClient(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      expect(
        screen.getByRole("heading", { name: /Connect Mailbox \(IMAP\)/i }),
      ).toBeTruthy();
      expect(screen.getByPlaceholderText("imap.fastmail.com")).toBeTruthy();
      const portInput = screen.getByDisplayValue("993");
      expect(portInput).toBeTruthy();
    });

    it("validates missing host, username, and password", async () => {
      renderWithClient(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      const saveBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText("Enter the IMAP server's host")).toBeTruthy();
      });
    });

    it("tests IMAP connection when test button clicked", async () => {
      const testMutation = vi
        .fn()
        .mockResolvedValue({ ok: true, detail: "Found 150 emails in INBOX" });
      vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
        mutateAsync: testMutation,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);

      renderWithClient(<ImapFormModal isOpen={true} onClose={vi.fn()} />);

      fireEvent.change(screen.getByPlaceholderText("imap.fastmail.com"), {
        target: { value: "imap.fastmail.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
        target: { value: "you@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Paste your app password"), {
        target: { value: "app-secret-pwd" },
      });

      const testBtn = screen.getByRole("button", { name: "Test connection" });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(testMutation).toHaveBeenCalledTimes(1);
        expect(screen.getByText("Found 150 emails in INBOX")).toBeTruthy();
      });
    });

    it("submits create form and calls createConnector", async () => {
      const createMutation = vi.fn().mockResolvedValue({ id: "new-imap" });
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMutation,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

      const onClose = vi.fn();
      renderWithClient(<ImapFormModal isOpen={true} onClose={onClose} />);

      fireEvent.change(screen.getByPlaceholderText("imap.fastmail.com"), {
        target: { value: "imap.fastmail.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("you@example.com"), {
        target: { value: "you@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Paste your app password"), {
        target: { value: "app-secret-pwd" },
      });

      const saveBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(createMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "imap",
            name: "Personal Mail",
            config: expect.objectContaining({
              host: "imap.fastmail.com",
              port: 993,
              username: "you@example.com",
            }),
            secret: { password: "app-secret-pwd" },
          }),
        );
        expect(onClose).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // 2. GoogleFormModal
  // =========================================================================
  describe("GoogleFormModal", () => {
    it("renders Google Workspace modal when configured", () => {
      renderWithClient(<GoogleFormModal isOpen={true} onClose={vi.fn()} />);

      expect(
        screen.getByRole("heading", { name: /Connect Google Workspace/i }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Connect Google Workspace/i }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Summaries require reading email message bodies/i),
      ).toBeTruthy();
    });

    it("displays prompt to configure Google OAuth if instance is unconfigured", () => {
      vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
        data: [
          {
            kind: "google",
            label: "Google Workspace",
            description: "Sync contacts, mail and calendar with Google",
            capabilities: { schedule: true, oauth: true },
            configured: false,
          },
        ],
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);

      renderWithClient(<GoogleFormModal isOpen={true} onClose={vi.fn()} />);

      expect(
        screen.getByText(/Google sign-in is not set up yet/i),
      ).toBeTruthy();
      expect(screen.getByText(/Open Integrations in General/i)).toBeTruthy();
    });
  });

  // =========================================================================
  // 3. CorrespondentsView
  // =========================================================================
  describe("CorrespondentsView", () => {
    const mockCorrespondents: Correspondent[] = [
      {
        connectorId: "conn-1",
        connectorName: "Work Email",
        kind: "imap",
        externalId: "alice@partner.org",
        name: "Alice Partner",
        email: "alice@partner.org",
        phone: undefined,
        seenCount: 5,
        lastSeenAt: new Date().toISOString(),
        localId: null,
        ignoredAt: null,
      },
    ];

    it("renders empty state when no correspondents exist", () => {
      vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);

      renderWithClient(<CorrespondentsView />);

      expect(screen.getByText("No one to review")).toBeTruthy();
      expect(
        screen.getByText(/When a connector syncs mail or meetings/i),
      ).toBeTruthy();
    });

    it("renders correspondents list with Add as contact and Ignore actions", async () => {
      vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
        data: mockCorrespondents,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);

      const createContactMock = vi.fn().mockResolvedValue({ id: "c-123" });
      vi.mocked(contactsApi.useCreateContact).mockReturnValue({
        mutateAsync: createContactMock,
        isPending: false,
      } as unknown as ReturnType<typeof contactsApi.useCreateContact>);

      const ignoreMock = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(connectorsApi.useIgnoreCorrespondent).mockReturnValue({
        mutateAsync: ignoreMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useIgnoreCorrespondent>);

      renderWithClient(<CorrespondentsView />);

      expect(screen.getByText("Alice Partner")).toBeTruthy();
      expect(screen.getByText("alice@partner.org")).toBeTruthy();

      const addBtn = screen.getByRole("button", { name: /Add as contact/i });
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(createContactMock).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Alice Partner",
            emails: [{ email: "alice@partner.org", label: "work" }],
          }),
        );
      });

      const ignoreBtn = screen.getByRole("button", { name: /Ignore/i });
      fireEvent.click(ignoreBtn);

      await waitFor(() => {
        expect(ignoreMock).toHaveBeenCalledWith({
          connectorId: "conn-1",
          externalId: "alice@partner.org",
        });
      });
    });
  });
});
