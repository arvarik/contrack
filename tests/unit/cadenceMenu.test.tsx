// @vitest-environment jsdom
// =============================================================================
// The cadence chip and its menu
// =============================================================================
// The cadence is the second half of Track: who, then how often. The chip
// reads the cadence in words and opens the five choices with the current one
// checked. A value off the list, set through the API, shows as a sixth
// checked item, so the menu never claims a cadence the contact does not
// have. Choosing writes `cadenceDays` and toasts the contact and the words.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../src/api/client", () => ({
  apiFetch: (...args: unknown[]) => api.fetch(...args),
}));

import { CadenceMenu } from "../../src/views/contact-detail/components/CadenceMenu";

const ADA = { id: "c1", name: "Ada Lovelace", cadenceDays: 90 };

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetch.mockImplementation(async (_url: string, init: RequestInit) => ({
    json: async () => ({ ...ADA, ...JSON.parse(init.body as string) }),
  }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CadenceMenu", () => {
  it("reads the cadence in words, and names itself as the cadence", () => {
    mount(<CadenceMenu contact={ADA} />);
    const chip = screen.getByRole("button", {
      name: "Cadence: every 3 months",
    });
    expect(chip.textContent).toBe("Every 3 months");
  });

  it("reads the short form when compact", () => {
    mount(<CadenceMenu contact={ADA} compact />);
    expect(
      screen.getByRole("button", { name: "Cadence: every 3 months" })
        .textContent,
    ).toBe("3 mo");
  });

  it("lists the five choices under Keep up with the current one checked", () => {
    mount(<CadenceMenu contact={ADA} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cadence: every 3 months" }),
    );
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Keep up")).toBeTruthy();
    const items = within(menu).getAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.textContent)).toEqual([
      "Every month",
      "Every 2 months",
      "Every 3 months",
      "Every 6 months",
      "Every year",
    ]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
      "false",
    ]);
  });

  it("shows a value off the list as a sixth checked item", () => {
    mount(<CadenceMenu contact={{ ...ADA, cadenceDays: 45 }} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cadence: every 45 days" }),
    );
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items).toHaveLength(6);
    expect(items[5].textContent).toBe("Every 45 days");
    expect(items[5].getAttribute("aria-checked")).toBe("true");
    expect(
      items
        .slice(0, 5)
        .every((item) => item.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });

  it("writes the choice and toasts the contact and the words", async () => {
    mount(<CadenceMenu contact={ADA} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cadence: every 3 months" }),
    );
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Every month" }),
    );

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(api.fetch).toHaveBeenCalledWith(
      "/contacts/c1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ cadenceDays: 30 }),
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("Ada Lovelace, every month");
  });

  it("does nothing when the current choice is chosen again", async () => {
    mount(<CadenceMenu contact={ADA} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Cadence: every 3 months" }),
    );
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Every 3 months" }),
    );
    await Promise.resolve();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
