// @vitest-environment jsdom
// ListDetailPanel: the icon saves when it is chosen. The panel shows the
// choice at once. A save that fails puts back the last icon the server
// accepted and says so, so the panel never shows an icon the list does not have.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ContactList } from "../../../../src/types";

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock("../../../../src/api", () => ({
  useUpdateList: () => ({ mutateAsync: api.update }),
  useDeleteList: () => ({ mutateAsync: vi.fn() }),
  useRemoveFromList: () => ({ mutateAsync: vi.fn() }),
  useAddToList: () => ({ mutateAsync: vi.fn() }),
  useListContacts: () => ({ data: [], isLoading: false }),
}));
vi.mock("../../../../src/views/lists/AddPeople", () => ({
  AddPeople: () => null,
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ListDetailPanel } from "../../../../src/views/lists/ListDetailPanel";

const list = { id: "l-1", name: "Pioneers", icon: "star" } as ContactList;

const mount = () =>
  render(
    <ListDetailPanel
      list={list}
      onClose={vi.fn()}
      onDeleted={vi.fn()}
      onViewInNetwork={vi.fn()}
    />,
  );
const pick = (icon: string) =>
  fireEvent.click(screen.getByRole("button", { name: icon }));
const chosen = (icon: string) =>
  screen.getByRole("button", { name: icon }).getAttribute("aria-pressed");

afterEach(() => {
  cleanup();
  api.update.mockReset();
  toast.error.mockReset();
});

describe("ListDetailPanel icon", () => {
  it("keeps the chosen icon when the save works", async () => {
    api.update.mockResolvedValue({});
    mount();

    pick("heart");

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith({
        id: "l-1",
        data: { icon: "heart" },
      }),
    );
    expect(chosen("heart")).toBe("true");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("puts the saved icon back, and says so, when the save fails", async () => {
    api.update.mockRejectedValue(new Error("offline"));
    mount();

    pick("heart");
    expect(chosen("heart")).toBe("true");

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not save the list"),
    );
    expect(chosen("star")).toBe("true");
    expect(chosen("heart")).toBe("false");
  });

  it("goes back to the last icon the server accepted", async () => {
    api.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("x"));
    mount();

    pick("heart");
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    pick("crown");

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(chosen("heart")).toBe("true");
    expect(chosen("crown")).toBe("false");
  });
});
