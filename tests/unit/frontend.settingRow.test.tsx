// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SettingRow } from "../../src/views/settings/SettingRow";

const mockResetPreference = vi.fn();
let mockStored: string[] = [];

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    stored: mockStored,
    resetPreference: mockResetPreference,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingRow", () => {
  it("renders title, description and control without changed dot when not stored", () => {
    mockStored = [];
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

    expect(screen.getByText("Test Setting")).toBeTruthy();
    expect(screen.getByText("A description of the test setting")).toBeTruthy();
    expect(screen.getByText("Control")).toBeTruthy();
    expect(screen.queryByText("Changed from the default")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
  });

  it("renders changed dot and Reset button only for stored keys, and Reset calls resetPreference", () => {
    mockStored = ["theme"];
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

    expect(screen.getByText("Changed from the default")).toBeTruthy();
    const resetButton = screen.getByRole("button", { name: "Reset" });
    expect(resetButton).toBeTruthy();

    fireEvent.click(resetButton);
    expect(mockResetPreference).toHaveBeenCalledWith("theme");
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

    const row = container.querySelector("#flash-row");
    expect(row?.classList.contains("flash")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(row?.classList.contains("flash")).toBe(false);
    vi.useRealTimers();
    window.location.hash = "";
  });
});
