// =============================================================================
// Module: map
// =============================================================================
// The map: place search and saved map views. Its job queues every contact
// with an address and no pin for the geocoder, once, at start.
// =============================================================================

import { defineModule } from "../module.ts";
import { geoRouter } from "../../routes/geo.ts";
import { mapViewsRouter } from "../../routes/mapViews.ts";
import { GEOCODING_JOBS } from "../../jobs/geocoding.ts";

export const mapModule = defineModule({
  id: "map",
  routers: [
    { path: "/api/geo", router: geoRouter },
    { path: "/api/map/views", router: mapViewsRouter },
  ],
  jobs: GEOCODING_JOBS,
});
