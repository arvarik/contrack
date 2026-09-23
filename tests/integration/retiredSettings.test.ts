/**
 * A setting the app no longer reads leaves the database on boot. The Mapbox
 * geocoder is gone, and a key an admin stored before stayed sealed in
 * `app_settings`, and in every backup, with no control to remove it.
 */
import { describe, expect, it } from "vitest";
import { deleteRetiredSettings, sqlite } from "../../server/db.ts";

const row = () =>
  sqlite
    .prepare(`SELECT value FROM app_settings WHERE key = 'geo.mapboxKey'`)
    .get();

describe("retired settings", () => {
  it("deletes the sealed Mapbox key, and does nothing once it is gone", () => {
    sqlite
      .prepare(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('geo.mapboxKey', 'sealed:v1:abc')`,
      )
      .run();
    expect(row()).toBeTruthy();

    expect(deleteRetiredSettings(sqlite)).toBe(1);
    expect(row()).toBeUndefined();
    expect(deleteRetiredSettings(sqlite)).toBe(0);
  });
});
