// =============================================================================
// Module: taxonomy
// =============================================================================
// Tags, and the MCP tools that read and sort contacts into tags and lists.
//
// Not named "tags": a global gitignore often ignores that word, and a folder
// it ignores would never reach the repository.
// =============================================================================

import { defineModule } from "../module.ts";
import { tagsRouter } from "../../routes/tags.ts";
import { registerTaxonomyTools } from "../../mcp/tools/taxonomy.ts";

export const taxonomyModule = defineModule({
  id: "taxonomy",
  routers: [{ path: "/api", router: tagsRouter }],
  mcpTools: [registerTaxonomyTools],
});
