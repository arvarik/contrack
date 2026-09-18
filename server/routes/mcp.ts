// =============================================================================
// Routes — MCP: the read-only surface for an MCP client or a personal token
// =============================================================================
// Mounted in server/app.ts at /api, before contactsRouter so that
// GET /api/contacts/action-items reaches this file rather than
// GET /api/contacts/:id. Every handler takes the caller's scope.
// =============================================================================

import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "../utils/logger.ts";
import { mcpService } from "../services/mcpService.ts";
import { searchInteractions } from "../services/interactionSearchService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { parseInteractionSearchQuery } from "../utils/validators.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { buildMcpServer } from "../mcp/server.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";

export const mcpRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 120,
  name: "MCP",
  keyBy: (req) => req.principal?.user.id ?? req.ip ?? null,
});

export function __resetMcpRateLimit(): void {
  mcpRateLimit.reset();
}

const router = Router();

router.post(
  "/mcp",
  mcpRateLimit,
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const server = buildMcpServer(scope, req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }),
);

router.get("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: "Method Not Allowed",
    message: "MCP server runs in stateless HTTP mode; use POST /api/mcp",
  });
});

router.delete("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: "Method Not Allowed",
    message: "MCP server runs in stateless HTTP mode; use POST /api/mcp",
  });
});

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

/**
 * The note search, in the array shape this route has always answered with.
 *
 * Same engine as GET /api/search/interactions: ranked FTS5 over the note
 * index, with the date phrase in the question applied as a filter. The
 * envelope is flattened to the hits, and each hit carries `contactName`, so
 * an MCP client that read `title` and `contactName` before still can.
 */
router.get(
  "/interactions/search",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const params = parseInteractionSearchQuery(req.query);
    const result = searchInteractions(scopeOf(req), params);

    log.debug(
      "API",
      `[${rid}] GET /api/interactions/search → ${result.hits.length} of ${result.total}`,
    );
    res.json(
      result.hits.map((hit) => ({ ...hit, contactName: hit.contact.name })),
    );
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
