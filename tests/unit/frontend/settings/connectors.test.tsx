// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { CalendarFormModal } from "../../../../src/views/settings/connectors/CalendarFormModal";
import { ConnectorCard } from "../../../../src/views/settings/connectors/ConnectorCard";
import { ConnectorsView } from "../../../../src/views/settings/connectors/ConnectorsView";
import { RunHistoryDrawer } from "../../../../src/views/settings/connectors/RunHistoryDrawer";
import * as connectorsApi from "../../../../src/api/connectors";
import * as clipboard from "../../../../src/lib/clipboard";
import type {
  ConnectorRun,
  ConnectorSummary,
  KindInfo,
} from "../../../../shared/connectors";

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
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("Frontend Connectors Components", () => {
  let queryClient: QueryClient;

  const defaultKinds: KindInfo[] = [
    {
      kind: "ics",
      label: "Calendar",
      description:
        "Sync meetings and see what is coming up from a private ICS URL",
      capabilities: { schedule: true },
    },
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
      capabilities: { schedule: true },
    },
  ];

  const createMockConnector = (
    overrides?: Partial<ConnectorSummary>,
  ): ConnectorSummary => ({
    id: "conn-1",
    name: "Google Calendar",
    kind: "ics",
    status: "active",
    config: { url: "https://calendar.google.com/calendar.ics" },
    secretPresent: false,
    intervalMinutes: 30,
    nextRunAt: "2026-02-01T12:30:00Z",
    lastRunAt: "2026-02-01T12:00:00Z",
    lastError: null,
    lastRunStats: null,
    createdAt: "2026-02-01T10:00:00Z",
    updatedAt: "2026-02-01T12:00:00Z",
    ...overrides,
  });

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();

    vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
      data: defaultKinds,
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);

    vi.mocked(connectorsApi.useConnectors).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

    vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

    vi.mocked(connectorsApi.useCorrespondents).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useCorrespondents>);

    vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "created-conn-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

    vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "updated-conn-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

    vi.mocked(connectorsApi.useDeleteConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ id: "deleted-conn-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useDeleteConnector>);

    vi.mocked(connectorsApi.useSyncConnector).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ runId: "sync-run-1" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useSyncConnector>);

    vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
      mutateAsync: vi
        .fn()
        .mockResolvedValue({ ok: true, detail: "Connection test succeeded" }),
      isPending: false,
    } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);
  });

  afterEach(() => {
    cleanup();
  });

  const renderWithClient = (ui: React.ReactElement) =>
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    );

  // =========================================================================
  // 1. CalendarFormModal
  // =========================================================================
  describe("CalendarFormModal", () => {
    it("provides feedback when testing connection succeeds", async () => {
      const mutateAsyncMock = vi.fn().mockResolvedValue({
        ok: true,
        detail: "Found 42 events in calendar feed",
      });

      vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
        mutateAsync: mutateAsyncMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);

      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);

      const urlInput = screen.getByPlaceholderText(
        /https:\/\/calendar\.google\.com\//i,
      );
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/calendar.ics" },
      });

      const testBtn = screen.getByRole("button", { name: /test connection/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(mutateAsyncMock).toHaveBeenCalledWith({
          kind: "ics",
          config: expect.objectContaining({
            url: "https://example.com/calendar.ics",
          }),
        });
        expect(
          screen.getByText("Found 42 events in calendar feed"),
        ).toBeTruthy();
      });
    });

    it("displays error feedback when testing connection fails", async () => {
      const mutateAsyncMock = vi
        .fn()
        .mockRejectedValue(new Error("Unable to reach calendar feed: 404"));

      vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
        mutateAsync: mutateAsyncMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);

      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);

      const urlInput = screen.getByPlaceholderText(
        /https:\/\/calendar\.google\.com\//i,
      );
      fireEvent.change(urlInput, {
        target: { value: "https://example.com/bad.ics" },
      });

      const testBtn = screen.getByRole("button", { name: /test connection/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(
          screen.getByText("Unable to reach calendar feed: 404"),
        ).toBeTruthy();
      });
    });

    it("displays error when clicking test connection with empty URL", async () => {
      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);

      const testBtn = screen.getByRole("button", { name: /test connection/i });
      fireEvent.click(testBtn);

      expect(
        screen.getByText("Enter an ICS calendar URL before testing"),
      ).toBeTruthy();
    });

    it("submitting form in create mode calls useCreateConnector mutation and onClose", async () => {
      const createMutateAsync = vi.fn().mockResolvedValue({ id: "conn-new-1" });
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);
      const onCloseMock = vi.fn();

      renderWithClient(
        <CalendarFormModal isOpen={true} onClose={onCloseMock} />,
      );

      const nameInput = screen.getByLabelText("Connector name");
      fireEvent.change(nameInput, { target: { value: "My Work Calendar" } });

      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      fireEvent.change(urlInput, {
        target: { value: "https://calendar.google.com/feed.ics" },
      });

      const submitBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(createMutateAsync).toHaveBeenCalledWith({
          kind: "ics",
          name: "My Work Calendar",
          config: {
            url: "https://calendar.google.com/feed.ics",
            lookbackDays: 90,
            maxAttendees: 25,
            includeDescription: false,
            ghostThreshold: 3,
          },
          intervalMinutes: 30,
        });
        expect(onCloseMock).toHaveBeenCalled();
      });
    });

    it("editing existing connector pre-fills fields and submitting calls useUpdateConnector", async () => {
      const updateMutateAsync = vi
        .fn()
        .mockResolvedValue({ id: "conn-edit-1" });
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: updateMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);
      const onCloseMock = vi.fn();

      const existingConnector = createMockConnector({
        id: "conn-edit-1",
        name: "Existing Work Calendar",
        intervalMinutes: 60,
        config: {
          url: "https://work.example.com/cal.ics",
          lookbackDays: 30,
          maxAttendees: 50,
          includeDescription: true,
          ghostThreshold: 5,
        },
      });

      renderWithClient(
        <CalendarFormModal
          isOpen={true}
          onClose={onCloseMock}
          connector={existingConnector}
        />,
      );

      expect(screen.getByDisplayValue("Existing Work Calendar")).toBeTruthy();
      expect(
        screen.getByDisplayValue("https://work.example.com/cal.ics"),
      ).toBeTruthy();

      const saveBtn = screen.getByRole("button", { name: "Save changes" });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateMutateAsync).toHaveBeenCalledWith({
          id: "conn-edit-1",
          name: "Existing Work Calendar",
          config: {
            url: "https://work.example.com/cal.ics",
            lookbackDays: 30,
            maxAttendees: 50,
            includeDescription: true,
            ghostThreshold: 5,
          },
          intervalMinutes: 60,
        });
        expect(onCloseMock).toHaveBeenCalled();
      });
    });

    it("displays error message if submitting fails", async () => {
      const createMutateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Server validation error"));
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);

      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      fireEvent.change(urlInput, {
        target: { value: "https://calendar.google.com/feed.ics" },
      });

      const submitBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toContain(
          "Server validation error",
        );
      });
    });

    it("toggles URL visibility between password and text", () => {
      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);
      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      expect(urlInput.getAttribute("type")).toBe("password");

      const toggleBtn = screen.getByRole("button", { name: "Show URL" });
      fireEvent.click(toggleBtn);
      expect(urlInput.getAttribute("type")).toBe("text");

      const hideBtn = screen.getByRole("button", { name: "Hide URL" });
      fireEvent.click(hideBtn);
      expect(urlInput.getAttribute("type")).toBe("password");
    });

    it("validates empty name and empty url on form submit", () => {
      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);
      const nameInput = screen.getByLabelText("Connector name");
      fireEvent.change(nameInput, { target: { value: "   " } });
      const form = nameInput.closest("form")!;
      fireEvent.submit(form);

      expect(screen.getByRole("alert").textContent).toContain(
        "Enter a name for this connector",
      );

      fireEvent.change(nameInput, { target: { value: "Valid Name" } });
      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      fireEvent.change(urlInput, { target: { value: "   " } });
      fireEvent.submit(form);

      expect(screen.getByRole("alert").textContent).toContain(
        "Enter a private ICS calendar URL",
      );
    });

    it("updates form controls for interval, lookback, attendees, ghost threshold, and description switch", async () => {
      const createMutateAsync = vi.fn().mockResolvedValue({ id: "conn-new" });
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: createMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);

      renderWithClient(<CalendarFormModal isOpen={true} onClose={vi.fn()} />);

      const nameInput = screen.getByLabelText("Connector name");
      fireEvent.change(nameInput, { target: { value: "Custom Config" } });

      const urlInput = screen.getByLabelText("Private ICS calendar URL");
      fireEvent.change(urlInput, {
        target: { value: "https://custom.com/cal.ics" },
      });

      // Change interval to Hourly (60)
      const hourlyBtn = screen.getByRole("radio", { name: "Hourly" });
      fireEvent.click(hourlyBtn);

      // Change lookback to 1 year (365)
      const oneYearBtn = screen.getByRole("radio", { name: "1 year" });
      fireEvent.click(oneYearBtn);

      // Change max attendees
      const maxAttendeesInput = screen.getByLabelText(
        "Skip events with more than",
      );
      fireEvent.change(maxAttendeesInput, { target: { value: "50" } });

      // Change ghost threshold
      const ghostThresholdInput = screen.getByLabelText(
        "Suggest a new person after",
      );
      fireEvent.change(ghostThresholdInput, { target: { value: "7" } });

      // Toggle switch
      const switchBtn = screen.getByRole("switch", {
        name: "Include event descriptions",
      });
      fireEvent.click(switchBtn);

      const submitBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(createMutateAsync).toHaveBeenCalledWith({
          kind: "ics",
          name: "Custom Config",
          config: {
            url: "https://custom.com/cal.ics",
            lookbackDays: 365,
            maxAttendees: 50,
            includeDescription: true,
            ghostThreshold: 7,
          },
          intervalMinutes: 60,
        });
      });
    });
  });

  // =========================================================================
  // 2. ConnectorCard
  // =========================================================================
  describe("ConnectorCard", () => {
    it("renders active, paused, error, needs_reauth status badges", () => {
      const { unmount: unmount1 } = renderWithClient(
        <ConnectorCard
          connector={createMockConnector({ status: "active" })}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );
      expect(screen.getByText("Active")).toBeTruthy();
      unmount1();

      const { unmount: unmount2 } = renderWithClient(
        <ConnectorCard
          connector={createMockConnector({ status: "paused" })}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );
      expect(screen.getByText("Paused")).toBeTruthy();
      expect(screen.getByText("Sync paused")).toBeTruthy();
      unmount2();

      const { unmount: unmount3 } = renderWithClient(
        <ConnectorCard
          connector={createMockConnector({
            status: "error",
            lastError: "Network unreachable",
          })}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );
      expect(screen.getByText("Error")).toBeTruthy();
      expect(screen.getByText("Last sync failed")).toBeTruthy();
      expect(screen.getByText("Network unreachable")).toBeTruthy();
      unmount3();

      renderWithClient(
        <ConnectorCard
          connector={createMockConnector({
            status: "needs_reauth",
            lastError: "Session expired",
          })}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );
      expect(screen.getByText("Signed out")).toBeTruthy();
      expect(screen.getByText("Sign-in expired")).toBeTruthy();
      expect(screen.getByText("Session expired")).toBeTruthy();
    });

    it("action menu option 'Sync now' calls useSyncConnector mutation", async () => {
      const syncMutateAsync = vi.fn().mockResolvedValue({ runId: "run-sync" });
      vi.mocked(connectorsApi.useSyncConnector).mockReturnValue({
        mutateAsync: syncMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useSyncConnector>);

      const connector = createMockConnector({
        id: "conn-sync-1",
        name: "Sync Test Cal",
        status: "active",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      const menuTrigger = screen.getByRole("button", {
        name: `Actions for ${connector.name}`,
      });
      fireEvent.click(menuTrigger);

      const syncItem = screen.getByRole("menuitem", { name: "Sync now" });
      fireEvent.click(syncItem);

      await waitFor(() => {
        expect(syncMutateAsync).toHaveBeenCalledWith("conn-sync-1");
      });
    });

    it.each([
      ["Pause", "active", "paused"],
      ["Resume", "paused", "active"],
    ] as const)(
      "action menu option '%s' calls useUpdateConnector",
      async (item, status, nextStatus) => {
        const updateMutateAsync = vi.fn().mockResolvedValue({});
        vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
          mutateAsync: updateMutateAsync,
          isPending: false,
        } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

        const connector = createMockConnector({
          id: "conn-toggle-1",
          status,
        });

        renderWithClient(
          <ConnectorCard
            connector={connector}
            onEdit={vi.fn()}
            onShowRuns={vi.fn()}
          />,
        );

        const menuTrigger = screen.getByRole("button", {
          name: `Actions for ${connector.name}`,
        });
        fireEvent.click(menuTrigger);

        fireEvent.click(screen.getByRole("menuitem", { name: item }));

        await waitFor(() => {
          expect(updateMutateAsync).toHaveBeenCalledWith({
            id: "conn-toggle-1",
            status: nextStatus,
          });
        });
      },
    );

    it("action menu option 'Remove' opens ConfirmDialog; checking deleteImported and confirming calls useDeleteConnector", async () => {
      const deleteMutateAsync = vi.fn().mockResolvedValue({});
      vi.mocked(connectorsApi.useDeleteConnector).mockReturnValue({
        mutateAsync: deleteMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useDeleteConnector>);

      const connector = createMockConnector({
        id: "conn-remove-1",
        name: "Remove Test Cal",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      const menuTrigger = screen.getByRole("button", {
        name: `Actions for ${connector.name}`,
      });
      fireEvent.click(menuTrigger);

      const removeItem = screen.getByRole("menuitem", { name: "Remove" });
      fireEvent.click(removeItem);

      // Confirm dialog is opened
      expect(screen.getByText("Remove Remove Test Cal?")).toBeTruthy();

      // Check deleteImported checkbox
      const checkbox = screen.getByRole("checkbox");
      expect((checkbox as HTMLInputElement).checked).toBe(false);
      fireEvent.click(checkbox);
      expect((checkbox as HTMLInputElement).checked).toBe(true);

      // Confirm deletion
      const confirmBtn = screen.getByRole("button", {
        name: "Remove connector",
      });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(deleteMutateAsync).toHaveBeenCalledWith({
          id: "conn-remove-1",
          deleteImported: true,
        });
      });
    });

    it("cancels remove ConfirmDialog without deleting", () => {
      const deleteMutateAsync = vi.fn();
      vi.mocked(connectorsApi.useDeleteConnector).mockReturnValue({
        mutateAsync: deleteMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useDeleteConnector>);

      const connector = createMockConnector({
        id: "conn-cancel-del",
        name: "Keep This",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      fireEvent.click(
        screen.getByRole("button", { name: `Actions for ${connector.name}` }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
      expect(screen.getByText("Remove Keep This?")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByText("Remove Keep This?")).toBeNull();
      expect(deleteMutateAsync).not.toHaveBeenCalled();
    });

    it("handles update and delete errors gracefully", async () => {
      const updateMutateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Update failed"));
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: updateMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

      const deleteMutateAsync = vi
        .fn()
        .mockRejectedValue(new Error("Delete failed"));
      vi.mocked(connectorsApi.useDeleteConnector).mockReturnValue({
        mutateAsync: deleteMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useDeleteConnector>);

      const connector = createMockConnector({
        id: "conn-err-card",
        name: "Error Card",
        status: "active",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      // Trigger pause error
      fireEvent.click(
        screen.getByRole("button", { name: `Actions for ${connector.name}` }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Update failed"),
      );

      // Trigger delete error: the dialog stays open for another try
      fireEvent.click(
        screen.getByRole("button", { name: `Actions for ${connector.name}` }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove connector" }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Delete failed"),
      );
      expect(screen.getByText("Remove Error Card?")).toBeTruthy();
    });

    it.each([
      [
        "5 meetings · 2 new people seen · 1 error",
        { meetings: 5, ghosts: 2, errors: 1 },
      ],
      [
        "1 meeting · 1 new person seen · 1 error",
        { meetings: 1, ghosts: 1, errors: 1 },
      ],
    ])("formatStats displays %s", (line, lastRunStats) => {
      const connector = createMockConnector({ kind: "ics", lastRunStats });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      expect(screen.getByText(`Last sync: ${line}`)).toBeTruthy();
    });

    it("Reconnect button opens the connector for editing", () => {
      const onEditMock = vi.fn();
      const connector = createMockConnector({
        id: "conn-reauth-2",
        status: "needs_reauth",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={onEditMock}
          onShowRuns={vi.fn()}
        />,
      );

      const reconnectBtn = screen.getByRole("button", { name: "Reconnect" });
      fireEvent.click(reconnectBtn);
      expect(onEditMock).toHaveBeenCalledWith(connector);
    });

    it("Retry button on error card triggers sync", async () => {
      const syncMutateAsync = vi.fn().mockResolvedValue({ runId: "retry-run" });
      vi.mocked(connectorsApi.useSyncConnector).mockReturnValue({
        mutateAsync: syncMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useSyncConnector>);

      const connector = createMockConnector({
        id: "conn-error-retry",
        status: "error",
        lastError: "Feed unreachable",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      const retryBtn = screen.getByRole("button", { name: "Retry now" });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(syncMutateAsync).toHaveBeenCalledWith("conn-error-retry");
      });
    });
  });

  // =========================================================================
  // 3. RunHistoryDrawer
  // =========================================================================
  describe("RunHistoryDrawer", () => {
    const mockConnector = createMockConnector({
      id: "conn-history-test",
      name: "History Cal",
    });

    it("renders loading state when loading runs", () => {
      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer
          isOpen={true}
          onClose={vi.fn()}
          connector={mockConnector}
        />,
      );

      expect(screen.getByText("Loading runs…")).toBeTruthy();
    });

    it("renders empty state when no runs are recorded", () => {
      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer
          isOpen={true}
          onClose={vi.fn()}
          connector={mockConnector}
        />,
      );

      expect(screen.getByText("No syncs yet")).toBeTruthy();
      expect(
        screen.getByText("Each sync shows up here once the connector runs"),
      ).toBeTruthy();
    });

    it("renders list of runs with ok/error/running statuses, stats, and timing", () => {
      const mockRuns: ConnectorRun[] = [
        {
          id: "run-1",
          connectorId: "conn-history-test",
          trigger: "manual",
          status: "ok",
          startedAt: "2026-02-01T12:00:00.000Z",
          finishedAt: "2026-02-01T12:00:02.500Z",
          stats: { meetings: 12, ghosts: 3 },
          error: null,
        },
        {
          id: "run-2",
          connectorId: "conn-history-test",
          trigger: "schedule",
          status: "error",
          startedAt: "2026-02-01T11:00:00.000Z",
          finishedAt: "2026-02-01T11:00:01.000Z",
          stats: { errors: 1 },
          error: "401 Unauthorized token expired",
        },
        {
          id: "run-3",
          connectorId: "conn-history-test",
          trigger: "schedule",
          status: "running",
          startedAt: "2026-02-01T13:00:00.000Z",
          finishedAt: null,
          stats: null,
          error: null,
        },
      ];

      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: mockRuns,
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer
          isOpen={true}
          onClose={vi.fn()}
          connector={mockConnector}
        />,
      );

      // Verify modal title
      expect(screen.getByText("Run history for History Cal")).toBeTruthy();

      // Verify statuses
      expect(screen.getByText("ok")).toBeTruthy();
      expect(screen.getByText("error")).toBeTruthy();
      expect(screen.getByText("running")).toBeTruthy();

      // Verify triggers
      expect(screen.getByText("manual run")).toBeTruthy();
      expect(screen.getAllByText("schedule run").length).toBe(2);

      // Verify stats
      expect(screen.getByText("12 meetings · 3 new people seen")).toBeTruthy();
      expect(screen.getByText("1 error")).toBeTruthy();
      expect(screen.getByText("No items processed")).toBeTruthy();

      // Verify error alert
      expect(screen.getByText("401 Unauthorized token expired")).toBeTruthy();

      // Verify timing / duration
      expect(screen.getByText("2.5s")).toBeTruthy();
      expect(screen.getByText("1.0s")).toBeTruthy();
      expect(screen.getByText("—")).toBeTruthy();
    });

    it("handles copy details to clipboard and clipboard error fallback", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const copySpy = vi
        .spyOn(clipboard, "copyToClipboard")
        .mockResolvedValue();
      const run: ConnectorRun = {
        id: "run-copy",
        connectorId: "conn-hist-1",
        trigger: "manual",
        status: "ok",
        startedAt: "2026-02-01T10:00:00Z",
        finishedAt: "2026-02-01T10:00:02Z",
        stats: { skipped: 4 },
        error: null,
      };
      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: [run],
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer
          isOpen={true}
          onClose={vi.fn()}
          connector={mockConnector}
        />,
      );

      expect(screen.getByText("4 skipped")).toBeTruthy();

      const copyBtn = screen.getByRole("button", {
        name: "Copy run details",
      });
      await act(async () => {
        fireEvent.click(copyBtn);
      });

      expect(copySpy).toHaveBeenCalledWith(JSON.stringify(run, null, 2));

      // Test clipboard failure
      copySpy.mockRejectedValueOnce(new Error("Permission denied"));
      await act(async () => {
        fireEvent.click(copyBtn);
      });
      expect(toast.error).toHaveBeenCalledWith(clipboard.CLIPBOARD_DENIED);

      vi.useRealTimers();
    });

    it("formats fetched-only stats, a sub-second duration, and an unknown status label", () => {
      const run: ConnectorRun = {
        id: "run-neutral",
        connectorId: "conn-hist-1",
        trigger: "manual",
        status: "custom_status" as unknown as ConnectorRun["status"],
        startedAt: "2026-02-01T10:00:00Z",
        finishedAt: "2026-02-01T10:00:00.500Z",
        stats: { fetched: 15 },
        error: null,
      };
      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: [run],
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer isOpen={true} onClose={vi.fn()} connector={null} />,
      );

      expect(screen.getByText("15 fetched")).toBeTruthy();
      expect(screen.getByText("500ms")).toBeTruthy();
      expect(screen.getByText("custom_status")).toBeTruthy();
    });

    it("formats messages and interactions in run stats", () => {
      const run: ConnectorRun = {
        id: "run-msg-int",
        connectorId: "conn-hist-1",
        trigger: "manual",
        status: "ok",
        startedAt: "2026-02-01T10:00:00Z",
        finishedAt: "2026-02-01T10:00:01Z",
        stats: { messages: 7, interactions: 10 },
        error: null,
      };
      const run2: ConnectorRun = {
        id: "run-interactions-only",
        connectorId: "conn-hist-1",
        trigger: "manual",
        status: "ok",
        startedAt: "2026-02-01T10:00:00Z",
        finishedAt: "2026-02-01T10:00:01Z",
        stats: { interactions: 4 },
        error: null,
      };
      vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
        data: [run, run2],
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

      renderWithClient(
        <RunHistoryDrawer isOpen={true} onClose={vi.fn()} connector={null} />,
      );

      expect(screen.getByText("7 messages")).toBeTruthy();
      expect(screen.getByText("4 interactions")).toBeTruthy();
    });
  });

  // =========================================================================
  // 4. ConnectorsView
  // =========================================================================
  describe("ConnectorsView", () => {
    it("renders loading skeleton", () => {
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      expect(screen.getByLabelText("Loading connectors")).toBeTruthy();
    });

    it("renders empty gallery when no connectors exist", () => {
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      expect(
        screen.getByRole("heading", { name: "Add a connector" }),
      ).toBeTruthy();
      expect(
        screen.getByText(/Contrack learns who you talk to from your calendar/i),
      ).toBeTruthy();
      expect(screen.getByText("Calendar")).toBeTruthy();
      expect(screen.getByText("Mailbox (IMAP)")).toBeTruthy();

      // Top header "Add connector" button is not shown when empty
      expect(
        screen.queryByRole("button", { name: /Add connector/i }),
      ).toBeNull();
    });

    it("clicking 'Connect' on Calendar in empty state opens modal", () => {
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      fireEvent.click(screen.getByRole("button", { name: "Connect Calendar" }));

      expect(
        screen.getByRole("heading", { name: "Connect calendar" }),
      ).toBeTruthy();
    });

    it("renders connector cards when connectors exist", () => {
      const connectorsList = [
        createMockConnector({ id: "conn-v1", name: "Primary Calendar" }),
        createMockConnector({
          id: "conn-v2",
          name: "Secondary Calendar",
          status: "paused",
        }),
      ];

      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: connectorsList,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      expect(screen.getByText("Primary Calendar")).toBeTruthy();
      expect(screen.getByText("Secondary Calendar")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Add connector/i }),
      ).toBeTruthy();
    });

    it.each([
      ["Calendar", /^Calendar\b/, "Connect calendar"],
      ["Mailbox (IMAP)", /Mailbox \(IMAP\)/i, "Connect mailbox (IMAP)"],
      ["Google Workspace", /Google Workspace/i, "Connect Google Workspace"],
    ])(
      "selecting %s from AddConnectorSheet opens its form",
      (_kind, tile, heading) => {
        const connectorsList = [
          createMockConnector({ id: "conn-v1", name: "Primary Calendar" }),
        ];

        vi.mocked(connectorsApi.useConnectors).mockReturnValue({
          data: connectorsList,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

        renderWithClient(<ConnectorsView />);

        // Open sheet
        fireEvent.click(screen.getByRole("button", { name: /Add connector/i }));
        expect(
          screen.getByRole("heading", { name: "Add a connector" }),
        ).toBeTruthy();

        // Click the kind inside sheet
        fireEvent.click(screen.getByRole("button", { name: tile }));

        // Sheet closes and the kind's form opens
        expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
      },
    );

    it("clicking Edit on a connector card opens CalendarFormModal in edit mode", () => {
      const connector = createMockConnector({
        id: "conn-edit-view",
        name: "Personal iCloud",
        kind: "ics",
        config: { url: "https://icloud.com/feed.ics" },
      });

      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: [connector],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      const menuTrigger = screen.getByRole("button", {
        name: `Actions for ${connector.name}`,
      });
      fireEvent.click(menuTrigger);

      const editItem = screen.getByRole("menuitem", { name: "Edit" });
      fireEvent.click(editItem);

      expect(
        screen.getByRole("heading", { name: "Edit Personal iCloud" }),
      ).toBeTruthy();
      expect(screen.getByDisplayValue("Personal iCloud")).toBeTruthy();
    });

    it("renders error state and retry button when loading connectors fails", () => {
      const refetchMock = vi.fn();
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: undefined,
        isLoading: false,
        isError: true,
        refetch: refetchMock,
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      expect(screen.getByText("Connectors did not load")).toBeTruthy();
      const retryBtn = screen.getByRole("button", { name: "Try again" });
      fireEvent.click(retryBtn);

      expect(refetchMock).toHaveBeenCalledTimes(1);
    });

    it("closes AddConnectorSheet, CalendarFormModal, and RunHistoryDrawer when requested", () => {
      const connector = createMockConnector({ id: "conn-1", name: "Cal 1" });
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: [connector],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      // Open and close AddConnectorSheet
      fireEvent.click(screen.getByRole("button", { name: /Add connector/i }));
      expect(
        screen.getByRole("heading", { name: "Add a connector" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByRole("heading", { name: "Add a connector" }),
      ).toBeNull();

      // Open and close CalendarFormModal via card edit
      const menuTrigger = screen.getByRole("button", {
        name: "Actions for Cal 1",
      });
      fireEvent.click(menuTrigger);
      fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
      expect(screen.getByRole("heading", { name: "Edit Cal 1" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("heading", { name: "Edit Cal 1" })).toBeNull();

      // Open and close RunHistoryDrawer via card runs
      fireEvent.click(menuTrigger);
      fireEvent.click(screen.getByRole("menuitem", { name: "Run history" }));
      expect(
        screen.getByRole("heading", { name: "Run history for Cal 1" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(
        screen.queryByRole("heading", { name: "Run history for Cal 1" }),
      ).toBeNull();
    });
  });
});
