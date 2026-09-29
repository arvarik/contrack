// =============================================================================
// Unit: Node runs the server and the scripts without a TypeScript loader
// =============================================================================
// Node 26 strips TypeScript's types and runs the file, with no tsx or
// esbuild. The compiler catches most of what that needs (tsconfig's
// verbatimModuleSyntax and erasableSyntaxOnly). It does not catch the rest,
// because it resolves imports the way a bundler does:
//
//   - A relative import must name its file. Node does not try `.ts`, and
//     it does not read `index.ts` for a folder.
//   - The file must be `.ts`, `.mts` or `.cts`. Node does not run JSX.
//
// This test follows every relative import from server.ts and from each
// script in scripts/, so a gap fails here instead of at `node server.ts`.
// It also runs Node's own type stripper on every file it reaches, so an enum,
// a namespace or a parameter property fails here whatever tsconfig says.
// verbatimModuleSyntax has no such check, so the last test reads the flag.
// =============================================================================

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** Relative specifiers a file loads at runtime. `import type` is erased. */
function relativeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const statement =
    /^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["'](\.[^"']+)["']/gms;
  for (const m of source.matchAll(statement)) found.push(m[2]);
  for (const m of source.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g))
    found.push(m[1]);
  for (const m of source.matchAll(/^\s*import\s+["'](\.[^"']+)["']/gm))
    found.push(m[1]);
  return found;
}

function scriptEntries(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return scriptEntries(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

/** Every problem Node would hit, walking the graph from the entries. */
function problems(entries: string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    try {
      stripTypeScriptTypes(readFileSync(file, "utf8"));
    } catch (err) {
      found.push(`${path.relative(ROOT, file)}: ${(err as Error).message}`);
    }
    for (const spec of relativeImports(file)) {
      const target = path.resolve(path.dirname(file), spec);
      const from = path.relative(ROOT, file);
      if (!/\.(ts|mts|cts|js|mjs|cjs|json)$/.test(spec)) {
        found.push(`${from}: "${spec}" names no file extension`);
      } else if (!existsSync(target)) {
        found.push(`${from}: "${spec}" does not exist`);
      } else if (/\.(ts|mts|cts)$/.test(target)) {
        queue.push(target);
      }
    }
    if (file.endsWith(".tsx"))
      found.push(`${path.relative(ROOT, file)} is JSX`);
  }
  return found;
}

describe("native TypeScript", () => {
  it("resolves every import the server loads, and strips every file's types", () => {
    expect(problems([path.join(ROOT, "server.ts")])).toEqual([]);
  });

  it("resolves every import each script loads, and strips every file's types", () => {
    expect(problems(scriptEntries(path.join(ROOT, "scripts")))).toEqual([]);
  });

  it("keeps the compiler check that stands in for a loader", () => {
    const tsconfig = readFileSync(path.join(ROOT, "tsconfig.json"), "utf8");
    expect(tsconfig).toMatch(/"verbatimModuleSyntax":\s*true/);
  });
});
