// Ask Contrack and the people, notes and palette searches. Its start-up work
// warms the starter questions, recovers the index queue, loads the local models
// and fills missing vectors (start.ts).

import { defineModule } from "../module.ts";
import { searchRouter } from "../../routes/search.ts";
import { registerSearchTools } from "../../mcp/tools/search.ts";
import { startSearch } from "./start.ts";

export const searchModule = defineModule({
  id: "search",
  routers: [{ path: "/api/search", router: searchRouter }],
  mcpTools: [registerSearchTools],
  onStart: startSearch,
});
