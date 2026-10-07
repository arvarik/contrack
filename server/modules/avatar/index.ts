// The generated default avatars.

import { defineModule } from "../module.ts";
import { avatarRouter } from "../../routes/avatar.ts";

export const avatarModule = defineModule({
  id: "avatar",
  routers: [{ path: "/api", router: avatarRouter }],
});
