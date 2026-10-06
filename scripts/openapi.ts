// npm run api:openapi — write docs/openapi.json from the route contracts
// Every route with a contract in shared/contracts/ becomes one operation of
// an OpenAPI 3.1 document: its path and query parameters, its JSON body, and
// the JSON body of a success. Zod writes each schema (`z.toJSONSchema`),
// bodies and queries as a client sends them and answers as the server sends
// them. A schema the contracts name with `.meta({ id })`, such as `Contact`,
// is written once under `components.schemas`.
//
// Routes in `UNCONTRACTED` are not in the file yet. Paths keep the `/api`
// prefix, and `:id` is written `{id}`.
//
//   node scripts/openapi.ts    rewrite docs/openapi.json
//
// tests/integration/contracts.test.ts fails when the committed file differs
// from what this builds, so run it after changing a contract.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { format } from "prettier";
import { z } from "zod";
import { CONTRACTS, type RouteContract } from "../shared/contracts/index.ts";

type JsonSchema = Record<string, unknown>;

interface Operation {
  summary: string;
  parameters?: JsonSchema[];
  requestBody?: JsonSchema;
  responses: Record<string, JsonSchema>;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: { title: string; version: string; description: string };
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, JsonSchema> };
}

const OUTPUT = path.resolve(import.meta.dirname, "../docs/openapi.json");

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];

const STATUS_TEXT: Record<number, string> = { 200: "OK", 201: "Created" };

/**
 * Zod writes a whole number with the bounds of a safe integer. They say
 * nothing a reader needs, so a bare `.int()` is written as "integer" alone.
 */
function dropSafeIntegerBounds(json: JsonSchema): void {
  if (json.minimum === Number.MIN_SAFE_INTEGER) delete json.minimum;
  if (json.maximum === Number.MAX_SAFE_INTEGER) delete json.maximum;
}

/**
 * One schema as JSON Schema, with the named schemas it holds moved into
 * `components`, and its references pointed there.
 */
function toSchema(
  schema: z.ZodType,
  io: "input" | "output",
  components: Record<string, JsonSchema>,
): JsonSchema {
  const json = z.toJSONSchema(schema, {
    io,
    override: ({ jsonSchema }) => dropSafeIntegerBounds(jsonSchema),
  }) as JsonSchema;
  const { $schema: _dialect, $defs, ...rest } = json;
  for (const [id, def] of Object.entries(($defs ?? {}) as JsonSchema)) {
    const written = pointRefs(def) as JsonSchema;
    const earlier = components[id];
    if (earlier && JSON.stringify(earlier) !== JSON.stringify(written)) {
      throw new Error(`Two different schemas are named "${id}"`);
    }
    components[id] = written;
  }
  return pointRefs(rest) as JsonSchema;
}

/** Rewrite every `#/$defs/X` reference as `#/components/schemas/X`. */
function pointRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(pointRefs);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === "$ref" && typeof inner === "string"
        ? inner.replace("#/$defs/", "#/components/schemas/")
        : pointRefs(inner),
    ]),
  );
}

/** The path parameters, then the query parameters, of one route. */
function parametersOf(
  contract: RouteContract,
  components: Record<string, JsonSchema>,
): JsonSchema[] {
  const parameters: JsonSchema[] = [];
  const declared = contract.params?.shape ?? {};
  for (const [, name] of contract.path.matchAll(/:(\w+)/g)) {
    const schema = declared[name];
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: schema
        ? toSchema(schema as z.ZodType, "input", components)
        : { type: "string" },
    });
  }
  if (contract.query) {
    const query = toSchema(contract.query, "input", components);
    const required = new Set((query.required as string[] | undefined) ?? []);
    const properties = (query.properties ?? {}) as Record<string, JsonSchema>;
    for (const [name, schema] of Object.entries(properties)) {
      const { description, ...rest } = schema;
      parameters.push({
        name,
        in: "query",
        required: required.has(name),
        ...(description === undefined ? {} : { description }),
        schema: rest,
      });
    }
  }
  return parameters;
}

/** Build the document from the contracts. */
export function buildOpenApi(): OpenApiDocument {
  const components: Record<string, JsonSchema> = {};
  const paths: Record<string, Record<string, Operation>> = {};

  const ordered = [...CONTRACTS].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      METHOD_ORDER.indexOf(a.method.toLowerCase()) -
        METHOD_ORDER.indexOf(b.method.toLowerCase()),
  );
  for (const contract of ordered) {
    const parameters = parametersOf(contract, components);
    const response = toSchema(contract.response, "output", components);
    const responses: Operation["responses"] = {};
    for (const status of [contract.status ?? 200].flat()) {
      responses[String(status)] = {
        description: STATUS_TEXT[status] ?? "Success",
        content: { "application/json": { schema: response } },
      };
    }
    const operation: Operation = {
      summary: contract.summary,
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(contract.body
        ? {
            requestBody: {
              // A body the route also reads when it is absent is optional.
              required: !contract.body.safeParse(undefined).success,
              content: {
                "application/json": {
                  schema: toSchema(contract.body, "input", components),
                },
              },
            },
          }
        : {}),
      responses,
    };
    const key = contract.path.replace(/:(\w+)/g, "{$1}");
    paths[key] ??= {};
    paths[key][contract.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Contrack API",
      version: "1.0.0",
      description:
        "The routes with a contract in shared/contracts/. `npm run api:openapi` writes this file from them, so change a contract rather than the file. docs/api-reference.md describes every route, how to authenticate and the error envelope.",
    },
    paths,
    components: {
      schemas: Object.fromEntries(
        Object.entries(components).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
  };
}

/** The document as the committed file holds it: JSON, formatted by Prettier. */
export async function renderOpenApi(): Promise<string> {
  return format(JSON.stringify(buildOpenApi()), { parser: "json" });
}

async function main(): Promise<void> {
  await writeFile(OUTPUT, await renderOpenApi());
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}`);
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("openapi.ts") ||
    process.argv[1].endsWith("openapi.js"));

if (isDirectRun) {
  void main();
}
