// The MCP endpoint, and the query routes a token reads, mounted at /api before
// the contacts router so GET /api/contacts/action-items reaches this file and
// not GET /api/contacts/:id. Every handler takes the caller's scope.

import { Router } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { log } from "../utils/logger.ts";
import { mcpService } from "../services/mcpService.ts";
import { searchInteractions } from "../services/interactionSearchService.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import {
  parseInteractionSearchQuery,
  parseQuery,
} from "../utils/validators.ts";
import { queryRoutes } from "../../shared/contracts/query.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { buildMcpServer } from "../mcp/server.ts";
import { createRateLimiter } from "../middleware/rateLimit.ts";
import { mcpOriginGuard } from "../middleware/hostGuard.ts";

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
  mcpOriginGuard,
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
    // The contract caps limit and offset, so no value reaches SQL unbounded.
    const options = parseQuery(queryRoutes.contacts.query, req.query);
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
 * The note search as an array of hits, each with `contactName`, the shape MCP
 * clients read. The same engine as GET /api/search/interactions: ranked FTS5
 * over the note index, with the question's date phrase applied as a filter.
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
    const { limit, since, type } = parseQuery(
      queryRoutes.timeline.query,
      req.query,
    );
    const rows = mcpService.getGlobalTimeline(scopeOf(req), limit, since, type);

    log.debug("API", `[${rid}] GET /api/timeline → ${rows.length} entries`);
    res.json(rows);
  }),
);

export const mcpRouter = router;
