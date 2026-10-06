// Geocoding jobs. Once, two seconds after boot, every contact with an address
// and no pin goes into the geocoder's queue, which the shared cache dedupes.
// Daily, cached lookups no contact uses are deleted.

import { defineJob } from "./runner.ts";
import {
  pruneGeocodeCache,
  queueRetroactiveGeocoding,
} from "../services/geocoding/index.ts";

const DAY = 24 * 60 * 60 * 1000;

export const GEOCODING_JOBS = [
  defineJob({
    kind: "geocode.startup",
    atStart: 2_000,
    run() {
      queueRetroactiveGeocoding();
    },
  }),
  defineJob({
    kind: "geocode.cachePrune",
    every: DAY,
    atStart: 60_000,
    run() {
      pruneGeocodeCache();
    },
  }),
];
