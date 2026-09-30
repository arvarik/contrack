// =============================================================================
// Unit: the reference pages cover what the code holds
// =============================================================================
// Two lists in the code are the truth behind two reference pages. Every route
// the server registers is a row in ROUTE_MANIFEST, so docs/api-reference.md
// must name each one as `METHOD /path`, and must not name a route that no
// longer exists. Every key binding is a row in SHORTCUTS, so
// docs/keyboard-shortcuts.md must carry each description word for word. A
// route or a shortcut added without its line in the docs fails here.
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_MANIFEST } from "../../../server/tenancy/routeManifest.ts";
import { SHORTCUTS, SHORTCUT_GROUP_ORDER } from "../../../src/lib/shortcuts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the API reference", () => {
  const doc = read("docs/api-reference.md");
  const routes = ROUTE_MANIFEST.map((route) => `${route.method} ${route.path}`);

  it("names every route the server registers", () => {
    expect(routes.filter((route) => !doc.includes(`\`${route}\``))).toEqual([]);
  });

  it("names no route the server does not register", () => {
    const known = new Set(routes);
    const named = [
      ...doc.matchAll(
        /`(GET|POST|PUT|PATCH|DELETE) (\/(?:api\/[^`\s?]*|healthz))[^`]*`/g,
      ),
    ].map((m) => `${m[1]} ${m[2]}`);
    expect([...new Set(named)].filter((route) => !known.has(route))).toEqual(
      [],
    );
  });
});

describe("the keyboard shortcuts page", () => {
  const doc = read("docs/keyboard-shortcuts.md");

  it("describes every shortcut", () => {
    expect(
      SHORTCUTS.map((shortcut) => shortcut.description).filter(
        (description) => !doc.includes(description),
      ),
    ).toEqual([]);
  });

  it("names every group", () => {
    expect(
      SHORTCUT_GROUP_ORDER.filter((group) => !doc.includes(group)),
    ).toEqual([]);
  });
});
