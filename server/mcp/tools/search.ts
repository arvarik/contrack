/**
 * Search MCP tools: search_people and search_notes.
 *
 * @module server/mcp/tools/search
 */

import { z } from "zod";
import type { McpToolContext } from "../../modules/module.ts";
import { PHASE1_LIMIT, searchService } from "../../services/searchService.ts";
import {
  MAX_OFFSET,
  searchInteractions,
} from "../../services/interactionSearchService.ts";
import {
  matchesFacet,
  type FacetContact,
} from "../../../shared/searchFacets.ts";
import { queryRoutes } from "../../../shared/contracts/query.ts";
import { aiAllowedFor } from "../../middleware/aiAllowed.ts";
import { answer, count, cursorInput, offsetOf } from "../tool.ts";
import { contactSummary } from "../views.ts";

// The query of `GET /api/interactions/search`, the REST twin of search_notes.
// The tool's dates, type and limit are checked exactly as that route checks
// them.
const notesQuery = queryRoutes.searchNotes.query.shape;

/** The filters that narrow a people search, each a facet of the app's. */
const FACETS = ["role", "company", "location", "industry", "tag"] as const;

export function registerSearchTools({
  tool,
  scope,
  req,
}: McpToolContext): void {
  tool(
    "search_people",
    {
      query: z
        .string()
        .min(1)
        .describe("Natural language query across names, notes, and background"),
      // The search ranks at most PHASE1_LIMIT matches, and the filters
      // below narrow those. A larger limit would promise what it cannot give.
      limit: z
        .number()
        .int()
        .min(1)
        .max(PHASE1_LIMIT)
        .default(20)
        .optional()
        .describe(
          `Maximum results to return (default 20, max ${PHASE1_LIMIT})`,
        ),
      role: z.string().optional().describe("Filter by job title or role"),
      company: z.string().optional().describe("Filter by company"),
      location: z.string().optional().describe("Filter by location"),
      industry: z.string().optional().describe("Filter by industry"),
      tag: z.string().optional().describe("Filter by tag"),
      list: z.string().optional().describe("Filter by list name or list ID"),
    },
    async (params) => {
      // The same rule as Ask Contrack in the app: with AI off for the token's
      // account or for the instance, the search is local and runs no model.
      const result = await searchService.semanticSearch(
        scope,
        params.query,
        req.requestId ?? "mcp-search",
        undefined,
        { aiAllowed: aiAllowedFor(req) },
      );
      let matches = result.matches;
      for (const field of FACETS) {
        const value = params[field];
        if (!value) continue;
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, { field, value }),
        );
      }
      if (params.list) {
        const wanted = params.list.toLowerCase();
        matches = matches.filter((c) =>
          (
            c as unknown as { lists?: Array<{ id: string; name?: string }> }
          ).lists?.some(
            (l) =>
              l.id === params.list || l.name?.toLowerCase().includes(wanted),
          ),
        );
      }

      const sliced = matches.slice(0, params.limit ?? 20);
      return answer(
        `Found ${count(sliced.length, "contact")} for "${params.query}"`,
        {
          matches: sliced.map(contactSummary),
          total: matches.length,
          fallback: result.fallback,
        },
      );
    },
  );

  tool(
    "search_notes",
    {
      query: notesQuery.q
        .unwrap()
        .describe("Search keywords in notes and interactions"),
      from: notesQuery.from.describe(
        "Start date (YYYY-MM-DD or ISO timestamp)",
      ),
      to: notesQuery.to.describe("End date (YYYY-MM-DD or ISO timestamp)"),
      type: notesQuery.type.describe(
        "Interaction type (e.g. note, meeting, email, call)",
      ),
      cursor: cursorInput,
      limit: notesQuery.limit
        .unwrap()
        .default(20)
        .optional()
        .describe("Maximum notes to return (default 20, max 50)"),
    },
    ({ query, from, to, type, cursor, limit }) => {
      const offset = offsetOf(cursor);
      const res = searchInteractions(scope, {
        q: query,
        from,
        to,
        type,
        limit: limit ?? 20,
        offset,
      });
      // The search starts no later than MAX_OFFSET, so a cursor past it would
      // read the same page again. Paging ends there.
      const end = res.offset + res.hits.length;
      return answer(
        `Found ${count(res.hits.length, "note")} of ${res.total} for "${query}"`,
        {
          hits: res.hits,
          total: res.total,
          nextCursor:
            res.hits.length > 0 && end < res.total && end <= MAX_OFFSET
              ? String(end)
              : null,
        },
      );
    },
  );
}
