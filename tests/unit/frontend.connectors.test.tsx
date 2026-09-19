// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AddConnectorSheet } from "../../src/views/settings/connectors/AddConnectorSheet";
import { CalendarFormModal } from "../../src/views/settings/connectors/CalendarFormModal";
import { ConnectorCard } from "../../src/views/settings/connectors/ConnectorCard";
import * as connectorsApi from "../../src/api/connectors";
import type { ConnectorSummary, KindInfo } from "../../shared/connectors";

vi.mock("../../src/api/connectors", () => ({
  useConnectorKinds: vi.fn(),
  useConnectors: vi.fn(),
  useConnector: vi.fn(),
  useCreateConnector: vi.fn(),
  useTestConnector: vi.fn(),
  useUpdateConnector: vi.fn(),
  useDeleteConnector: vi.fn(),
  useSyncConnector: vi.fn(),
}));

describe("Frontend Connectors Components", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
  });

  const renderWithClient = (ui: React.ReactElement) =>
    render(
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
    );

  describe("AddConnectorSheet gallery", () => {
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
  });

  describe("CalendarFormModal test connection button", () => {
    it("provides feedback when testing connection succeeds", async () => {
      const mutateAsyncMock = vi.fn().mockResolvedValue({
        ok: true,
        detail: "Found 42 events in calendar feed",
      });

      vi.mocked(connectorsApi.useTestConnector).mockReturnValue({
        mutateAsync: mutateAsyncMock,
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useTestConnector>);
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

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
      vi.mocked(connectorsApi.useCreateConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useCreateConnector>);
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);

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
  });

  describe("ConnectorCard needs_reauth", () => {
    it("renders needs_reauth state and offers Reconnect button", () => {
      const onReconnectMock = vi.fn();
      const connector: ConnectorSummary = {
        id: "conn-reauth-1",
        name: "Google Calendar",
        kind: "ics",
        status: "needs_reauth",
        config: {},
        secretPresent: false,
        lastRunAt: "2026-02-01T12:00:00Z",
        nextRunAt: null,
        lastError: "Invalid credentials or feed token revoked",
        lastRunStats: null,
        intervalMinutes: 30,
        createdAt: "2026-02-01T10:00:00Z",
        updatedAt: "2026-02-01T12:00:00Z",
      };

      vi.mocked(connectorsApi.useSyncConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useSyncConnector>);
      vi.mocked(connectorsApi.useUpdateConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useUpdateConnector>);
      vi.mocked(connectorsApi.useDeleteConnector).mockReturnValue({
        mutateAsync: vi.fn(),
        isPending: false,
      } as unknown as ReturnType<typeof connectorsApi.useDeleteConnector>);

      renderWithClient(
        <ConnectorCard
          connector={connector}
          onEdit={vi.fn()}
          onShowRuns={vi.fn()}
          onReconnect={onReconnectMock}
        />,
      );

      // Verify status badge
      expect(screen.getByText("Needs Reauth")).toBeTruthy();

      // Verify warning message
      expect(screen.getByText("Authentication expired")).toBeTruthy();
      expect(
        screen.getByText("Invalid credentials or feed token revoked"),
      ).toBeTruthy();

      // Verify Reconnect button
      const reconnectBtn = screen.getByRole("button", { name: "Reconnect" });
      expect(reconnectBtn).toBeTruthy();

      fireEvent.click(reconnectBtn);
      expect(onReconnectMock).toHaveBeenCalledWith(connector);
    });
  });
});
