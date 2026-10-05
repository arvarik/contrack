// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapHoverCard } from "../../../../src/views/map/MapHoverCard";
import type { MapContact } from "../../../../shared/geo";

vi.mock("@vis.gl/react-maplibre", () => ({
  Popup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(cleanup);

/** A day `days` before today, as the date a follow-up is stored with. */
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const contact: MapContact = {
  id: "c1",
  name: "Rowan Vale",
  company: "Northwind Partners",
  role: "Partner",
  location: "London, UK",
  avatarUrl: null,
  isTracked: true,
  lat: 51.5074,
  lng: -0.1278,
  relationshipScore: 85,
  lastContactedAt: "2026-06-01T12:00:00.000Z",
  nextFollowUpAt: daysAgo(3),
  tags: ["fintech", "advisor", "london", "angel", "climate"],
  lists: [
    { id: "l1", name: "Investors" },
    { id: "l2", name: "Board" },
    { id: "l3", name: "Mentors" },
  ],
};

const renderCard = (
  mode: "focus" | "hover",
  onAction = vi.fn(),
  person: MapContact = contact,
) =>
  render(
    <MapHoverCard
      contact={person}
      mode={mode}
      onAction={onAction}
      onPointerEnter={() => {}}
      onPointerLeave={() => {}}
    />,
  );

describe("MapHoverCard", () => {
  it("leads with what is due, and gives the keyboard a hint but no buttons", () => {
    renderCard("focus");
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("Partner at Northwind Partners");
    expect(card.textContent).toContain("Follow-up 3 days overdue");
    expect(card.textContent).toContain("+2");
    expect(card.textContent).toContain("+2 lists");
    expect(card.textContent).toContain("Space for actions · Enter to open");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("runs each of its five actions", () => {
    const onAction = vi.fn();
    renderCard("hover", onAction);
    const card = screen.getByRole("dialog", { name: "Rowan Vale" });
    for (const button of card.querySelectorAll("button"))
      fireEvent.click(button);
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      "open",
      "log",
      "followUp",
      "list",
      "adjust",
    ]);
    // No number, so no Call.
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
  });

  it("calls the primary phone, after Open", () => {
    renderCard("hover", vi.fn(), {
      ...contact,
      phones: [{ phone: "+1 (555) 010-2030" }, { phone: "555 0199" }],
    });
    const call = screen.getByRole("link", { name: "Call" });
    expect(call.getAttribute("href")).toBe("tel:+15550102030");
    expect(call.previousElementSibling?.getAttribute("aria-label")).toBe(
      "Open contact",
    );
  });
});
