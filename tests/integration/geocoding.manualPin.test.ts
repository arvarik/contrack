// =============================================================================
// Integration: a pin placed by hand, and what the geocoder does about it
// =============================================================================
// The rule under test has two halves. The geocoder never overwrites a row a
// person placed, however it comes to have an answer for that row. And an edit
// to that contact does not ask the geocoder again unless it changed the text
// the pin was read from, in which case the pin is the geocoder's once more.
//
// `queueGeocode` is recorded here rather than run, so a trigger is proved by
// the call it makes or does not make, with no provider and no network. The
// one test that needs the real write runs it against the geocode cache, which
// answers before any provider is asked.
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import {
  cacheGeocode,
  normalizeLocationKey,
} from "../../server/services/geocoding/cache.ts";

const queued = vi.fn<(contactId: string, location: string) => void>();
vi.mock("../../server/services/geocoding/index.ts", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../server/services/geocoding/index.ts")
    >();
  return {
    ...actual,
    queueGeocode: (contactId: string, location: string) =>
      queued(contactId, location),
  };
});

const { contactService } =
  await import("../../server/services/contactService.ts");
const { queueGeocode: realQueueGeocode } =
  await import("../../server/services/geocoding/queue.ts");
const { contactsAwaitingGeocode } =
  await import("../../server/services/geocoding/index.ts");

const app = makeTestApp();

const LONDON = { lat: 51.5074, lng: -0.1278 };
const PARIS = { lat: 48.8566, lng: 2.3522 };
const ROME = { lat: 41.9028, lng: 12.4964 };

interface PinRow {
  lat: number | null;
  lng: number | null;
  geoSource: string | null;
  ownerId: string;
}

const pinRow = (id: string): PinRow =>
  sqlite
    .prepare(`SELECT lat, lng, geoSource, ownerId FROM contacts WHERE id = ?`)
    .get(id) as PinRow;

/** A contact with an address, placed by nobody yet. */
async function person(name: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/contacts")
    .send({ name, location: "London, UK", ...extra });
  expect(res.status).toBe(201);
  queued.mockClear();
  return res.body.id as string;
}

/** The same contact, with the pin placed by hand. */
async function placedByHand(name: string) {
  const id = await person(name, LONDON);
  const res = await request(app)
    .patch(`/api/contacts/${id}/location`)
    .send(PARIS);
  expect(res.status).toBe(200);
  expect(pinRow(id)).toMatchObject({ ...PARIS, geoSource: "manual" });
  queued.mockClear();
  return id;
}

/**
 * Run the real geocoder for one call. Background jobs are off for the whole
 * suite, and the flag is read at the call, so it is lifted for exactly this
 * long. A cached answer is written on the spot and nothing is scheduled.
 */
function withGeocoder<T>(fn: () => T): T {
  process.env.DISABLE_BACKGROUND_JOBS = "false";
  try {
    return fn();
  } finally {
    process.env.DISABLE_BACKGROUND_JOBS = "true";
  }
}

describe("the geocoder and a pin placed by hand", () => {
  it("places a row nobody placed, and says it did", async () => {
    cacheGeocode(
      normalizeLocationKey("Rome, Italy"),
      ROME.lat,
      ROME.lng,
      "test",
      true,
    );
    const id = await person("Geocoded Person");

    withGeocoder(() => realQueueGeocode(id, "Rome, Italy"));

    expect(pinRow(id)).toMatchObject({ ...ROME, geoSource: "geocoder" });
  });

  it("never overwrites a pin a person placed", async () => {
    cacheGeocode(
      normalizeLocationKey("Rome, Italy"),
      ROME.lat,
      ROME.lng,
      "test",
      true,
    );
    const id = await placedByHand("Hand Placed Person");

    // The same cached answer that moved the row above lands on nothing here.
    withGeocoder(() => realQueueGeocode(id, "Rome, Italy"));

    expect(pinRow(id)).toMatchObject({ ...PARIS, geoSource: "manual" });
  });

  it("leaves a hand-placed row out of the startup sweep by name", async () => {
    const waiting = await person("Waiting Person");
    const placed = await person("Sweep Proof Person");
    // A hand-placed row always has coordinates, so the sweep's coordinate
    // test alone would skip it. The rule is stated in the query as well, and
    // this row, which could only exist by hand, is how that is proved.
    sqlite
      .prepare(
        `UPDATE contacts SET lat = NULL, lng = NULL, geoSource = 'manual' WHERE id = ?`,
      )
      .run(placed);

    const ids = contactsAwaitingGeocode().map((c) => c.id);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(placed);
  });
});

