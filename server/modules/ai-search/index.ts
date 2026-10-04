// =============================================================================
// Module: ai-search
// =============================================================================
// Contact research: batches that read the web about contacts.
// =============================================================================

import { defineModule } from "../module.ts";
import { aiSearchRouter } from "../../routes/aiSearch.ts";

export const aiSearchModule = defineModule({
  id: "ai-search",
  routers: [{ path: "/api", router: aiSearchRouter }],
});
