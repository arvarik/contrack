// =============================================================================
// Module: logos
// =============================================================================
// Company logos, cached on the server.
// =============================================================================

import { defineModule } from "../module.ts";
import { logosRouter } from "../../routes/logos.ts";

export const logosModule = defineModule({
  id: "logos",
  routers: [{ path: "/api/logos", router: logosRouter }],
});
