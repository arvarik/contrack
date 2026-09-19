// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  StartRedirect,
  START_PAGE_SESSION_KEY,
} from "../../src/components/layout/StartRedirect";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let mockPreferences = {
  startPage: "network",
};
let mockIsLoaded = true;

vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    preferences: mockPreferences,
    isLoaded: mockIsLoaded,
  }),
}));

vi.mock("../../src/components/layout/StartPanel", () => ({
  StartPanel: () => <div data-testid="start-panel" />,
}));

describe("StartRedirect", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockNavigate.mockReset();
    mockPreferences = { startPage: "network" };
    mockIsLoaded = true;
  });

  it("does not redirect when startPage is network and sets contrack.started", () => {
    mockPreferences.startPage = "network";
    render(
      <MemoryRouter>
        <StartRedirect />
      </MemoryRouter>,
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(START_PAGE_SESSION_KEY)).toBe("true");
  });

  it("redirects to /pulse when startPage is pulse on first session visit", () => {
    mockPreferences.startPage = "pulse";
    render(
      <MemoryRouter>
        <StartRedirect />
      </MemoryRouter>,
    );

    expect(mockNavigate).toHaveBeenCalledWith("/pulse", { replace: true });
    expect(sessionStorage.getItem(START_PAGE_SESSION_KEY)).toBe("true");
  });

  it("does not redirect if session is already marked started", () => {
    sessionStorage.setItem(START_PAGE_SESSION_KEY, "true");
    mockPreferences.startPage = "pulse";
    render(
      <MemoryRouter>
        <StartRedirect />
      </MemoryRouter>,
    );

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("waits until preferences are loaded before deciding to redirect", () => {
    mockIsLoaded = false;
    mockPreferences.startPage = "pulse";
    render(
      <MemoryRouter>
        <StartRedirect />
      </MemoryRouter>,
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(START_PAGE_SESSION_KEY)).toBeNull();
  });
});
