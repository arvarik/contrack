// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagsPage } from "../../../../src/views/settings/pages/TagsPage";
import * as tagsApi from "../../../../src/api/tags";

vi.mock("../../../../src/api/tags", () => ({
  useTagSummary: vi.fn(),
  useRenameTag: vi.fn(),
  useDeleteTag: vi.fn(),
}));

describe("TagsPage", () => {
  let queryClient: QueryClient;
  const mockRename = vi.fn();
  const mockDelete = vi.fn();

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    mockRename.mockResolvedValue({ affected: 2 });
    mockDelete.mockResolvedValue({ affected: 2 });
    vi.mocked(tagsApi.useRenameTag).mockReturnValue({
      mutateAsync: mockRename,
      isPending: false,
    } as unknown as ReturnType<typeof tagsApi.useRenameTag>);
    vi.mocked(tagsApi.useDeleteTag).mockReturnValue({
      mutateAsync: mockDelete,
      isPending: false,
    } as unknown as ReturnType<typeof tagsApi.useDeleteTag>);
  });

  const renderComponent = () =>
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TagsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

  const withTags = (data: { tag: string; count: number; total?: number }[]) =>
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: data.map((t) => ({ total: t.count, ...t })),
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

  it("renders tag list with counts alphabetically", () => {
    withTags([
      { tag: "work", count: 12 },
      { tag: "family", count: 4 },
    ]);

    renderComponent();
    // The server sent work first.
    expect(
      screen
        .getAllByRole("link", { name: /contacts?$/ })
        .map((link) => link.getAttribute("aria-label")),
    ).toEqual(["family, 4 contacts", "work, 12 contacts"]);
  });

  it("renames a tag, and asks first when the new name joins another tag", async () => {
    withTags([
      { tag: "friends", count: 5 },
      { tag: "work", count: 10, total: 12 },
    ]);
    renderComponent();
    const rename = (to: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Rename friends" }));
      fireEvent.change(
        screen.getByRole("textbox", { name: "Rename tag friends" }),
        { target: { value: to } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save tag name" }));
    };

    rename("close-friends");
    await waitFor(() =>
      expect(mockRename).toHaveBeenCalledWith({
        from: "friends",
        to: "close-friends",
      }),
    );

    // "Work" is the tag "work": the rename is a merge, so it asks first.
    mockRename.mockClear();
    rename("Work");
    expect(screen.getByText('Merge "friends" into…')).toBeTruthy();
    expect(mockRename).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Merge tags" }));
    await waitFor(() =>
      expect(mockRename).toHaveBeenCalledWith({ from: "friends", to: "work" }),
    );
  });

  it("says that a delete reaches archived contacts too, and deletes", async () => {
    withTags([{ tag: "old-tag", count: 2, total: 3 }]);

    renderComponent();
    fireEvent.click(screen.getByRole("button", { name: "Delete tag old-tag" }));
    expect(
      screen.getByText(/3 contacts, 1 of them archived or in the Trash/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("old-tag"));
  });
});
