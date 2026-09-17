// =============================================================================
// Integration: the map's data and the policy that lets the basemap load
// =============================================================================
// Two halves of one feature. The route decides which contacts have a pin, and
// the CSP decides whether the browser may fetch the basemap they sit on. Both
// run against the real Express pipeline here, because the CSP is built at
// request time from the same module the status payload reads.
// =============================================================================

import { describe, it, expect } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { buildProductionCsp } from "../../server/app.ts";
import {
  DEFAULT_MAP_STYLE_DARK,
  DEFAULT_MAP_STYLE_LIGHT,
} from "../../server/utils/mapConfig.ts";

const app = makeTestApp();
const OPENFREEMAP = "https://tiles.openfreemap.org";

interface MapRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  geoSource: "geocoder" | "manual" | null;
}

interface PinFields {
  lat: number | null;
  lng: number | null;
  geoSource: "geocoder" | "manual" | null;
}

/** A contact with coordinates, which is what puts it on the map. */
async function place(name: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/contacts")
    .send({ name, location: "London, UK", lat: 51.5, lng: -0.12, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const mapIds = async (): Promise<string[]> => {
  const res = await request(app).get("/api/contacts/map");
  expect(res.status).toBe(200);
  return (res.body as MapRow[]).map((row) => row.id);
};

describe("GET /api/contacts/map", () => {
  it("returns a placed contact with the fields a pin needs", async () => {
    const id = await place("Mapped Person", { company: "Babbage & Co" });
    const res = await request(app).get("/api/contacts/map");
    const row = (res.body as MapRow[]).find((r) => r.id === id);
    expect(row).toMatchObject({
      id,
      name: "Mapped Person",
      company: "Babbage & Co",
      location: "London, UK",
      lat: 51.5,
      lng: -0.12,
    });
  });

  it("excludes a contact in the trash", async () => {
    const id = await place("Trashed Person");
    expect(await mapIds()).toContain(id);

    const deleted = await request(app).delete(`/api/contacts/${id}`);
    expect(deleted.status).toBe(200);
    // Still a row, restorable from the trash, but not a pin on the map.
    expect(await mapIds()).not.toContain(id);
  });

  it("excludes a ghost, the placeholder a mention creates", async () => {
    const id = await place("Ghost Person", { isGhost: true });
    expect(await mapIds()).not.toContain(id);
  });

  it("excludes an archived contact", async () => {
    const id = await place("Archived Person");
    const patched = await request(app)
      .patch(`/api/contacts/${id}`)
      .send({ isArchived: true });
    expect(patched.status).toBe(200);
    expect(await mapIds()).not.toContain(id);
  });

  it("says who placed each pin", async () => {
    // Coordinates that arrived with the contact were placed by nobody the
    // map can name, so the row says so with null rather than guessing.
    const id = await place("Placed Person");
    const rowFor = async (contactId: string) => {
      const res = await request(app).get("/api/contacts/map");
      return (res.body as MapRow[]).find((r) => r.id === contactId);
    };
    expect((await rowFor(id))?.geoSource).toBeNull();

    const moved = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send({ lat: 48.8566, lng: 2.3522 });
    expect(moved.status).toBe(200);
    expect((await rowFor(id))?.geoSource).toBe("manual");
  });
});

describe("PATCH /api/contacts/:id/location", () => {
  const PARIS = { lat: 48.8566, lng: 2.3522 };

  const pinOf = async (id: string): Promise<PinFields> => {
    const res = await request(app).get(`/api/contacts/${id}`);
    expect(res.status).toBe(200);
    const { lat, lng, geoSource } = res.body as PinFields;
    return { lat, lng, geoSource };
  };

  it("puts the pin where a person dropped it", async () => {
    const id = await place("Dropped Person");

    const res = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send(PARIS);

    expect(res.status).toBe(200);
    // The answer is the whole contact, as every other contact write returns.
    expect(res.body).toMatchObject({
      id,
      name: "Dropped Person",
      ...PARIS,
      geoSource: "manual",
    });
    expect(await pinOf(id)).toEqual({ ...PARIS, geoSource: "manual" });
  });

  it("refuses a coordinate the map cannot draw", async () => {
    const id = await place("Careful Person");
    const before = await pinOf(id);

    for (const body of [
      { lat: 91, lng: 0 },
      { lat: -91, lng: 0 },
      { lat: 0, lng: 181 },
      { lat: 0, lng: -181 },
      { lat: "48.8", lng: "2.3" },
      { lat: 48.8 },
      {},
      // One thing or the other, never both.
      { ...PARIS, regeocode: true },
      { regeocode: false },
      { regeocode: "yes" },
    ]) {
      const res = await request(app)
        .patch(`/api/contacts/${id}/location`)
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await pinOf(id)).toEqual(before);
  });

  it("hands the pin back to the geocoder", async () => {
    const id = await place("Returned Person");
    const moved = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send(PARIS);
    expect(moved.status).toBe(200);

    const res = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send({ regeocode: true });

    // Background jobs are off in this suite, so nothing answers the geocoder.
    // The three fields are cleared, and the contact leaves the map until the
    // geocoder answers. `geocoding.manualPin.test.ts` follows the answer in.
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id,
      lat: null,
      lng: null,
      geoSource: null,
    });
    expect(await pinOf(id)).toEqual({ lat: null, lng: null, geoSource: null });
    expect(await mapIds()).not.toContain(id);
  });

  it("answers 404 for a contact in the trash, and for one that never was", async () => {
    const id = await place("Trashed Pin Person");
    const deleted = await request(app).delete(`/api/contacts/${id}`);
    expect(deleted.status).toBe(200);

    const trashed = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send(PARIS);
    const unknown = await request(app)
      .patch(`/api/contacts/${crypto.randomUUID()}/location`)
      .send(PARIS);
    expect(trashed.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});

describe("GET /api/auth/status", () => {
  it("names the basemap style for each palette", async () => {
    const res = await request(app).get("/api/auth/status");
    expect(res.status).toBe(200);
    expect(res.body.map).toEqual({
      light: DEFAULT_MAP_STYLE_LIGHT,
      dark: DEFAULT_MAP_STYLE_DARK,
    });
  });
});

describe("buildProductionCsp", () => {
  // The header the client is held to: the style URLs above load through
  // `fetch`, so their origin has to be in `connect-src`.
  const directives = (csp: string) =>
    Object.fromEntries(
      csp.split("; ").map((d) => {
        const [name, ...values] = d.split(" ");
        return [name, values];
      }),
    );

  it("allows MapLibre's worker, from this origin and from a blob", () => {
    const csp = directives(buildProductionCsp([OPENFREEMAP]));
    expect(csp["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(csp["child-src"]).toEqual(["blob:"]);
  });

  it("allows the style origin to be fetched, once", () => {
    const csp = directives(buildProductionCsp([OPENFREEMAP, OPENFREEMAP]));
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://api.open-meteo.com",
      OPENFREEMAP,
    ]);
  });

  it("adds nothing to connect-src for a self-hosted style", () => {
    const csp = directives(buildProductionCsp([]));
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "https://api.open-meteo.com",
    ]);
  });

  it("keeps the rest of the policy", () => {
    const csp = directives(buildProductionCsp());
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "https:"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    // The default style's origin is allowed with no argument at all.
    expect(csp["connect-src"]).toContain(OPENFREEMAP);
  });
});
