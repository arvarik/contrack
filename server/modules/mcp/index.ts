// The MCP endpoint and the query routes it shares with REST clients. It mounts
// before the contacts module on purpose: its literal GET /contacts/action-items
// would otherwise be taken by the contacts router's GET /contacts/:id and
// answered with a 404. Express matches in mount order, and
// tests/integration/tenancy.routing.test.ts holds it.

import { defineModule } from "../module.ts";
import { mcpRouter } from "../../routes/mcp.ts";

export const mcpModule = defineModule({
  id: "mcp",
  routers: [{ path: "/api", router: mcpRouter }],
});
