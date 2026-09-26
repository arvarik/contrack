// =============================================================================
// Unit: the runtime image holds every file the server imports
// =============================================================================
// The Dockerfile's runtime stage copies a chosen set of paths, and the server
// grew imports from outside it: `shared/` (searchFacets, dates, connectors,
// the MCP tool list) and `src/lib/devices.ts`. Nothing ran the image, so it
// failed at boot with ERR_MODULE_NOT_FOUND on every build since. This test
// reads the COPY lines and follows the server's runtime imports, so the next
// such import fails here instead of in somebody's container.
//
// The same walk checks packages. The image installs with --omit=dev, so a
// package the server loads must be in dependencies, not devDependencies.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
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

/** Specifiers a file loads at runtime. `import type` is erased. */
function runtimeSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const statement =
    /^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gms;
  for (const m of source.matchAll(statement)) found.push(m[2]);
  for (const m of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    found.push(m[1]);
  // A bare side-effect import: import "./x.ts";
  for (const m of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm))
    found.push(m[1]);
  return found;
}

/** Relative specifiers a file loads at runtime. */
function runtimeImports(file: string): string[] {
  return runtimeSpecifiers(file).filter((s) => s.startsWith("."));
}

/** The package a bare specifier names: "a/b" is "a", "@s/a/b" is "@s/a". */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Every package the server loads at runtime, with a file that loads it.
 * Starts at server.ts and follows relative imports, like the image does.
 */
function serverPackages(): Map<string, string> {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const queue = [path.join(ROOT, "server.ts")];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeSpecifiers(file)) {
      if (spec.startsWith(".")) {
        const target = path.resolve(path.dirname(file), spec);
        if (target.endsWith(".ts")) queue.push(target);
      } else if (!spec.startsWith("node:") && !builtinModules.includes(spec)) {
        const name = packageOf(spec);
        if (!packages.has(name)) packages.set(name, path.relative(ROOT, file));
      }
    }
  }
  return packages;
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

  it("installs every package the server loads", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    );
    const production = new Set(Object.keys(pkg.dependencies ?? {}));
    // server.ts imports vite only when NODE_ENV is not production.
    const devOnly = new Set(["vite"]);
    const missing = [...serverPackages()]
      .filter(([name]) => !production.has(name) && !devOnly.has(name))
      .map(([name, file]) => `${name} (from ${file})`);
    expect(missing).toEqual([]);
    // The image starts the server with `node --import tsx`.
    expect(production.has("tsx")).toBe(true);
  });

  it("reads the COPY lines it checks against", () => {
    const copied = runtimeCopies().map((p) => path.relative(ROOT, p));
    expect(copied).toEqual(
      expect.arrayContaining(["server", "shared", "server.ts"]),
    );
  });
});
