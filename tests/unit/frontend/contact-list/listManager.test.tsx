// @vitest-environment jsdom
/**
 * The Lists page's count row and its drop target. The journeys (open a list,
 * add people, remove with Undo, Move up) are in `tests/e2e/lists.spec.ts`.
 *
 * The count row shows while the lists load, with no count, so the rows do
 * not land lower than the skeleton. A row a drag hovers wears a dashed
 * outline, so it does not look like the focus ring.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ContactList } from "../../../../src/types";

const state = vi.hoisted(() => ({
  lists: undefined as ContactList[] | undefined,
  isLoading: true,
}));

vi.mock("../../../../src/api", () => ({
  useLists: () => ({ data: state.lists, isLoading: state.isLoading }),
  useReorderLists: () => ({ mutate: vi.fn() }),
  useCreateList: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { ListManagerView } =
  await import("../../../../src/views/lists/ListManagerView");

afterEach(cleanup);

const list = (id: string, name: string): ContactList =>
  ({ id, name, icon: "list", memberCount: 2 }) as ContactList;

const mount = () =>
  render(
    <MemoryRouter>
      <ListManagerView />
    </MemoryRouter>,
  );

describe("the Lists page", () => {
  it("holds the count row's place while the lists load, with no count", () => {
    state.lists = undefined;
    state.isLoading = true;
    mount();
    // Two layouts, one per width, each with its own row.
    expect(screen.getAllByRole("button", { name: /New list/ })).toHaveLength(2);
    expect(screen.queryByText(/^\d+ lists?/)).toBeNull();
  });

  it("counts the lists once they arrive, and dashes the row a drag hovers", () => {
    state.lists = [list("a", "Investors"), list("b", "Dinner")];
    state.isLoading = false;
    mount();
    expect(screen.getAllByText(/^2 lists/)).toHaveLength(2);

    const rowOf = (name: string) => screen.getAllByText(name)[0].closest("li")!;
    fireEvent.dragStart(rowOf("Investors"), {
      dataTransfer: { effectAllowed: "" },
    });
    fireEvent.dragOver(rowOf("Dinner"));
    expect(rowOf("Dinner").className).toContain("outline-dashed");
    expect(rowOf("Dinner").className).not.toMatch(/\bring-/);
  });
});
