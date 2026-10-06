// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  RowsUnderHeading,
  SettingRow,
} from "../../../../src/views/settings/SettingRow";

let mockChanged: string[] = [];

vi.mock("../../../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ changed: mockChanged }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const row = () =>
  render(
    <MemoryRouter>
      <SettingRow
        id="test-row"
        title="Test Setting"
        description="A description of the test setting"
        prefKey="theme"
      >
        <button type="button">Control</button>
      </SettingRow>
    </MemoryRouter>,
  );

describe("SettingRow", () => {
  it.each([
    [[], 0],
    [["theme"], 1],
  ])(
    "marks a value off its default with the dot alone (%j)",
    (changed, dots) => {
      mockChanged = changed;
      row();
      expect(
        screen.queryAllByRole("img", { name: "Changed from the default" }),
      ).toHaveLength(dots);
      // The page's one Reset to defaults resets it (ResetToDefaults).
      expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
    },
  );

  // Headings never skip a level: h1, then the rows, unless a section's h2
  // sits between them.
  it("titles a row h2 under the page and h3 under a section", () => {
    mockChanged = [];
    render(
      <MemoryRouter>
        <SettingRow id="top" title="Top" description="" />
        <RowsUnderHeading>
          <SettingRow id="inner" title="Inner" description="" />
        </RowsUnderHeading>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "Top" }).tagName).toBe("H2");
    expect(screen.getByRole("heading", { name: "Inner" }).tagName).toBe("H3");
  });

  it("flashes background and focuses element on matching hash", () => {
    vi.useFakeTimers();
    window.location.hash = "#flash-row";

    const { container } = render(
      <MemoryRouter initialEntries={["/settings/appearance#flash-row"]}>
        <SettingRow
          id="flash-row"
          title="Flash Row"
          description="Testing hash flash"
        >
          <span>Control</span>
        </SettingRow>
      </MemoryRouter>,
    );

    const flashRow = container.querySelector("#flash-row");
    expect(flashRow?.classList.contains("flash")).toBe(true);
    expect(document.activeElement).toBe(flashRow);

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(flashRow?.classList.contains("flash")).toBe(false);
    vi.useRealTimers();
    window.location.hash = "";
  });
});
