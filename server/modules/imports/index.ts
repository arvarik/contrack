// Bulk imports from CSV and vCard files, and their durable record.

import { defineModule } from "../module.ts";
import { importsRouter } from "../../routes/imports.ts";

export const importsModule = defineModule({
  id: "imports",
  routers: [{ path: "/api", router: importsRouter }],
});
