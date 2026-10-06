// Follow-ups: tasks with a due date on a contact.

import { defineModule } from "../module.ts";
import { actionItemsRouter } from "../../routes/actionItems.ts";
import { registerActionItemTools } from "../../mcp/tools/actions.ts";

export const actionItemsModule = defineModule({
  id: "action-items",
  routers: [{ path: "/api", router: actionItemsRouter }],
  mcpTools: [registerActionItemTools],
});
