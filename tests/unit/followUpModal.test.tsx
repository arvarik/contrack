// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  FollowUpModal,
  getPresetDate,
} from "../../src/views/map/FollowUpModal";
import * as client from "../../src/api/client";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
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

  it("calculates preset dates accurately", () => {
    const fixedNow = new Date("2026-06-10T12:00:00.000Z");
    expect(getPresetDate("tomorrow", fixedNow)).toBe("2026-06-11");
    expect(getPresetDate("3days", fixedNow)).toBe("2026-06-13");
    expect(getPresetDate("nextweek", fixedNow)).toBe("2026-06-17");
  });

  it("creates one POST per id for selected contacts", async () => {
    const apiFetchSpy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "item-1" }),
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

    const titleInput = screen.getByLabelText(/task title/i);
    fireEvent.change(titleInput, { target: { value: "Review proposal" } });

    const submitBtn = screen.getByRole("button", {
      name: /add to 2 contacts/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetchSpy).toHaveBeenCalledTimes(2);
    });

    expect(apiFetchSpy).toHaveBeenCalledWith(
      "/contacts/c1/action-items",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Review proposal"),
      }),
    );
    expect(apiFetchSpy).toHaveBeenCalledWith(
      "/contacts/c2/action-items",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Review proposal"),
      }),
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["actionItems"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["contacts"] });

    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("caps execution at 100 contacts and informs via toast", async () => {
    const apiFetchSpy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      ok: true,
      json: async () => ({ id: "item-1" }),
    } as Response);

    // 120 contact IDs
    const ids = Array.from({ length: 120 }, (_, i) => `c-${i}`);

    renderComponent({
      isOpen: true,
      contactIds: ids,
    });

    const titleInput = screen.getByLabelText(/task title/i);
    fireEvent.change(titleInput, { target: { value: "Mass announcement" } });

    const submitBtn = screen.getByRole("button", {
      name: /add to 100 contacts/i,
    });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiFetchSpy).toHaveBeenCalledTimes(100);
    });

    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("capped at 100 contacts"),
    );
  });
});
