/**
 * server/mcp/tools/search.ts — Search MCP tools for people and notes.
 *
 * Implements:
 * - search_people
 * - search_notes
 *
 * @module server/mcp/tools/search
 */

import { z } from "zod";
import type { Request } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../../tenancy/scope.ts";
import { searchService } from "../../services/searchService.ts";
import { searchInteractions } from "../../services/interactionSearchService.ts";
import {
  matchesFacet,
  type FacetContact,
} from "../../../shared/searchFacets.ts";
import { MCP_TOOL_DESCRIPTIONS } from "../../../shared/mcpTools.ts";
import { trackedTool, type ErrorTracker } from "../errors.ts";

export function registerSearchTools(
  server: McpServer,
  scope: Scope,
  req: Request,
  onError: ErrorTracker,
): void {
  server.registerTool(
    "search_people",
    {
      description: MCP_TOOL_DESCRIPTIONS.search_people,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Natural language query across names, notes, and background",
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .optional()
          .describe("Maximum results to return (default 20, max 50)"),
        role: z.string().optional().describe("Filter by job title or role"),
        company: z.string().optional().describe("Filter by company"),
        location: z.string().optional().describe("Filter by location"),
        industry: z.string().optional().describe("Filter by industry"),
        tag: z.string().optional().describe("Filter by tag"),
        list: z.string().optional().describe("Filter by list name or list ID"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async (params) => {
      const rid = req.requestId ?? "mcp-search";
      const result = await searchService.semanticSearch(
        scope,
        params.query,
        rid,
      );
      let matches = result.matches;

      if (params.role) {
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, {
            field: "role",
            value: params.role!,
          }),
        );
      }
      if (params.company) {
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, {
            field: "company",
            value: params.company!,
          }),
        );
      }
      if (params.location) {
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, {
            field: "location",
            value: params.location!,
          }),
        );
      }
      if (params.industry) {
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, {
            field: "industry",
            value: params.industry!,
          }),
        );
      }
      if (params.tag) {
        matches = matches.filter((c) =>
          matchesFacet(c as unknown as FacetContact, {
            field: "tag",
            value: params.tag!,
          }),
        );
      }
      if (params.list) {
        const filterList = params.list.toLowerCase();
        matches = matches.filter((c) => {
          const lists = (
            c as unknown as { lists?: Array<{ id: string; name?: string }> }
          ).lists;
          return (
            Array.isArray(lists) &&
            lists.some(
              (l) =>
                l.id === params.list ||
                (typeof l.name === "string" &&
                  l.name.toLowerCase().includes(filterList)),
            )
          );
        });
      }

      const limit = params.limit ?? 20;
      const sliced = matches.slice(0, limit);

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${sliced.length} contacts matching "${params.query}"`,
          },
        ],
        structuredContent: {
          matches: sliced,
          total: matches.length,
          fallback: result.fallback,
        },
      };
    }),
  );

  server.registerTool(
    "search_notes",
    {
      description: MCP_TOOL_DESCRIPTIONS.search_notes,
      inputSchema: {
        query: z.string().describe("Search keywords in notes and interactions"),
        from: z
          .string()
          .optional()
          .describe("Start date (YYYY-MM-DD or ISO timestamp)"),
        to: z
          .string()
          .optional()
          .describe("End date (YYYY-MM-DD or ISO timestamp)"),
        type: z
          .string()
          .optional()
          .describe("Interaction type (e.g. note, meeting, email, call)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(20)
          .optional()
          .describe("Maximum notes to return (default 20, max 50)"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    trackedTool(onError, async (params) => {
      const res = searchInteractions(scope, {
        q: params.query,
        from: params.from,
        to: params.to,
        type: params.type,
        limit: params.limit ?? 20,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${res.hits.length} of ${res.total} notes matching "${params.query}"`,
          },
        ],
        structuredContent: {
          hits: res.hits,
          total: res.total,
        },
      };
    }),
  );
}
