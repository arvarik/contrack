// Unit: a Codespace opens Contrack with no sign-in and no host refusal
// The dev container starts the dev server with sign-in off. A Codespace reaches
// it at https://<name>-3210.app.github.dev, a public DNS name. With sign-in off,
// the DNS rebinding guard refuses a public name, and so does Vite's own host
// check, so every page answered 403. The container allows the forwarding
// domain to both. This holds the container to the guard, so a change to either
// fails here and not in a Codespace.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isHostAllowed } from "../../../server/middleware/hostGuard.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const container = JSON.parse(
  readFileSync(path.join(ROOT, ".devcontainer/devcontainer.json"), "utf8"),
);
const FORWARDED = "fuzzy-space-train-3210.app.github.dev";

describe("the dev container", () => {
  const saved = {
    ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
    PUBLIC_URL: process.env.PUBLIC_URL,
  };
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("lets a Codespace's forwarded address through the host guard", () => {
    delete process.env.ALLOWED_HOSTS;
    delete process.env.PUBLIC_URL;
    expect(isHostAllowed(FORWARDED)).toBe(false);

    process.env.ALLOWED_HOSTS = container.containerEnv.ALLOWED_HOSTS;
    expect(isHostAllowed(FORWARDED)).toBe(true);
    expect(isHostAllowed("evil.example.com")).toBe(false);
  });

  it("allows the same address to Vite, and starts the server when it opens", () => {
    expect(container.containerEnv.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe(
      container.containerEnv.ALLOWED_HOSTS,
    );
    expect(Object.values(container.postAttachCommand)).toContain("npm run dev");
  });
});