describe("an edit to a contact whose pin was placed by hand", () => {
  it("asks the geocoder for nothing when the address did not change", async () => {
    const id = await placedByHand("Steady Person");
    const scope = scopeForOwnerId(pinRow(id).ownerId);

    // The same location, sent again, and a field that is not an address.
    contactService.patchContact(scope, id, { location: "London, UK" });
    contactService.updateContact(scope, id, { company: "Babbage & Co" });
    contactService.updateContact(scope, id, {
      addresses: [{ address: "London, UK", label: "home", isPrimary: true }],
    });
    contactService.updateContact(scope, id, {
      addresses: [{ address: "London, UK", label: "home", isPrimary: true }],
    });

    expect(queued).not.toHaveBeenCalled();
    expect(pinRow(id)).toMatchObject({ ...PARIS, geoSource: "manual" });
  });

  it("hands the pin back when the location changes", async () => {
    const id = await placedByHand("Moving Person");
    const scope = scopeForOwnerId(pinRow(id).ownerId);

    contactService.patchContact(scope, id, { location: "Rome, Italy" });

    expect(queued).toHaveBeenCalledWith(id, "Rome, Italy");
    // The old coordinates stand until the geocoder answers. Only the claim
    // that a person placed them is gone.
    expect(pinRow(id)).toMatchObject({ ...PARIS, geoSource: null });
  });

  it("hands the pin back when the primary address text changes", async () => {
    const id = await placedByHand("Moving House Person");
    const scope = scopeForOwnerId(pinRow(id).ownerId);
    contactService.updateContact(scope, id, {
      location: null,
      addresses: [{ address: "London, UK", label: "home", isPrimary: true }],
    });
    // Clearing the legacy field and restating the same address is one edit
    // that moved nothing.
    queued.mockClear();
    contactService.updateContact(scope, id, {
      addresses: [{ address: "London, UK", label: "home", isPrimary: true }],
    });
    expect(queued).not.toHaveBeenCalled();

    contactService.updateContact(scope, id, {
      addresses: [
        { address: "Rome, Italy", label: "home", isPrimary: true },
        { address: "London, UK", label: "work", isPrimary: false },
      ],
    });

    expect(queued).toHaveBeenCalledWith(id, "Rome, Italy");
    expect(pinRow(id).geoSource).toBeNull();
  });

  it("keeps asking for a row the geocoder placed, as it always did", async () => {
    const id = await person("Ordinary Person");
    const scope = scopeForOwnerId(pinRow(id).ownerId);

    contactService.patchContact(scope, id, { location: "London, UK" });

    expect(queued).toHaveBeenCalledWith(id, "London, UK");
  });

  it("moves the pin again once the geocoder is asked for the new text", async () => {
    cacheGeocode(
      normalizeLocationKey("Rome, Italy"),
      ROME.lat,
      ROME.lng,
      "test",
      true,
    );
    const id = await placedByHand("Moved Twice Person");
    const scope = scopeForOwnerId(pinRow(id).ownerId);

    contactService.patchContact(scope, id, { location: "Rome, Italy" });
    expect(queued).toHaveBeenCalledWith(id, "Rome, Italy");
    // What the recorded call would have done, run for real: the row is the
    // geocoder's again, so the cached answer lands.
    withGeocoder(() => realQueueGeocode(id, "Rome, Italy"));

    expect(pinRow(id)).toMatchObject({ ...ROME, geoSource: "geocoder" });
  });
});

describe("handing the pin back on request", () => {
  it("clears the pin and asks the geocoder to read the address again", async () => {
    const id = await placedByHand("Second Thoughts Person");

    const res = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send({ regeocode: true });

    expect(res.status).toBe(200);
    expect(pinRow(id)).toMatchObject({ lat: null, lng: null, geoSource: null });
    expect(queued).toHaveBeenCalledWith(id, "London, UK");
  });

  it("reads the primary address when there is no location field", async () => {
    const id = await person("Address Only Person", {
      location: null,
      addresses: [
        { address: "Rome, Italy", label: "work", isPrimary: false },
        { address: "Paris, France", label: "home", isPrimary: true },
      ],
    });
    const placed = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send(LONDON);
    expect(placed.status).toBe(200);
    queued.mockClear();

    const res = await request(app)
      .patch(`/api/contacts/${id}/location`)
      .send({ regeocode: true });

    expect(res.status).toBe(200);
    expect(queued).toHaveBeenCalledWith(id, "Paris, France");
  });
});
