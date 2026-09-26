// =============================================================================
// Unit: the runtime image holds every file the server imports
// =============================================================================
// The Dockerfile's runtime stage copies a chosen set of paths, and the server
// grew imports from outside it: `shared/` (searchFacets, dates, connectors,
// the MCP tool list) and `src/lib/devices.ts`. Nothing ran the image, so it
// failed at boot with ERR_MODULE_NOT_FOUND on every build since. This test
// reads the COPY lines and follows the server's runtime imports, so the next
// such import fails here instead of in somebody's container.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** The paths the runtime stage copies from the build context. */
function runtimeCopies(): string[] {
  const dockerfile = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const stages = dockerfile.split(/^FROM\s/m);
  const runtime = stages[stages.length - 1];
  const copies: string[] = [];
  for (const line of runtime.split("\n")) {
    const m = line.match(/^COPY\s+(?!--from)(.+)$/);
    if (!m) continue;
    const parts = m[1].trim().split(/\s+/);
    parts.pop(); // the destination
    copies.push(...parts.map((p) => path.join(ROOT, p)));
  }
  return copies;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** Relative specifiers a file loads at runtime. `import type` is erased. */
function runtimeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const statement =
    /^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["'](\.[^"']+)["']/gms;
  for (const m of source.matchAll(statement)) found.push(m[2]);
  for (const m of source.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g))
    found.push(m[1]);
  // A bare side-effect import: import "./x.ts";
  for (const m of source.matchAll(/^\s*import\s+["'](\.[^"']+)["']/gm))
    found.push(m[1]);
  return found;
}

describe("the runtime image", () => {
  it("copies every file the server imports at runtime", () => {
    const copied = runtimeCopies();
    const inImage = (target: string) =>
      copied.some(
        (c) => target === c || target.startsWith(c.replace(/\/?$/, "/")),
      );

    const files = [
      path.join(ROOT, "server.ts"),
      ...tsFiles(path.join(ROOT, "server")),
    ];
    const missing: string[] = [];
    const seen = new Set<string>();
    const queue = [...files];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of runtimeImports(file)) {
        const target = path.resolve(path.dirname(file), spec);
        if (!inImage(target)) {
          missing.push(
            `${path.relative(ROOT, file)} → ${path.relative(ROOT, target)}`,
          );
          continue;
        }
        if (target.endsWith(".ts")) queue.push(target);
      }
    }
    expect(missing).toEqual([]);
  });

  it("reads the COPY lines it checks against", () => {
    const copied = runtimeCopies().map((p) => path.relative(ROOT, p));
    expect(copied).toEqual(
      expect.arrayContaining(["server", "shared", "server.ts"]),
    );
  });
});
