// =============================================================================
// Unit: how the dossier's Research card words a research record
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  fieldLabel,
  modelName,
  runSummary,
  sourceDisplay,
} from "../../src/lib/research";
import type { ResearchRun } from "../../shared/researchRecord";

describe("modelName", () => {
  it.each([
    ["gemini-3.8-flash", "Gemini 3.8 Flash"],
    ["gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
    ["claude-sonnet-5", "Claude Sonnet 5"],
    ["claude-3-5-sonnet-20240620", "Claude 3.5 Sonnet"],
    ["gpt-6-sol", "GPT-6 Sol"],
    ["gpt-5.4-mini", "GPT-5.4 Mini"],
  ])("reads %s as %s", (id, name) => {
    expect(modelName(id)).toBe(name);
  });
});

const run = (fields: Partial<ResearchRun>): ResearchRun => ({
  at: "2026-09-26T22:00:00.000Z",
  models: ["gemini-3.8-flash"],
  outcome: "added",
  added: [],
  sourceCount: 0,
  queries: [],
  findings: [],
  ...fields,
});

describe("runSummary", () => {
  it("counts what a run added, field by field", () => {
    expect(
      runSummary(
        run({
          sourceCount: 9,
          added: [
            { field: "experience", count: 4 },
            { field: "education", count: 2 },
            { field: "location", count: 1 },
          ],
        }),
      ),
    ).toBe("Added 7 from 9 pages: Roles ×4, Education ×2, Location");
  });

  it("says when a run found nothing new, or nobody", () => {
    expect(runSummary(run({ outcome: "nothing-new", sourceCount: 1 }))).toBe(
      "Read 1 page, nothing new",
    );
    expect(runSummary(run({ outcome: "no-public-info" }))).toBe(
      "No web page about this person",
    );
  });

  it("says only that a run happened, when it was before runs were recorded", () => {
    expect(runSummary(run({ models: [] }))).toBe(
      "Enriched before details were recorded",
    );
  });

  it("names fields as the dossier does", () => {
    expect(fieldLabel("socialLinks")).toBe("Profiles");
    expect(fieldLabel("attributes")).toBe("Facts");
    expect(fieldLabel("unknown")).toBe("unknown");
  });
});

describe("sourceDisplay", () => {
  it("shows a page Gemini names only by its domain as its address", () => {
    expect(
      sourceDisplay({
        url: "https://files.brokercheck.finra.org/individual/individual_1234567.pdf",
        title: "finra.org",
        firstSeenAt: "",
      }),
    ).toEqual({
      title: "files.brokercheck.finra.org › individual › individual_1234567",
      site: "files.brokercheck.finra.org",
      trail: "files.brokercheck.finra.org › individual › individual_1234567",
    });
  });

  it("keeps a real page title, and puts the address under it", () => {
    expect(
      sourceDisplay({
        url: "https://fellows.example.org/people/rowan-vale",
        title: "Rowan Vale — Fellows Program",
        firstSeenAt: "",
      }),
    ).toEqual({
      title: "Rowan Vale — Fellows Program",
      site: "fellows.example.org",
      trail: "fellows.example.org › people › rowan-vale",
    });
  });
});
