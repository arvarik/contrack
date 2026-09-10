// =============================================================================
// Routes — MCP: the read-only surface for an MCP client or a personal token
// =============================================================================
// Mounted in server/app.ts at /api, before contactsRouter so that
// GET /api/contacts/action-items reaches this file rather than
// GET /api/contacts/:id. Every handler takes the caller's scope.
// =============================================================================

import { Router } from "express";
import { log } from "../utils/logger.ts";
import { mcpService } from "../services/mcpService.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";

const router = Router();

router.get(
  "/query/contacts",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;

    const options = {
      // Cap limit/offset — unbounded values previously reached SQL directly.
      limit: Math.min(parseInt(req.query.limit as string) || 50, 200),
      offset: Math.max(parseInt(req.query.offset as string) || 0, 0),
      fields: req.query.fields as string,
      role: req.query.role as string,
      company: req.query.company as string,
      industry: req.query.industry as string,
    };

    const rows = mcpService.queryContacts(scopeOf(req), options);

    log.debug(
      "API",
      `[${rid}] GET /api/query/contacts → ${rows.length} records`,
    );
    res.json(rows);
  }),
);

router.get(
  "/contacts/action-items",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const rows = mcpService.getActionItems(scopeOf(req));

    log.debug(
      "API",
      `[${rid}] GET /api/contacts/action-items → ${rows.length} contacts`,
    );
    res.json(rows);
  }),
);

router.get(
  "/tags",
  asyncHandler(async (req, res) => {
    const rows = mcpService.getTags(scopeOf(req));
    res.json(rows.map((r) => r.tag));
  }),
);

router.get(
  "/industries",
  asyncHandler(async (req, res) => {
    const rows = mcpService.getIndustries(scopeOf(req));
    res.json(rows.map((r) => r.industry));
  }),
);

router.get(
  "/interactions/search",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const q = req.query.q as string;
    if (!q) throw new AppError("q parameter is required", 400);

    const type = req.query.type as string;
    const rows = mcpService.searchInteractions(scopeOf(req), q, type);

    log.debug(
      "API",
      `[${rid}] GET /api/interactions/search → ${rows.length} results`,
    );
    res.json(rows);
  }),
);

router.get(
  "/timeline",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const since = req.query.since as string;
    const type = req.query.type as string;

    const rows = mcpService.getGlobalTimeline(scopeOf(req), limit, since, type);

    log.debug("API", `[${rid}] GET /api/timeline → ${rows.length} entries`);
    res.json(rows);
  }),
);

export const mcpRouter = router;
