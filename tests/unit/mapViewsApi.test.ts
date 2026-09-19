import { describe, it, expect, vi } from "vitest";
import {
  fetchMapViews,
  createMapView,
  updateMapView,
  deleteMapView,
} from "../../src/api/mapViews";
import * as client from "../../src/api/client";

vi.mock("../../src/api/client", () => ({
  apiJson: vi.fn(),
  jsonBody: vi.fn((body) => ({ body: JSON.stringify(body) })),
}));

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

  it("creates map view with bounds validation", async () => {
    vi.mocked(client.apiJson).mockResolvedValueOnce({
      id: "v1",
      name: "London",
    });
    const res = await createMapView({
      name: "London",
      bounds: [-0.5, 51.3, 0.2, 51.7],
    });
    expect(res).toEqual({ id: "v1", name: "London" });
  });

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
