// =============================================================================
// Feature modules
// =============================================================================
// Each area of the server is one module: a folder under server/modules/ whose
// index.ts exports `defineModule({ ... })`. A module lists its routers, its
// MCP tools, its background jobs, its event subscribers and its start-up
// work. The core reads the ordered list in server/modules/index.ts:
//
//   - createApp() mounts every router, in list order (server/app.ts).
//   - registerAllTools() registers every MCP tool (server/mcp/tools/index.ts).
//   - server.ts registers every job and subscriber, starts the job runner,
//     and runs each module's start-up work.
//
// So a new feature is a folder and one line in that list, with no edit to the
// boot code. Three things stay central, because they hold for every module:
// the route manifest (server/tenancy/routeManifest.ts), the migration list
// (server/db/migrations/index.ts), and the auth router and middleware that
// run before every module (server/app.ts).
// =============================================================================

import type { Request, Router } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Scope } from "../tenancy/scope.ts";
import type { ErrorTracker } from "../mcp/errors.ts";
import type { JobDefinition } from "../jobs/runner.ts";
import type { Subscriber } from "../events/dispatcher.ts";

/** One router, and the path createApp() mounts it at. */
export interface ModuleRouter {
  path: string;
  router: Router;
}

/** What an MCP tool group needs to register its tools for one request. */
export interface McpToolContext {
  server: McpServer;
  scope: Scope;
  req: Request;
  onError: ErrorTracker;
}

/** Registers one group of MCP tools. */
export type McpTools = (context: McpToolContext) => void;

/** One area of the server, as the core reads it. */
export interface ContrackModule {
  /** A short name, unique in the list. Logs and errors use it. */
  id: string;
  /** Mounted in this order, after the auth middleware. */
  routers: readonly ModuleRouter[];
  /** Registered on every MCP request, in this order. */
  mcpTools: readonly McpTools[];
  /** Background work: recurring, at start, or on demand (server/jobs/). */
  jobs: readonly JobDefinition<unknown>[];
  /** Reactions to recorded events (server/events/). */
  subscribers: readonly Subscriber[];
  /**
   * Start-up work that is not a job, such as loading a model. It runs once,
   * after the server listens, and only when background jobs are on. A
   * failure is logged and does not stop the server.
   */
  onStart?: () => void | Promise<void>;
}

/** A module as written: every list is optional. */
export type ModuleDefinition = Pick<ContrackModule, "id"> &
  Partial<Omit<ContrackModule, "id">>;

/** Fill in the empty lists, so the core never checks for a missing one. */
export function defineModule(definition: ModuleDefinition): ContrackModule {
  return {
    routers: [],
    mcpTools: [],
    jobs: [],
    subscribers: [],
    ...definition,
  };
}
