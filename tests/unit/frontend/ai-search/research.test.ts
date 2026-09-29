// =============================================================================
// Unit: how the dossier's Research card words a research record
// =============================================================================

import { describe, it, expect } from "vitest";
import {
  listInWords,
  missingAnchors,
  modelName,
  researchedWith,
  runSummary,
  sourceDisplay,
} from "../../../../src/lib/research";
import type { ResearchRun } from "../../../../shared/researchRecord";

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
  it("counts what a run added, field by field, in the dossier's names", () => {
    expect(
      runSummary(
        run({
          sourceCount: 9,
          added: [
            { field: "experience", count: 4 },
            { field: "education", count: 2 },
            { field: "location", count: 1 },
            { field: "socialLinks", count: 2 },
            { field: "attributes", count: 1 },
            // A field the dossier has no name for keeps its own.
            { field: "unknown", count: 1 },
          ],
        }),
      ),
    ).toBe(
      "Added 11 from 9 pages: Roles ×4, Education ×2, Location, Profiles ×2, Facts, unknown",
    );
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

describe("what research searched with, and what would help it", () => {
  const person = (fields: Record<string, unknown> = {}) =>
    ({
      company: "Northwind Partners",
      role: "Associate",
      location: null,
      addresses: [],
      emails: [],
      socialLinks: [
        { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
      ],
      education: [],
      ...fields,
    }) as unknown as Parameters<typeof researchedWith>[0];

  it("names the kinds of detail research had, and a profile by its platform", () => {
    expect(listInWords(researchedWith(person()))).toBe(
      "company, role and LinkedIn profile",
    );
    expect(
      researchedWith(
        person({
          emails: [
            { email: "rowan@gmail.com" },
            { email: "rv@northwind.example" },
          ],
          socialLinks: [],
          addresses: [{ address: "San Francisco, CA", isPrimary: true }],
          experience: [
            { company: "Northwind Partners", isCurrent: true },
            { company: "Acme Bank", isCurrent: false },
          ],
          education: [{ school: "University of Example" }],
        }),
      ),
    ).toEqual(["company", "role", "city", "past jobs", "school", "work email"]);
    // A free mailbox is a personal email. Links on no named platform, or
    // more than one, are counted.
    expect(
      researchedWith(
        person({
          company: null,
          role: null,
          emails: [{ email: "rowan@gmail.com" }],
          socialLinks: [{ platform: "website", url: "https://rowan.example" }],
        }),
      ),
    ).toEqual(["personal email", "link"]);
    expect(
      researchedWith(
        person({
          company: null,
          role: null,
          socialLinks: [
            { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
            { platform: "github", url: "https://github.com/rowanv" },
          ],
        }),
      ),
    ).toEqual(["2 links"]);
    expect(
      researchedWith(person({ company: null, role: null, socialLinks: [] })),
    ).toEqual([]);
  });

  it("asks for a city, a work email and a link of their own, when the records lack them", () => {
    expect(missingAnchors(person())).toEqual(["city", "workEmail", "link"]);
    // A street address is not read as a city, and a free mailbox is not a
    // work email. A LinkedIn profile is not a link research can read.
    expect(
      missingAnchors(
        person({
          addresses: [
            { address: "12 Harbor Street, Springfield", isPrimary: true },
          ],
          emails: [{ email: "rowan@gmail.com" }],
        }),
      ),
    ).toEqual(["city", "workEmail", "link"]);
    // A city added after the street counts, as research reads it.
    expect(
      missingAnchors(
        person({
          addresses: [
            { address: "12 Harbor Street, Springfield", isPrimary: true },
            { address: "Austin, TX", isPrimary: false },
          ],
        }),
      ),
    ).toEqual(["workEmail", "link"]);
    expect(
      missingAnchors(
        person({
          location: "New York, NY",
          emails: [{ email: "rv@northwind.example" }],
          socialLinks: [
            { platform: "github", url: "https://github.com/rowanv" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("joins a list the way a sentence does", () => {
    expect(listInWords([])).toBe("");
    expect(listInWords(["a city"])).toBe("a city");
    expect(listInWords(["a", "b", "c"])).toBe("a, b and c");
  });
});
