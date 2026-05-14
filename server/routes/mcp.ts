import { Router } from "express";
import { log } from "../utils/logger.ts";
import { mcpService } from "../services/mcpService.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

router.get(
  "/query/contacts",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;

    const options = {
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
      fields: req.query.fields as string,
      role: req.query.role as string,
      company: req.query.company as string,
      industry: req.query.industry as string,
    };

    const rows = mcpService.queryContacts(options);

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
    const rid = (req as any).requestId;
    const rows = mcpService.getActionItems();

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
    const rows = mcpService.getTags();
    res.json(rows.map((r) => r.tag));
  }),
);

router.get(
  "/industries",
  asyncHandler(async (req, res) => {
    const rows = mcpService.getIndustries();
    res.json(rows.map((r) => r.industry));
  }),
);

router.get(
  "/interactions/search",
  asyncHandler(async (req, res) => {
    const rid = (req as any).requestId;
    const q = req.query.q as string;
    if (!q) throw new AppError("q parameter is required", 400);

    const type = req.query.type as string;
    const rows = mcpService.searchInteractions(q, type);

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
    const rid = (req as any).requestId;
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since as string;
    const type = req.query.type as string;

    const rows = mcpService.getGlobalTimeline(limit, since, type);

    log.debug("API", `[${rid}] GET /api/timeline → ${rows.length} entries`);
    res.json(rows);
  }),
);

export const mcpRouter = router;
