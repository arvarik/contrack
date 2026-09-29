import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  fetchMapViews,
  createMapView,
  updateMapView,
  deleteMapView,
  type MapBounds,
} from "../../../../src/api/mapViews";
import * as client from "../../../../src/api/client";

vi.mock("../../../../src/api/client", () => ({
  apiJson: vi.fn(),
  jsonBody: vi.fn((body) => ({ body: JSON.stringify(body) })),
}));

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

  it("deletes map view", async () => {
    vi.mocked(client.apiJson).mockResolvedValueOnce({ success: true });
    const res = await deleteMapView("v1");
    expect(res).toEqual({ success: true });
    expect(client.apiJson).toHaveBeenCalledWith(
      "/map/views/v1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
