// =============================================================================
// Unit: every place that names a Node version names the same one
// =============================================================================
// v2 runs on Node 26.10 or later, and nothing is left on Node 22. The version
// is written down in six places, and they drifted before: the Docker image,
// CI and the docs each said 22 on their own. This test reads all six.
//
//   .nvmrc           the pin for CI (setup-node) and for nvm and fnm
//   .tool-versions   the same pin for mise and asdf
//   engines          the floor npm reports to anyone installing
//   devEngines       the floor npm enforces before install, ci and run
//   Dockerfile       the image's Node line, on Debian 13 (trixie)
//   @types/node      the types, which must be for the same major
// =============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const pkg = JSON.parse(read("package.json"));

const PIN = read(".nvmrc").trim();
const MAJOR = PIN.split(".")[0];

describe("the Node version", () => {
  it("is pinned to one exact version", () => {
    expect(PIN).toMatch(/^26\.\d+\.\d+$/);
    expect(read(".tool-versions").trim()).toBe(`nodejs ${PIN}`);
  });

  it("is the floor for installs and for every npm command", () => {
    const floor = `>=${PIN.split(".").slice(0, 2).join(".")}.0`;
    expect(pkg.engines.node).toBe(floor);
    expect(pkg.devEngines.runtime).toEqual({
      name: "node",
      version: floor,
      onFail: "error",
    });
  });

  it("is the line the Docker image runs, on Debian trixie", () => {
    const froms = [...read("Dockerfile").matchAll(/^FROM (\S+)/gm)].map(
      (m) => m[1],
    );
    expect(froms).toEqual([
      `node:${MAJOR}-trixie`,
      `node:${MAJOR}-trixie-slim`,
    ]);
  });

  it("is what CI installs", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/node-version:\s/);
    expect(ci.match(/node-version-file: \.nvmrc/g)?.length).toBeGreaterThan(0);
  });

  it("matches the types the compiler checks against", () => {
    expect(pkg.devDependencies["@types/node"]).toMatch(
      new RegExp(`^\\^${MAJOR}\\.`),
    );
  });
});
