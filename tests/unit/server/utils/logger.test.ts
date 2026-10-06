// Unit: the server log's level, its details and its colors
// DEBUG lines printed in production: one import wrote 12,000 of them. An
// Error in the details printed as {}, so a failed connector lost its cause.
// And `docker logs` held ANSI color codes.

import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../../../../server/utils/logger.ts";

/** The lines the logger prints while `write` runs. */
function printed(write: () => void): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    lines.push(line);
  });
  write();
  vi.restoreAllMocks();
  return lines;
}

const levels = (lines: string[]) =>
  lines.map((line) => /\] \[(\w+)\] \[/.exec(line)?.[1]).join(" ");

const eachLevel = () => {
  log.debug("Test", "d");
  log.info("Test", "i");
  log.warn("Test", "w");
  log.error("Test", "e");
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("log", () => {
  it.each([
    [undefined, "INFO WARN ERROR"],
    ["", "INFO WARN ERROR"],
    ["error", "ERROR"],
    ["warn", "WARN ERROR"],
    [" DEBUG ", "DEBUG INFO WARN ERROR"],
  ])("LOG_LEVEL=%j writes %s", (value, written) => {
    vi.stubEnv("LOG_LEVEL", value);
    expect(levels(printed(eachLevel))).toBe(written);
  });

  it("warns once about a bad LOG_LEVEL and runs at info", () => {
    vi.stubEnv("LOG_LEVEL", "verbose");
    const lines = printed(() => {
      eachLevel();
      eachLevel();
    });
    expect(lines[0]).toMatch(/\[WARN\] \[Config\] LOG_LEVEL .*"verbose"/);
    expect(levels(lines.slice(1))).toBe("INFO WARN ERROR INFO WARN ERROR");
  });

  it("writes an Error in the details as its name, message and stack", () => {
    const error = new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED"),
    });
    const [line] = printed(() => log.error("Test", "Sync failed", { error }));
    const details = JSON.parse(line.slice(line.indexOf("{")));
    expect(details.error).toMatchObject({
      name: "TypeError",
      message: "fetch failed",
      cause: { name: "Error", message: "connect ECONNREFUSED" },
    });
    expect(details.error.stack).toContain("logger.test.ts");
  });

  it("colors a line only when stdout is a terminal", () => {
    const own = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    try {
      for (const isTTY of [true, false]) {
        Object.defineProperty(process.stdout, "isTTY", {
          value: isTTY,
          configurable: true,
        });
        const [line] = printed(() => log.warn("Test", "w"));
        expect(line.includes("\x1b[")).toBe(isTTY);
      }
    } finally {
      if (own) Object.defineProperty(process.stdout, "isTTY", own);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  });
});
