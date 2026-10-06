// Notes, meetings, calls and attachments on a contact's timeline.

import { defineModule } from "../module.ts";
import { interactionsRouter } from "../../routes/interactions.ts";
import { registerInteractionTools } from "../../mcp/tools/interactions.ts";

export const interactionsModule = defineModule({
  id: "interactions",
  routers: [{ path: "/api", router: interactionsRouter }],
  mcpTools: [registerInteractionTools],
});
