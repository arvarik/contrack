// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingRow } from "../../src/views/settings/SettingRow";

let mockChanged: string[] = [];

vi.mock("../../src/contexts/PreferencesContext", () => ({
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
  it("renders title, description and control without the dot at the default", () => {
    mockChanged = [];
    row();
    expect(screen.getByText("Test Setting")).toBeTruthy();
    expect(screen.getByText("A description of the test setting")).toBeTruthy();
    expect(screen.getByText("Control")).toBeTruthy();
    expect(
      screen.queryByRole("img", { name: "Changed from the default" }),
    ).toBeNull();
  });

  it("marks a changed value with the dot alone, and no Reset of its own", () => {
    mockChanged = ["theme"];
    row();
    const mark = screen.getByRole("img", { name: "Changed from the default" });
    expect(mark.getAttribute("title")).toBe("Changed from the default");
    // The page's one Reset to defaults resets it (ResetToDefaults).
    expect(screen.queryByRole("button", { name: /reset/i })).toBeNull();
  });

  it("puts a wide control under the text when the row is below", () => {
    mockChanged = [];
    const { container } = render(
      <MemoryRouter>
        <SettingRow id="wide" title="Wide" description="Tiles" below>
          <div data-testid="tiles" />
        </SettingRow>
      </MemoryRouter>,
    );
    const layout = container.querySelector("#wide > div")!;
    expect(layout.className).toContain("flex-col");
    expect(layout.className).not.toContain("sm:flex-row");
    expect(screen.getByTestId("tiles").parentElement!.className).toBe(
      "min-w-0",
    );
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

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(flashRow?.classList.contains("flash")).toBe(false);
    vi.useRealTimers();
    window.location.hash = "";
  });
});
