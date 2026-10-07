// Unit: every place that names a Node version names the same one.
// v2 runs on Node 26.10 or later. The version is written in seven places, and
// this test reads all seven:
//
//   .nvmrc           the pin for CI (setup-node) and for nvm and fnm
//   .tool-versions   the same pin for mise and asdf
//   engines          the floor npm reports to anyone installing
//   devEngines       the floor npm enforces before install, ci and run
//   Dockerfile       the image's Node line, on Debian 13 (trixie)
//   devcontainer     the version a dev container or a Codespace installs
//   @types/node      the types, which must be for the same major

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
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

  // The pin itself, not a major: the Node images for dev containers trail
  // the Node releases, and their 26 image still carried 26.8, which npm
  // refuses before `npm ci` runs.
  it("is the exact version the dev container installs", () => {
    const devcontainer = JSON.parse(read(".devcontainer/devcontainer.json"));
    expect(
      devcontainer.features["ghcr.io/devcontainers/features/node:1"],
    ).toEqual({ version: PIN });
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
