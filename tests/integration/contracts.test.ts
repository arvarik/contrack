// =============================================================================
// Integration: the route contracts keep up with the route manifest
// =============================================================================
// Every route in the manifest has a contract in shared/contracts/ or a line
// in UNCONTRACTED, never both, and that list only shrinks. The committed
// OpenAPI file is the one `npm run api:openapi` writes from the contracts.
//
// The response check has no file of its own: every integration test runs it,
// through makeTestApp() in ./helpers.ts.
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_MANIFEST } from "../../server/tenancy/routeManifest.ts";
import {
  CONTRACTS,
  UNCONTRACTED,
  UNCONTRACTED_CEILING,
  routeKey,
} from "../../shared/contracts/index.ts";
import { buildOpenApi } from "../../scripts/openapi.ts";

const keyOf = (route: { method: string; path: string }) =>
  routeKey(route.method, route.path);

const twice = (keys: readonly string[]) =>
  keys.filter((key, index) => keys.indexOf(key) !== index);

describe("route contracts", () => {
  it("give every manifest route a contract or a line in UNCONTRACTED, and the list only shrinks", () => {
    const manifest = new Set(ROUTE_MANIFEST.map(keyOf));
    const contracted = CONTRACTS.map(keyOf);
    const hasContract = new Set(contracted);
    const listed = new Set(UNCONTRACTED);

    expect(twice(contracted), "routes with two contracts").toEqual([]);
    expect(twice(UNCONTRACTED), "routes listed twice").toEqual([]);
    expect(
      contracted.filter((key) => !manifest.has(key)),
      "contracts for routes the manifest does not have",
    ).toEqual([]);
    expect(
      [...manifest].filter((key) => !hasContract.has(key) && !listed.has(key)),
      "manifest routes with no contract and no line in UNCONTRACTED",
    ).toEqual([]);
    expect(
      UNCONTRACTED.filter((key) => hasContract.has(key)),
      "routes in UNCONTRACTED that have a contract: take them off the list",
    ).toEqual([]);
    expect(
      UNCONTRACTED.filter((key) => !manifest.has(key)),
      "routes in UNCONTRACTED that the manifest does not have",
    ).toEqual([]);
    expect(
      UNCONTRACTED.length,
      "UNCONTRACTED and UNCONTRACTED_CEILING differ: give a new route a contract, and when the list shrinks, lower UNCONTRACTED_CEILING in shared/contracts/index.ts to its length",
    ).toBe(UNCONTRACTED_CEILING);
  });

  it("commits docs/openapi.json as npm run api:openapi writes it", () => {
    const committed = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, "../../docs/openapi.json"),
        "utf8",
      ),
    );
    expect(
      committed,
      "docs/openapi.json is out of date: run npm run api:openapi",
    ).toEqual(buildOpenApi());
  });
});
