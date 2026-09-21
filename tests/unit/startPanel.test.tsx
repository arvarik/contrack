// @vitest-environment jsdom
// =============================================================================
// StartPanel: the pane beside the list when no contact is open
// =============================================================================
// It shows the mark and the words "No contact selected", and nothing else.
// The cards it once carried (Up next, Recently viewed, Add people) are gone,
// and so is the line that told a reader to pick somebody, so this checks
// that none of it is back: no regions, no buttons, no links, no second line.
// =============================================================================
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { StartPanel } from "../../src/components/layout/StartPanel";

afterEach(() => {
  cleanup();
});

describe("StartPanel", () => {
  it("shows the mark and says that no contact is selected", () => {
    const { container } = render(<StartPanel />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No contact selected" }),
    ).toBeTruthy();
    const mark = container.querySelector("svg");
    expect(mark).not.toBeNull();
    // Decorative: the heading beside it says what the pane is.
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("width")).toBe("144");
  });

  it("holds nothing to act on", () => {
    render(<StartPanel />);
    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText(/Up next/i)).toBeNull();
    expect(screen.queryByText(/Recently viewed/i)).toBeNull();
    expect(screen.queryByText(/Add people/i)).toBeNull();
  });

  it("says it once: the mark and the heading, and no other words", () => {
    const { container } = render(<StartPanel />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(container.textContent?.trim()).toBe("No contact selected");
  });
});
