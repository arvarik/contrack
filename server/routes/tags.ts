// The tag vocabulary across an account's contacts, at /api:
//   GET    /api/tags/summary   tags with contact counts
//   PATCH  /api/tags/:tag      rename or merge a tag
//   DELETE /api/tags/:tag      delete a tag from all contacts
// GET /api/tags, on mcpRouter, answers a plain string[] for MCP.

import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { validateBody } from "../utils/validators.ts";
import { tagService } from "../services/tagService.ts";
import { tagRoutes } from "../../shared/contracts/tags.ts";

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
  validateBody(tagRoutes.rename.body),
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
