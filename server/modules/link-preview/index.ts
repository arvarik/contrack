// Link previews for the URLs in notes.

import { defineModule } from "../module.ts";
import { linkPreviewRouter } from "../../routes/linkPreview.ts";

export const linkPreviewModule = defineModule({
  id: "link-preview",
  routers: [{ path: "/api/link-preview", router: linkPreviewRouter }],
});
