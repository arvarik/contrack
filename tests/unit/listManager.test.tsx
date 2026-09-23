// @vitest-environment jsdom
/**
 * The Lists page's count row and its drop target.
 *
 * The count row was left out while the lists loaded, so on a cold load the
 * rows arrived 68 px lower than the skeleton. It shows while they load, with
 * no count. A row a drag hovers wore a solid primary outline, which is what
 * the focus ring looks like: it is dashed now.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ContactList } from "../../src/types";

const state = vi.hoisted(() => ({
  lists: undefined as ContactList[] | undefined,
  isLoading: true,
}));

vi.mock("../../src/api", () => ({
  useLists: () => ({ data: state.lists, isLoading: state.isLoading }),
  useReorderLists: () => ({ mutate: vi.fn() }),
  useCreateList: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { ListManagerView } =
  await import("../../src/views/lists/ListManagerView");

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
    expect(screen.getAllByText("2 lists · drag to reorder")).toHaveLength(2);

    const [investors] = screen.getAllByText("Investors");
    const [dinner] = screen.getAllByText("Dinner");
    const rowOf = (el: HTMLElement) => el.closest('[role="button"]')!;
    fireEvent.dragStart(rowOf(investors), {
      dataTransfer: { effectAllowed: "" },
    });
    fireEvent.dragOver(rowOf(dinner));
    expect(rowOf(dinner).className).toContain("outline-dashed");
    expect(rowOf(dinner).className).not.toMatch(/\bring-/);
  });
});
