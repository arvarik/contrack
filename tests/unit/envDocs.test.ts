// =============================================================================
// Unit: the environment variables agree everywhere they are written down
// =============================================================================
// A variable lives in five places: the code that reads it, the table in
// docs/configuration.md, .env.example, docker-compose.yml, and RETIRED_ENV
// once it is retired. They drifted apart. AI_TIER stayed documented after the
// code stopped reading it. MAIL_REPLY_TO and the Google OAuth pair were read
// and never documented. Compose did not pass PUBLIC_URL, SMTP_URL or
// CONTRACK_SECRET_KEY, so a value in .env did nothing in Docker. This test
// reads all five and fails at the next disagreement.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { RETIRED_ENV } from "../../server/utils/retiredEnv.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/**
 * Documented, and deliberately not passed by compose. The reasons are in
 * docs/configuration.md under "Docker".
 */
const NOT_FORWARDED = [
  "HOST",
  "PORT",
  "DATA_DIR",
  "NODE_ENV",
  "DISABLE_BACKGROUND_JOBS",
  "DISABLE_CPU_WORKER",
  "TRANSFORMERS_CACHE",
  "AUTH_TOKEN",
];

function codeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return codeFiles(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const CODE = [
  ...codeFiles(path.join(ROOT, "server")),
  ...codeFiles(path.join(ROOT, "shared")),
  path.join(ROOT, "server.ts"),
  path.join(ROOT, "vite.config.ts"),
]
  .filter((f) => !f.endsWith(path.join("utils", "retiredEnv.ts")))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const NAME = "[A-Z][A-Z0-9_]+";

/** Every name the code reads from the environment by name. */
function namesReadDirectly(): Set<string> {
  const found = new Set<string>();
  const patterns = [
    new RegExp(`process\\.env\\.(${NAME})`, "g"),
    new RegExp(`process\\.env\\[\\s*["'](${NAME})["']\\s*\\]`, "g"),
    // mapConfig reads an `env` parameter that defaults to process.env.
    new RegExp(`(?<![.\\w])env\\.(${NAME})`, "g"),
  ];
  for (const pattern of patterns)
    for (const m of CODE.matchAll(pattern)) found.add(m[1]);
  return found;
}

/**
 * True when the code names the variable at all. This includes a lookup
 * table such as `envVar: "GEMINI_API_KEY"`, which is read through
 * `process.env[builtIn.envVar]`.
 */
function codeNames(name: string): boolean {
  return (
    namesReadDirectly().has(name) ||
    new RegExp(`["'\`]${name}["'\`]`).test(CODE)
  );
}

/** The two tables in docs/configuration.md's Environment Variables section. */
function documented(): { main: string[]; dev: string[]; section: string } {
  const doc = read("docs/configuration.md");
  const start = doc.indexOf("## Environment Variables");
  const end = doc.indexOf("\n## ", start + 1);
  const section = doc.slice(start, end);
  const [main, dev] = section.split("**Development and test switches.**");
  const rows = (table: string | undefined) =>
    [...(table ?? "").matchAll(new RegExp(`^\\| \`(${NAME})\``, "gm"))].map(
      (m) => m[1],
    );
  return { main: rows(main), dev: rows(dev), section };
}

/** Assigned or commented-out names in a dotenv file. */
function exampleNames(): string[] {
  return [
    ...read(".env.example").matchAll(new RegExp(`^#?\\s*(${NAME})=`, "gm")),
  ].map((m) => m[1]);
}

function composeNames(): string[] {
  return [
    ...read("docker-compose.yml").matchAll(
      new RegExp(`^\\s*- (${NAME})=`, "gm"),
    ),
  ].map((m) => m[1]);
}

describe("environment variables", () => {
  it("finds both tables in the docs", () => {
    const { main, dev } = documented();
    expect(main.length).toBeGreaterThan(20);
    expect(dev.length).toBeGreaterThan(0);
  });

  it("documents every variable the server reads", () => {
    const { main, dev } = documented();
    const known = new Set([...main, ...dev]);
    const undocumented = [...namesReadDirectly()].filter((n) => !known.has(n));
    expect(undocumented).toEqual([]);
  });

  it("documents no variable the code has stopped reading", () => {
    const { main, dev } = documented();
    expect([...main, ...dev].filter((n) => !codeNames(n))).toEqual([]);
  });

  it("puts only documented variables in .env.example", () => {
    const { main } = documented();
    expect(exampleNames().filter((n) => !main.includes(n))).toEqual([]);
  });

  // A provider is chosen by which key is present, so the example offers a
  // key for each. One key must be enough to run, so every per-task model is
  // offered commented out: a pin left in would break that promise for
  // anyone who copies the file as it is.
  it("offers a key for every built-in provider in .env.example", () => {
    for (const name of [
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
    ])
      expect(exampleNames()).toContain(name);
  });

  it("offers every per-task model in .env.example, commented out", () => {
    const example = read(".env.example");
    for (const name of [
      "AI_QUICK_MODEL",
      "AI_DEEP_MODEL",
      "AI_RESEARCH_MODEL",
      "AI_EMBEDDINGS_MODEL",
    ])
      expect(example).toMatch(new RegExp(`^# ${name}=`, "m"));
  });

  it("passes every documented variable to the container but eight", () => {
    const { main } = documented();
    for (const name of NOT_FORWARDED) expect(main).toContain(name);
    const expected = main.filter((n) => !NOT_FORWARDED.includes(n));
    expect([...composeNames()].sort()).toEqual([...expected].sort());
  });

  it("names each retired variable only where it says so", () => {
    const { main, dev, section } = documented();
    for (const name of Object.keys(RETIRED_ENV)) {
      expect(section).toContain(`\`${name}\``);
      expect([...main, ...dev]).not.toContain(name);
      expect(exampleNames()).not.toContain(name);
      expect(composeNames()).not.toContain(name);
      expect(codeNames(name)).toBe(false);
    }
  });
});
