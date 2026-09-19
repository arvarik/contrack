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
import { AddConnectorSheet } from "../../src/views/settings/connectors/AddConnectorSheet";
import { CalendarFormModal } from "../../src/views/settings/connectors/CalendarFormModal";
import { ConnectorCard } from "../../src/views/settings/connectors/ConnectorCard";
import { ConnectorsView } from "../../src/views/settings/connectors/ConnectorsView";
import { RunHistoryDrawer } from "../../src/views/settings/connectors/RunHistoryDrawer";
import * as connectorsApi from "../../src/api/connectors";
import * as clipboard from "../../src/lib/clipboard";
import type {
  ConnectorRun,
  ConnectorSummary,
  KindInfo,
} from "../../shared/connectors";

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
  connectorKeys: {
    all: ["connectors"],
    kinds: ["connectors", "kinds"],
    lists: () => ["connectors", "list"],
    detail: (id: string) => ["connectors", "detail", id],
    runs: (id: string) => ["connectors", "runs", id],
    correspondents: (limit?: number) => ["connectors", "correspondents", limit],
  },
}));

describe("Frontend Connectors Components", () => {
  let queryClient: QueryClient;

  const defaultKinds: KindInfo[] = [
    {
      kind: "ics",
      label: "Calendar",
      description:
        "Sync meetings and see what is coming up from a private ICS URL.",
      capabilities: { schedule: true },
    },
    {
      kind: "imap",
      label: "Mailbox (IMAP)",
      description: "Sync sent and received mail headers from any IMAP account.",
      capabilities: { schedule: true },
    },
    {
      kind: "google",
      label: "Google Workspace",
      description: "Sync contacts, mail and calendar with Google.",
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

    vi.mocked(connectorsApi.useConnector).mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useConnector>);

    vi.mocked(connectorsApi.useConnectorRuns).mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof connectorsApi.useConnectorRuns>);

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
  // 1. AddConnectorSheet
  // =========================================================================
  describe("AddConnectorSheet", () => {
    it("hides iMessage when not returned by server (e.g. non-darwin or Docker)", () => {
      const nonDarwinKinds: KindInfo[] = [
        {
          kind: "ics",
          label: "Calendar",
          description: "Sync meetings",
          capabilities: { schedule: true },
        },
        {
          kind: "imap",
          label: "Mailbox (IMAP)",
          description: "Sync emails",
          capabilities: { schedule: true },
        },
        {
          kind: "google",
          label: "Google Workspace",
          description: "Sync Google",
          capabilities: { schedule: true },
        },
      ];

      vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
        data: nonDarwinKinds,
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);

      renderWithClient(
        <AddConnectorSheet
          isOpen={true}
          onClose={vi.fn()}
          onSelectKind={vi.fn()}
        />,
      );

      expect(screen.getByText("Calendar")).toBeTruthy();
      expect(screen.getByText("Mailbox (IMAP)")).toBeTruthy();
      expect(screen.queryByText("iMessage")).toBeNull();
    });

    it("displays iMessage when host is darwin (and marks it appropriately)", () => {
      const darwinKinds: KindInfo[] = [
        {
          kind: "ics",
          label: "Calendar",
          description: "Sync meetings",
          capabilities: { schedule: true },
        },
        {
          kind: "imessage",
          label: "iMessage",
          description: "Sync iMessage conversations from this Mac",
          capabilities: { schedule: true, localOnly: "darwin" },
        },
      ];

      vi.mocked(connectorsApi.useConnectorKinds).mockReturnValue({
        data: darwinKinds,
        isLoading: false,
      } as unknown as ReturnType<typeof connectorsApi.useConnectorKinds>);

      renderWithClient(
        <AddConnectorSheet
          isOpen={true}
          onClose={vi.fn()}
          onSelectKind={vi.fn()}
        />,
      );

      expect(screen.getByText("Calendar")).toBeTruthy();
      expect(screen.getByText("iMessage")).toBeTruthy();
      expect(
        screen.getByText(/Runs on the Mac that hosts Contrack/i),
      ).toBeTruthy();
    });

    it("selecting an available kind (e.g. 'ics') calls onSelectKind('ics')", () => {
      const onSelectKindMock = vi.fn();

      renderWithClient(
        <AddConnectorSheet
          isOpen={true}
          onClose={vi.fn()}
          onSelectKind={onSelectKindMock}
        />,
      );

      const calendarBtn = screen.getByRole("button", { name: /^Calendar\b/ });
      fireEvent.click(calendarBtn);

      expect(onSelectKindMock).toHaveBeenCalledWith("ics");
    });

    it("cancel button calls onClose", () => {
      const onCloseMock = vi.fn();

      renderWithClient(
        <AddConnectorSheet
          isOpen={true}
          onClose={onCloseMock}
          onSelectKind={vi.fn()}
        />,
      );

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);

      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it("disables unavailable kinds and shows Coming soon badge", () => {
      const onSelectKindMock = vi.fn();

      renderWithClient(
        <AddConnectorSheet
          isOpen={true}
          onClose={vi.fn()}
          onSelectKind={onSelectKindMock}
        />,
      );

      const imapBtn = screen.getByRole("button", { name: /Mailbox \(IMAP\)/i });
      expect((imapBtn as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getAllByText("Coming soon").length).toBeGreaterThan(0);

      fireEvent.click(imapBtn);
      expect(onSelectKindMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. CalendarFormModal
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
        screen.getByText("Enter an ICS calendar URL before testing."),
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

      const urlInput = screen.getByLabelText("Private ICS Calendar URL");
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

    it("clicking Cancel calls onClose", () => {
      const onCloseMock = vi.fn();
      renderWithClient(
        <CalendarFormModal isOpen={true} onClose={onCloseMock} />,
      );

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);

      expect(onCloseMock).toHaveBeenCalled();
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

      const urlInput = screen.getByLabelText("Private ICS Calendar URL");
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
      const urlInput = screen.getByLabelText("Private ICS Calendar URL");
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
        "Please enter a name for this connector.",
      );

      fireEvent.change(nameInput, { target: { value: "Valid Name" } });
      const urlInput = screen.getByLabelText("Private ICS Calendar URL");
      fireEvent.change(urlInput, { target: { value: "   " } });
      fireEvent.submit(form);

      expect(screen.getByRole("alert").textContent).toContain(
        "Please enter a private ICS calendar URL.",
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

      const urlInput = screen.getByLabelText("Private ICS Calendar URL");
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
        "Ghost contact threshold",
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
  // 3. ConnectorCard
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
      expect(screen.getByText("Needs Reauth")).toBeTruthy();
      expect(screen.getByText("Authentication expired")).toBeTruthy();
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

    it("action menu option 'Pause' calls useUpdateConnector", async () => {
      const updateMutateAsync = vi.fn().mockResolvedValue({});
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: updateMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

      const connector = createMockConnector({
        id: "conn-pause-1",
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

      const pauseItem = screen.getByRole("menuitem", { name: "Pause" });
      fireEvent.click(pauseItem);

      await waitFor(() => {
        expect(updateMutateAsync).toHaveBeenCalledWith({
          id: "conn-pause-1",
          status: "paused",
        });
      });
    });

    it("action menu option 'Resume' calls useUpdateConnector", async () => {
      const updateMutateAsync = vi.fn().mockResolvedValue({});
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: updateMutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

      const connector = createMockConnector({
        id: "conn-resume-1",
        status: "paused",
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

      const resumeItem = screen.getByRole("menuitem", { name: "Resume" });
      fireEvent.click(resumeItem);

      await waitFor(() => {
        expect(updateMutateAsync).toHaveBeenCalledWith({
          id: "conn-resume-1",
          status: "active",
        });
      });
    });

    it("action menu option 'Edit' calls onEdit", () => {
      const onEditMock = vi.fn();
      const connector = createMockConnector({ id: "conn-edit-1" });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={onEditMock}
          onShowRuns={vi.fn()}
        />,
      );

      const menuTrigger = screen.getByRole("button", {
        name: `Actions for ${connector.name}`,
      });
      fireEvent.click(menuTrigger);

      const editItem = screen.getByRole("menuitem", { name: "Edit" });
      fireEvent.click(editItem);

      expect(onEditMock).toHaveBeenCalledWith(connector);
    });

    it("action menu option 'Run history' calls onShowRuns", () => {
      const onShowRunsMock = vi.fn();
      const connector = createMockConnector({ id: "conn-runs-1" });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={onShowRunsMock}
        />,
      );

      const menuTrigger = screen.getByRole("button", {
        name: `Actions for ${connector.name}`,
      });
      fireEvent.click(menuTrigger);

      const historyItem = screen.getByRole("menuitem", { name: "Run history" });
      fireEvent.click(historyItem);

      expect(onShowRunsMock).toHaveBeenCalledWith(connector);
    });

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
      await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());

      // Trigger delete error
      fireEvent.click(
        screen.getByRole("button", { name: `Actions for ${connector.name}` }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
      fireEvent.click(screen.getByRole("button", { name: "Remove connector" }));
      await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalled());
    });

    it("formatStats displays meetings, ghosts, and errors correctly", () => {
      const connector = createMockConnector({
        kind: "ics",
        lastRunStats: {
          meetings: 5,
          ghosts: 2,
          errors: 1,
        },
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      expect(
        screen.getByText("5 meetings · 2 new ghosts · 1 error"),
      ).toBeTruthy();
    });

    it("formatStats handles singular forms correctly", () => {
      const connector = createMockConnector({
        kind: "ics",
        lastRunStats: {
          meetings: 1,
          ghosts: 1,
          errors: 1,
        },
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
        />,
      );

      expect(
        screen.getByText("1 meeting · 1 new ghost · 1 error"),
      ).toBeTruthy();
    });

    it("renders needs_reauth state and offers Reconnect button calling onReconnect", () => {
      const onReconnectMock = vi.fn();
      const connector = createMockConnector({
        id: "conn-reauth-1",
        name: "Google Calendar",
        status: "needs_reauth",
        lastError: "Invalid credentials or feed token revoked",
      });

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
          onReconnect={onReconnectMock}
        />,
      );

      expect(screen.getByText("Needs Reauth")).toBeTruthy();
      expect(screen.getByText("Authentication expired")).toBeTruthy();
      expect(
        screen.getByText("Invalid credentials or feed token revoked"),
      ).toBeTruthy();

      const reconnectBtn = screen.getByRole("button", { name: "Reconnect" });
      expect(reconnectBtn).toBeTruthy();

      fireEvent.click(reconnectBtn);
      expect(onReconnectMock).toHaveBeenCalledWith(connector);
    });

    it("Reconnect button falls back to onEdit if onReconnect not provided", () => {
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
  // 4. RunHistoryDrawer
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

      expect(screen.getByText("No sync runs recorded")).toBeTruthy();
      expect(
        screen.getByText(
          "Sync history will appear here once the connector runs.",
        ),
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
      expect(screen.getByText("History Cal — Run History")).toBeTruthy();

      // Verify statuses
      expect(screen.getByText("ok")).toBeTruthy();
      expect(screen.getByText("error")).toBeTruthy();
      expect(screen.getByText("running")).toBeTruthy();

      // Verify triggers
      expect(screen.getByText("manual run")).toBeTruthy();
      expect(screen.getAllByText("schedule run").length).toBe(2);

      // Verify stats
      expect(screen.getByText("12 meetings · 3 new ghosts")).toBeTruthy();
      expect(screen.getByText("1 error")).toBeTruthy();
      expect(screen.getByText("No items processed")).toBeTruthy();

      // Verify error alert
      expect(screen.getByText("401 Unauthorized token expired")).toBeTruthy();

      // Verify timing / duration
      expect(screen.getByText("2.5s")).toBeTruthy();
      expect(screen.getByText("1.0s")).toBeTruthy();
      expect(screen.getByText("—")).toBeTruthy();
    });

    it("close button calls onClose", () => {
      const onCloseMock = vi.fn();

      renderWithClient(
        <RunHistoryDrawer
          isOpen={true}
          onClose={onCloseMock}
          connector={mockConnector}
        />,
      );

      const closeBtn = screen.getByRole("button", { name: "Close" });
      fireEvent.click(closeBtn);

      expect(onCloseMock).toHaveBeenCalledTimes(1);
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

      vi.useRealTimers();
    });

    it("formats empty and fallback stats and neutral status tone", () => {
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
  // 5. ConnectorsView
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

      expect(screen.getByText("Loading connectors…")).toBeTruthy();
    });

    it("renders empty gallery when no connectors exist", () => {
      vi.mocked(connectorsApi.useConnectors).mockReturnValue({
        data: [],
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof connectorsApi.useConnectors>);

      renderWithClient(<ConnectorsView />);

      expect(screen.getByText("Get started with Connectors")).toBeTruthy();
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

      const connectBtn = screen.getByRole("button", { name: "Connect" });
      fireEvent.click(connectBtn);

      expect(
        screen.getByRole("heading", { name: "Connect Calendar" }),
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

    it("clicking 'Add connector' opens AddConnectorSheet", () => {
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

      const addBtn = screen.getByRole("button", { name: /Add connector/i });
      fireEvent.click(addBtn);

      expect(
        screen.getByRole("heading", { name: "Add a Connector" }),
      ).toBeTruthy();
    });

    it("selecting Calendar from AddConnectorSheet opens CalendarFormModal", () => {
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
        screen.getByRole("heading", { name: "Add a Connector" }),
      ).toBeTruthy();

      // Click Calendar inside sheet
      const calSheetBtn = screen.getByRole("button", { name: /^Calendar\b/ });
      fireEvent.click(calSheetBtn);

      // Sheet closes and CalendarFormModal opens
      expect(
        screen.getByRole("heading", { name: "Connect Calendar" }),
      ).toBeTruthy();
    });

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

    it("clicking Run history on a connector card opens RunHistoryDrawer", () => {
      const connector = createMockConnector({
        id: "conn-history-view",
        name: "Personal iCloud",
        kind: "ics",
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

      const historyItem = screen.getByRole("menuitem", { name: "Run history" });
      fireEvent.click(historyItem);

      expect(
        screen.getByRole("heading", {
          name: "Personal iCloud — Run History",
        }),
      ).toBeTruthy();
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

      expect(screen.getByText("Failed to load connectors")).toBeTruthy();
      const retryBtn = screen.getByRole("button", { name: "Retry" });
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
        screen.getByRole("heading", { name: "Add a Connector" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(
        screen.queryByRole("heading", { name: "Add a Connector" }),
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
        screen.getByRole("heading", { name: "Cal 1 — Run History" }),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(
        screen.queryByRole("heading", { name: "Cal 1 — Run History" }),
      ).toBeNull();
    });
  });
});
