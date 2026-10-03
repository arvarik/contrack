// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  FollowUpModal,
  getPresetDate,
} from "../../../../src/views/map/FollowUpModal";
import * as client from "../../../../src/api/client";
import { toast } from "sonner";
import { MAX_BULK_ACTION_ITEMS } from "../../../../shared/actionItems";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("FollowUpModal", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  const renderComponent = (props: {
    isOpen: boolean;
    contactIds: string[];
    onClose?: () => void;
    onSuccess?: () => void;
  }) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <FollowUpModal
          isOpen={props.isOpen}
          onClose={props.onClose || vi.fn()}
          contactIds={props.contactIds}
          onSuccess={props.onSuccess}
        />
      </QueryClientProvider>,
    );
  };

  it("adds the follow-up to every selected contact in one request", async () => {
    const apiFetchSpy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      ok: true,
      json: async () => ({ count: 2 }),
    } as Response);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    renderComponent({
      isOpen: true,
      contactIds: ["c1", "c2"],
      onClose,
      onSuccess,
    });

    fireEvent.change(screen.getByLabelText(/task title/i), {
      target: { value: "Review proposal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to 2 contacts" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    // All or none: one retry cannot add a second follow-up to anyone.
    expect(apiFetchSpy).toHaveBeenCalledTimes(1);
    expect(apiFetchSpy).toHaveBeenCalledWith(
      "/action-items/bulk",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          contactIds: ["c1", "c2"],
          title: "Review proposal",
          dueAt: getPresetDate("tomorrow"),
        }),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Added follow-up for 2 contacts",
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["actionItems"] });
    expect(onClose).toHaveBeenCalled();
  });

  it("says so, and sends nothing, past the most one request may name", () => {
    const apiFetchSpy = vi.spyOn(client, "apiFetch");
    const count = MAX_BULK_ACTION_ITEMS + 1;
    renderComponent({
      isOpen: true,
      contactIds: Array.from({ length: count }, (_, i) => `c-${i}`),
    });

    fireEvent.change(screen.getByLabelText(/task title/i), {
      target: { value: "Mass announcement" },
    });
    const submit = screen.getByRole("button", {
      name: `Add to ${count} contacts`,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(
      screen.getByText(`can go to ${MAX_BULK_ACTION_ITEMS} people`, {
        exact: false,
      }).textContent,
    ).toContain("Select fewer people");
    fireEvent.submit(submit.closest("form")!);
    expect(apiFetchSpy).not.toHaveBeenCalled();
  });
});
