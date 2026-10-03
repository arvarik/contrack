// =============================================================================
// Module: lists
// =============================================================================
// Lists of contacts and their members.
// =============================================================================

import { defineModule } from "../module.ts";
import { listsRouter } from "../../routes/lists.ts";

export const listsModule = defineModule({
  id: "lists",
  routers: [{ path: "/api/lists", router: listsRouter }],
});
