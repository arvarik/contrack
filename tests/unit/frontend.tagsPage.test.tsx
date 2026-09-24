// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TagsPage } from "../../src/views/settings/pages/TagsPage";
import * as tagsApi from "../../src/api/tags";

vi.mock("../../src/api/tags", () => ({
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

  it("shows empty state when no tags exist", () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    expect(
      screen.getByRole("heading", { level: 2, name: "No tags yet" }),
    ).toBeTruthy();
    // A simple place says it in the title, with no sentence under it.
    expect(screen.queryByText(/Tags you add/i)).toBeNull();
  });

  it("renders tag list with counts alphabetically", () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [
        { tag: "work", count: 12 },
        { tag: "family", count: 4 },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    expect(screen.getByText("family")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("work")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("links each tag to the Network list filtered to it", () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [
        { tag: "close friend", count: 1 },
        { tag: "work", count: 12 },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    expect(
      screen
        .getByRole("link", { name: "work, 12 contacts" })
        .getAttribute("href"),
    ).toBe("/?tag=work");
    // A tag with a space keeps it: the filter matches the whole tag.
    expect(
      screen
        .getByRole("link", { name: "close friend, 1 contact" })
        .getAttribute("href"),
    ).toBe("/?tag=close%20friend");
  });

  it("allows inline rename of a tag", async () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [{ tag: "friends", count: 5 }],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    const renameBtn = screen.getByRole("button", { name: "Rename friends" });
    fireEvent.click(renameBtn);

    const input = screen.getByRole("textbox", { name: "Rename tag friends" });
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: "close-friends" } });

    const saveBtn = screen.getByRole("button", { name: "Save tag name" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith({
        from: "friends",
        to: "close-friends",
      });
    });
  });

  it("opens merge modal and submits merge", async () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [
        { tag: "colleagues", count: 3 },
        { tag: "work", count: 10 },
      ],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    const mergeBtn = screen.getByRole("button", {
      name: "Merge colleagues into another tag",
    });
    fireEvent.click(mergeBtn);

    expect(screen.getByText('Merge "colleagues" into…')).toBeTruthy();
    const targetInput = screen.getByLabelText("Target tag");
    fireEvent.change(targetInput, { target: { value: "work" } });

    const submitBtn = screen.getByRole("button", { name: "Merge tags" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockRename).toHaveBeenCalledWith({
        from: "colleagues",
        to: "work",
      });
    });
  });

  it("opens delete confirm dialog and deletes tag", async () => {
    vi.mocked(tagsApi.useTagSummary).mockReturnValue({
      data: [{ tag: "old-tag", count: 2 }],
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof tagsApi.useTagSummary>);

    renderComponent();
    const deleteBtn = screen.getByRole("button", {
      name: "Delete tag old-tag",
    });
    fireEvent.click(deleteBtn);

    expect(screen.getByText('Delete tag "old-tag"?')).toBeTruthy();
    const confirmBtn = screen.getByRole("button", { name: "Delete tag" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("old-tag");
    });
  });
});
