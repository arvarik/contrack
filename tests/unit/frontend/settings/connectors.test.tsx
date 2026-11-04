// @vitest-environment jsdom
/**
 * The connector screens' answers to what a browser test cannot easily cause:
 * a refused save, a failed load, a denied clipboard, and every way a run's
 * numbers are worded. The forms and the card's journeys are in
 * tests/e2e/connectors.spec.ts.
 */
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
import { ConnectorCard } from "../../../../src/views/settings/connectors/ConnectorCard";
import { ConnectorsView } from "../../../../src/views/settings/connectors/ConnectorsView";
import { RunHistoryDrawer } from "../../../../src/views/settings/connectors/RunHistoryDrawer";
import * as connectorsApi from "../../../../src/api/connectors";
import * as clipboard from "../../../../src/lib/clipboard";
import type {
  ConnectorRun,
  ConnectorSummary,
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

/** Makes the hook `name` return `value`. */
const hook = (name: keyof typeof connectorsApi, value: object) =>
  vi.mocked(connectorsApi[name] as () => unknown).mockReturnValue(value);

/** A mutation hook whose call resolves to `result`, or rejects with it. */
const mutation = (name: keyof typeof connectorsApi, result: unknown = {}) => {
  const mutateAsync =
    result instanceof Error
      ? vi.fn().mockRejectedValue(result)
      : vi.fn().mockResolvedValue(result);
  hook(name, { mutateAsync, isPending: false });
  return mutateAsync;
};

const connector = (
  overrides: Partial<ConnectorSummary> = {},
): ConnectorSummary => ({
  id: "conn-1",
  name: "Work Calendar",
  kind: "ics",
  status: "active",
  config: { url: "https://calendar.example.com/calendar.ics" },
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

const run = (overrides: Partial<ConnectorRun>): ConnectorRun => ({
  id: "run",
  connectorId: "conn-1",
  trigger: "manual",
  status: "ok",
  startedAt: "2026-02-01T10:00:00Z",
  finishedAt: "2026-02-01T10:00:01Z",
  stats: null,
  error: null,
  ...overrides,
});

const renderWithClient = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {ui}
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("connector screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hook("useConnectorKinds", { data: [], isLoading: false });
    hook("useConnectors", { data: [], isLoading: false, isError: false });
    hook("useConnectorRuns", { data: [], isLoading: false });
    hook("useCorrespondents", { data: [], isLoading: false });
    for (const name of [
      "useCreateConnector",
      "useTestConnector",
      "useUpdateConnector",
      "useDeleteConnector",
      "useSyncConnector",
    ] as const) {
      mutation(name);
    }
  });

  afterEach(cleanup);

  const renderCard = (overrides: Partial<ConnectorSummary> = {}) =>
    renderWithClient(
      <ConnectorCard
        connector={connector(overrides)}
        onEdit={vi.fn()}
        onShowRuns={vi.fn()}
      />,
    );

  it.each([
    [
      "5 meetings · 2 new people seen · 1 error",
      { meetings: 5, ghosts: 2, errors: 1 },
    ],
    [
      "1 meeting · 1 new person seen · 1 error",
      { meetings: 1, ghosts: 1, errors: 1 },
    ],
  ])("words the last sync as %s", (line, lastRunStats) => {
    renderCard({ lastRunStats });
    expect(screen.getByText(`Last sync: ${line}`)).toBeTruthy();
  });

  it("says why a pause or a removal failed, and keeps the dialog open for another try", async () => {
    mutation("useUpdateConnector", new Error("Update failed"));
    mutation("useDeleteConnector", new Error("Delete failed"));
    renderCard();
    const choose = (item: string) => {
      fireEvent.click(
        screen.getByRole("button", { name: "Actions for Work Calendar" }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: item }));
    };

    choose("Pause");
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not pause Work Calendar: Update failed",
      ),
    );

    choose("Remove");
    fireEvent.click(screen.getByRole("button", { name: "Remove connector" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not remove Work Calendar: Delete failed",
      ),
    );
    expect(screen.getByText("Remove Work Calendar?")).toBeTruthy();
  });

  it("words each run's status, trigger, numbers and length", () => {
    hook("useConnectorRuns", {
      isLoading: false,
      data: [
        run({
          id: "a",
          finishedAt: "2026-02-01T10:00:02.500Z",
          stats: { meetings: 12, ghosts: 3 },
        }),
        run({
          id: "b",
          trigger: "schedule",
          status: "error",
          stats: { errors: 1 },
          error: "401 Unauthorized token expired",
        }),
        run({ id: "c", status: "running", finishedAt: null }),
        run({
          id: "d",
          status: "custom_status" as ConnectorRun["status"],
          finishedAt: "2026-02-01T10:00:00.500Z",
          stats: { fetched: 15 },
        }),
        run({ id: "e", stats: { messages: 7, interactions: 10 } }),
        run({ id: "f", stats: { interactions: 4 } }),
      ],
    });
    renderWithClient(
      <RunHistoryDrawer isOpen onClose={vi.fn()} connector={connector()} />,
    );

    for (const text of [
      "Run history for Work Calendar",
      "running",
      "custom_status",
      "schedule run",
      "12 meetings · 3 new people seen",
      "1 error",
      "401 Unauthorized token expired",
      "No items processed",
      "15 fetched",
      "7 messages",
      "4 interactions",
      "2.5s",
      "500ms",
      "—",
    ]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("copies a run's details, and says so when the clipboard is denied", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const copy = vi.spyOn(clipboard, "copyToClipboard").mockResolvedValue();
    const skipped = run({ stats: { skipped: 4 } });
    hook("useConnectorRuns", { data: [skipped], isLoading: false });
    renderWithClient(
      <RunHistoryDrawer isOpen onClose={vi.fn()} connector={null} />,
    );
    expect(screen.getByText("4 skipped")).toBeTruthy();
    const copyBtn = screen.getByRole("button", { name: "Copy run details" });

    await act(async () => fireEvent.click(copyBtn));
    expect(copy).toHaveBeenCalledWith(JSON.stringify(skipped, null, 2));

    copy.mockRejectedValueOnce(new Error("Permission denied"));
    await act(async () => fireEvent.click(copyBtn));
    expect(toast.error).toHaveBeenCalledWith(clipboard.CLIPBOARD_DENIED);
    vi.useRealTimers();
  });

  it("offers to load the connectors again when loading failed", () => {
    const refetch = vi.fn();
    hook("useConnectors", { isLoading: false, isError: true, refetch });
    renderWithClient(<ConnectorsView />);

    expect(screen.getByText("Could not load connectors")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
