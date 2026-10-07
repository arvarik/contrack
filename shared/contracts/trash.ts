// Contracts: trash
// Contacts a person deleted wait in the Trash for the retention an admin
// sets. The other trash routes have no contract yet (see `UNCONTRACTED`).

import { z } from "zod";
import { route } from "./route.ts";

export const trashRoutes = {
  empty: route({
    method: "DELETE",
    path: "/api/trash",
    summary:
      "Delete every contact in the Trash forever, with their notes and files",
    response: z.strictObject({ count: z.number().int() }),
  }),
};
