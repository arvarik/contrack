import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/ai/gateway.ts", () => ({
  generateFor: vi.fn(),
  isAnyProviderConfigured: () => true,
}));
import { generateFor } from "../../server/ai/gateway.ts";
import {
  rerankCandidates,
  parseSearchQuery,
} from "../../server/ai/services/searchIntel.ts";
import type { AIGenerateResult, QueryPlan } from "../../server/ai/types.ts";
const contact = {
  id: "a",
  name: "Alice",
  role: "Engineer",
  location: "Paris",
  industry: "Software",
};
const match = {
  contact_id: "a",
  verified_field: "role",
  verified_value: "Engineer",
  reason: "Alice is an engineer.",
};
beforeEach(() => vi.mocked(generateFor).mockReset());
const reply = (value: unknown) =>
  vi.mocked(generateFor).mockResolvedValue({
    text: JSON.stringify(value),
    latencyMs: 1,
    model: "mock",
  } as AIGenerateResult);
describe("AI search evidence", () => {
  it.each([
    {},
    [null],
    [{ contact_id: "a", reason: 1 }],
    [{ ...match, verified_field: "constructor" }],
  ])("rejects invalid output shape %j", async (value) => {
    reply(value);
    await expect(rerankCandidates("engineers", [contact])).rejects.toThrow(
      "invalid search evidence",
    );
  });
  it("checks missing company and mismatched industry even when other evidence is valid", async () => {
    reply([match]);
    const plan: QueryPlan = {
      must: { companyMatchers: ["Acme"] },
      should: {},
      confidence: "high",
      rationale: "",
    };
    expect(await rerankCandidates("Acme engineers", [contact], plan)).toEqual(
      [],
    );
    plan.must = { industryMatchers: ["Finance"] };
    expect(
      await rerankCandidates("finance engineers", [contact], plan),
    ).toEqual([]);
  });
  it("removes duplicate and invented IDs", async () => {
    reply([match, match, { ...match, contact_id: "invented" }]);
    expect(await rerankCandidates("engineers", [contact])).toEqual([
      { contact_id: "a", reason: match.reason },
    ]);
  });
  it("does not start a generation for an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      rerankCandidates("engineers", [contact], null, controller.signal),
    ).rejects.toThrow();
    expect(generateFor).not.toHaveBeenCalled();
  });
  it.each([
    [],
    { must: [], should: {}, confidence: "high", rationale: "" },
    {
      must: { temporal: { type: "lastContact", daysAgo: -1 } },
      should: {},
      confidence: "high",
      rationale: "",
    },
  ])("rejects an invalid query plan %j", async (value) => {
    reply(value);
    expect(await parseSearchQuery("invalid plan shape")).toBeNull();
  });
});
