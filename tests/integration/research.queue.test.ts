// Integration: an AI switch turned off while a research call waits in the
// AI work queue
// A model call can wait minutes for a slot in the shared queue. Research asks
// the switches before the call joins the queue, and again when it gets its
// slot, so a call that waited never reaches the provider once a switch says
// no, and the run ends with the switch's refusal. The real gateway runs here,
// with a scripted provider.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/ai/capabilities.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/capabilities.ts")>()),
  resolveCapability: vi.fn(),
}));
import { resolveCapability } from "../../server/ai/capabilities.ts";
import { generateFor, getAIQueueSnapshot } from "../../server/ai/gateway.ts";
import { setAiOffForInstance } from "../../server/ai/instanceSwitch.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { NO_MATCHING_PAGES } from "../../server/services/aiSearch/promptTemplate.ts";
import { research } from "../../server/services/research/index.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import type { AIProvider } from "../../server/ai/provider.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** The gate the calls that hold both shared slots wait at. */
let gate: Promise<void>;
/** Opens the gate. */
let open: () => void;
/** A call that holds a shared slot until the gate opens. */
const hold = () =>
  generateFor("quick", {
    prompt: "HOLD",
    responseFormat: "text",
    timeoutMs: 60_000,
  });

/** The prompts the provider received, other than the blocking ones. */
let sent: string[];
const provider: AIProvider = {
  name: "Scripted",
  generate: vi.fn(async (options) => {
    if (options.prompt === "HOLD") {
      await gate;
      return { text: "", model: "hold", latencyMs: 1 };
    }
    sent.push(options.prompt);
    // A no-match after a search, so the research model is asked twice more.
    return {
      text: NO_MATCHING_PAGES,
      model: "m-research",
      latencyMs: 1,
      searchQueries: ['"Rowan Vale"'],
    };
  }),
};

/** Fill both shared slots, and hand back the calls that hold them. */
async function holdSlots() {
  const holding = [hold(), hold()];
  await vi.waitFor(() => expect(getAIQueueSnapshot().active).toBe(2));
  return holding;
}

const researched = () =>
  research({
    scope: scope(),
    contact: enrichmentContact(scope(), id),
    depth: "standard",
    history: null,
    technique: "provider-search",
  });

let id: string;
beforeEach(async () => {
  sqlite.prepare("DELETE FROM contacts").run();
  sent = [];
  gate = new Promise((resolve) => (open = resolve));
  vi.mocked(resolveCapability).mockImplementation(
    (capability) =>
      ({
        capability,
        providerId: "scripted",
        model: `m-${capability}`,
        modelClass: "flash",
        provider,
      }) as never,
  );
  id = (
    await request(app)
      .post("/api/contacts")
      .send({ name: "Rowan Vale", company: "Northwind Partners" })
  ).body.id;
});
afterEach(() => {
  open();
  setAiOffForInstance(false);
  setPreferences(localOwnerId(), { aiAssist: true });
});

describe("a research call that waits in the AI work queue", () => {
  it("never reaches the provider once the account switch is off", async () => {
    const holding = await holdSlots();
    const run = researched();
    run.catch(() => {});
    await vi.waitFor(() => expect(getAIQueueSnapshot().waiting).toBe(1));
    setPreferences(localOwnerId(), { aiAssist: false });
    open();
    await Promise.all(holding);
    await expect(run).rejects.toMatchObject({ code: "AI_OFF_FOR_ACCOUNT" });
    expect(sent).toEqual([]);
  });

  it("ends the run with the instance switch's refusal, not a finding of no public information", async () => {
    // The first ask runs and answers without a search. The ask after it
    // waits behind calls that take both slots while it runs.
    const holding: Array<Promise<unknown>> = [];
    vi.mocked(provider.generate).mockImplementationOnce(async () => {
      holding.push(hold(), hold());
      return {
        text: NO_MATCHING_PAGES,
        model: "m-research",
        latencyMs: 1,
      };
    });
    const run = researched();
    run.catch(() => {});
    await vi.waitFor(() => expect(getAIQueueSnapshot().waiting).toBe(1));
    setAiOffForInstance(true);
    open();
    await Promise.all(holding);
    await expect(run).rejects.toMatchObject({ code: "AI_OFF_FOR_INSTANCE" });
  });
});
