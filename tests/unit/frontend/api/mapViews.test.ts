// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import {
  fetchMapViews,
  createMapView,
  updateMapView,
  useDeleteMapView,
  type MapBounds,
  type MapView,
} from "../../../../src/api/mapViews";
import * as client from "../../../../src/api/client";

vi.mock("../../../../src/api/client", () => ({
  apiJson: vi.fn(),
  jsonBody: vi.fn((body) => ({ body: JSON.stringify(body) })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api/mapViews client functions", () => {
  it("fetches map views", async () => {
    vi.mocked(client.apiJson).mockResolvedValueOnce({ views: [{ id: "v1" }] });
    const res = await fetchMapViews();
    expect(res).toEqual([{ id: "v1" }]);
    expect(client.apiJson).toHaveBeenCalledWith(
      "/map/views",
      expect.any(Object),
    );
  });

  it.each<[string, MapBounds]>([
    ["a box around London", [-0.5, 51.3, 0.2, 51.7]],
    ["the whole world, its edges included", [-180, -90, 180, 90]],
    ["a box whose east edge is 0", [-0.2, 51.4, 0.0, 51.6]],
    ["a box whose west and south edges are 0", [0, 0, 10, 10]],
  ])("creates a map view over %s", async (_label, bounds) => {
    vi.mocked(client.apiJson).mockResolvedValueOnce({
      id: "v1",
      name: "London",
    });
    const res = await createMapView({ name: "London", bounds });
    expect(res).toEqual({ id: "v1", name: "London" });
    expect(client.apiJson).toHaveBeenCalledWith("/map/views", {
      method: "POST",
      body: JSON.stringify({ name: "London", bounds }),
    });
  });

  it.each<[string, unknown, RegExp]>([
    ["no bounds", null, /array of 4 coordinates/],
    ["three coordinates", [1, 2, 3], /array of 4 coordinates/],
    ["a coordinate as text", ["-180", -90, 180, 90], /finite numbers/],
    ["a west past -180", [-185, 0, 10, 10], /West longitude/],
    ["an east past 180", [0, 0, 185, 10], /East longitude/],
    ["a south past -90", [0, -95, 10, 10], /South latitude/],
    ["a north past 90", [0, 0, 10, 95], /North latitude/],
    [
      "the south above the north",
      [0, 50, 10, 40],
      /South latitude must be less than north latitude/,
    ],
    [
      "the west east of the east",
      [170, -20, -170, 20],
      /West longitude must be less than east longitude/,
    ],
  ])(
    "refuses to create a map view with %s, and sends nothing",
    async (_label, bounds, message) => {
      await expect(
        createMapView({ name: "London", bounds: bounds as MapBounds }),
      ).rejects.toThrow(message);
      expect(client.apiJson).not.toHaveBeenCalled();
    },
  );

  it("updates map view with bounds validation", async () => {
    vi.mocked(client.apiJson).mockResolvedValueOnce({
      id: "v1",
      name: "Renamed",
    });
    const res = await updateMapView("v1", {
      name: "Renamed",
      bounds: [-10, 50, 10, 60],
    });
    expect(res).toEqual({ id: "v1", name: "Renamed" });
    expect(client.apiJson).toHaveBeenCalledWith("/map/views/v1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed", bounds: [-10, 50, 10, 60] }),
    });

    vi.mocked(client.apiJson).mockClear();
    await expect(
      updateMapView("v1", { bounds: [0, 50, 10, 40] }),
    ).rejects.toThrow(/South latitude must be less than north latitude/);
    expect(client.apiJson).not.toHaveBeenCalled();
  });

  it("deletes a view, and the toast's Undo saves it again as it was", async () => {
    const view: MapView = {
      id: "v1",
      name: "London",
      query: "tag:vip",
      layer: "heat",
      bounds: [-0.5, 51.3, 0.2, 51.7],
      sortOrder: 3,
      createdAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    vi.mocked(client.apiJson).mockResolvedValue({ success: true });
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useDeleteMapView(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    });

    await act(() => result.current.mutateAsync(view));
    expect(client.apiJson).toHaveBeenCalledWith("/map/views/v1", {
      method: "DELETE",
    });

    const [message, options] = vi.mocked(toast.success).mock.calls[0];
    expect(message).toBe('View "London" deleted');
    const undo = options?.action as { label: string; onClick: () => void };
    expect(undo.label).toBe("Undo");
    undo.onClick();
    expect(client.apiJson).toHaveBeenLastCalledWith("/map/views", {
      method: "POST",
      body: JSON.stringify({
        name: "London",
        query: "tag:vip",
        layer: "heat",
        bounds: [-0.5, 51.3, 0.2, 51.7],
      }),
    });
  });
});
