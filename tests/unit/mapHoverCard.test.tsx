// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MapHoverCard,
  formatCardLocalTime,
} from "../../src/views/map/MapHoverCard";
import type { MapContact } from "../../shared/geo";

vi.mock("react-map-gl/maplibre", () => ({
  Popup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("MapHoverCard", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const contact: MapContact = {
    id: "c1",
    name: "Ada Lovelace",
    company: "Babbage & Co",
    role: "Lead Mathematician",
    location: "London, UK",
    avatarUrl: null,
    isTracked: true,
    lat: 51.5074,
    lng: -0.1278,
    relationshipScore: 85,
    lastContactedAt: "2026-06-01T12:00:00.000Z",
    tags: ["math", "pioneer", "computing"],
    lists: [{ id: "l1", name: "Innovators" }],
  };

  const renderCard = (props: {
    pinned: boolean;
    onClose?: () => void;
    onOpen?: (id: string) => void;
    onLogNote?: (id: string) => void;
    onAddToList?: (id: string) => void;
    onFollowUp?: (id: string) => void;
  }) => {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <MapHoverCard
            contact={contact}
            pinned={props.pinned}
            onClose={props.onClose || vi.fn()}
            onOpen={props.onOpen}
            onLogNote={props.onLogNote}
            onAddToList={props.onAddToList}
            onFollowUp={props.onFollowUp}
          />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  };

  it("renders tooltip state with no interactive buttons", () => {
    renderCard({ pinned: false });

    // In tooltip state, role is tooltip
    expect(screen.getByRole("tooltip")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();

    // Contains facts: name, role at company, score text
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(
      screen.getByText("Lead Mathematician at Babbage & Co"),
    ).toBeDefined();
    expect(screen.getByText("Score 85")).toBeDefined();

    // No action buttons in tooltip state
    const buttons = screen.queryAllByRole("button");
    expect(buttons).toHaveLength(0);
  });

  it("renders pinned state with dialog role and exactly four action buttons", () => {
    const onOpen = vi.fn();
    const onLogNote = vi.fn();
    const onAddToList = vi.fn();
    const onFollowUp = vi.fn();

    renderCard({
      pinned: true,
      onOpen,
      onLogNote,
      onAddToList,
      onFollowUp,
    });

    // In pinned state, role is dialog
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();

    // Contains heading with name
    expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeDefined();

    // Check the four action buttons: Open, Log note, Add to list, Follow-up
    // (Plus ScoreBreakdown trigger button which is present when score is interactive)
    const openBtn = screen.getByRole("button", { name: /open contact/i });
    const logNoteBtn = screen.getByRole("button", { name: /log interaction/i });
    const addToListBtn = screen.getByRole("button", { name: /add to list/i });
    const followUpBtn = screen.getByRole("button", { name: /add follow-up/i });

    expect(openBtn).toBeDefined();
    expect(logNoteBtn).toBeDefined();
    expect(addToListBtn).toBeDefined();
    expect(followUpBtn).toBeDefined();

    // Verify button clicks
    fireEvent.click(openBtn);
    expect(onOpen).toHaveBeenCalledWith("c1");

    fireEvent.click(logNoteBtn);
    expect(onLogNote).toHaveBeenCalledWith("c1");

    fireEvent.click(addToListBtn);
    expect(onAddToList).toHaveBeenCalledWith("c1");

    fireEvent.click(followUpBtn);
    expect(onFollowUp).toHaveBeenCalledWith("c1");
  });

  it("renders local time for known coordinates", () => {
    // London: 51.5074, -0.1278
    const timeStr = formatCardLocalTime(51.5074, -0.1278);
    expect(timeStr).not.toBeNull();
    // e.g. "14:05 · GMT+1" or "14:05 · GMT"
    expect(timeStr).toMatch(/\d{2}:\d{2} · GMT/);

    // Null coordinates return null
    expect(formatCardLocalTime(null, null)).toBeNull();
  });

  it("closes on Escape key press in pinned mode", () => {
    const onClose = vi.fn();
    renderCard({ pinned: true, onClose });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
