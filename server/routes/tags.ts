// =============================================================================
// Routes — Tags: manage tag vocabulary across an account's contacts
// =============================================================================
// Mounted in server/app.ts at /api.
//   GET    /api/tags/summary   tag vocabulary with contact counts
//   PATCH  /api/tags/:tag      rename or merge tag
//   DELETE /api/tags/:tag      delete tag from all contacts
//
// GET /api/tags remains on mcpRouter answering a plain string[] array for MCP.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { validateBody } from "../utils/validators.ts";
import { tagService } from "../services/tagService.ts";

const renameTagSchema = z.object({
  to: z.string().trim().min(1, "Tag name cannot be empty").max(100),
});

const router = Router();

router.get(
  "/tags/summary",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const tags = tagService.getSummary(scope);
    res.json({ tags });
  }),
);

router.patch(
  "/tags/:tag",
  validateBody(renameTagSchema),
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const fromTag = String(req.params.tag);
    const { to } = req.body;
    const result = tagService.renameTag(scope, fromTag, to);
    res.json(result);
  }),
);

router.delete(
  "/tags/:tag",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const tag = String(req.params.tag);
    const result = tagService.deleteTag(scope, tag);
    res.json(result);
  }),
);

export const tagsRouter = router;
