// =============================================================================
// Jobs: geocoding
// =============================================================================
// Once, two seconds after boot: every contact with an address and no pin goes
// into the geocoder's queue, which the shared cache deduplicates.
// =============================================================================

import { defineJob } from "./runner.ts";
import { queueRetroactiveGeocoding } from "../services/geocoding/index.ts";

export const GEOCODING_JOBS = [
  defineJob({
    kind: "geocode.startup",
    atStart: 2_000,
    run() {
      queueRetroactiveGeocoding();
    },
  }),
];
