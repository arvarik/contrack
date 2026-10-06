// Contracts: one route's contract, and the types read from it
// A contract names a route the way the route manifest does, and holds Zod
// schemas for what the route reads and what it answers. The server validates
// requests with them, the client takes its types from them, the MCP tools
// build their inputs from them, and `npm run api:openapi` writes them out.
//
// Kept apart from `index.ts`, which imports every area file for the
// registry, so an area file can use `route()` without importing the others.

import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteContract {
  method: HttpMethod;
  /** The path as the route manifest writes it, such as `/api/contacts/:id`. */
  path: string;
  /** One line for the OpenAPI file. */
  summary: string;
  /** The status of a success: 200 unless the contract says otherwise. */
  status?: number | readonly number[];
  /** The path parameters. A path parameter with none is a plain string. */
  params?: z.ZodObject;
  /** The query string, as the route parses it. */
  query?: z.ZodType;
  /** The JSON body, as the route parses it. */
  body?: z.ZodType;
  /**
   * The JSON body of a success. Objects are strict, so the response check in
   * `tests/integration/helpers.ts` fails on a field the contract does not
   * declare. No transforms and no defaults: it describes what is sent.
   */
  response: z.ZodType;
}

/** Declare a route's contract. It returns the contract with its exact types. */
export function route<const C extends RouteContract>(contract: C): C {
  return contract;
}

/** The body a route answers with, as the client reads it. */
export type ResponseOf<C extends RouteContract> = z.output<C["response"]>;

/** The body a route takes, as a client writes it. */
export type BodyOf<C extends RouteContract> = C["body"] extends z.ZodType
  ? z.input<C["body"]>
  : never;
