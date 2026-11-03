// zodConfig.ts turns on zod's jitless mode without importing zod, through
// the global zod keeps its settings in. If zod stops reading that global,
// the CSP report on every page load comes back, so this fails first.
import { expect, it } from "vitest";
import "../../../../src/lib/zodConfig";
import { config } from "zod";

it("turns on zod's jitless mode before zod loads", () => {
  expect(config().jitless).toBe(true);
});
