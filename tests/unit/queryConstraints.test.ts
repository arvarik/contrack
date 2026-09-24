import { describe, expect, it } from "vitest";
import {
  compileQueryPlan,
  roleVariants,
} from "../../server/ai/queryConstraints.ts";
import type { QueryPlan } from "../../server/ai/types.ts";

function plan(must: QueryPlan["must"] = {}): QueryPlan {
  return { must, should: {}, confidence: "high", rationale: "Model output" };
}

describe("query constraint compilation", () => {
  it("removes invented recency and anchors the requested role", () => {
    const raw = plan({
      roleMatchers: ["Engineer", "Architect"],
      temporal: { type: "lastContact", daysAgo: 180 },
    });
    const result = compileQueryPlan("Software engineers in London", raw);
    expect(result.must.temporal).toBeUndefined();
    expect(result.must.roleMatchers).toEqual([
      "Software Engineer",
      "Software Developer",
      "SWE",
    ]);
    expect(result.evidence?.role).toBe("Software engineers");
    expect(raw.must.temporal).toEqual({ type: "lastContact", daysAgo: 180 });
  });

  it("ignores fabricated evidence and unrelated matchers", () => {
    const raw = {
      ...plan({
        companyMatchers: ["Stripe"],
        roleMatchers: ["CEO"],
        industryMatchers: ["Finance"],
      }),
      evidence: { company: "Find Sarah" },
    };
    expect(compileQueryPlan("Find Sarah", raw).must).toEqual({});
  });

  it("restores explicit locations from misplaced traits", () => {
    const raw = { ...plan(), should: { traits: ["London", "bouldering"] } };
    const result = compileQueryPlan(
      "People in London who enjoy bouldering",
      raw,
    );
    expect(result.must.locations?.[0].city).toBe("london");
    expect(result.should.traits).toEqual(["bouldering"]);
  });

  it("does not turn place evidence into company, industry, or role filters", () => {
    const result = compileQueryPlan(
      "People in London",
      plan({
        companyMatchers: ["London"],
        industryMatchers: ["London"],
        roleMatchers: ["London"],
      }),
    );
    expect(result.must.companyMatchers).toBeUndefined();
    expect(result.must.industryMatchers).toBeUndefined();
    expect(result.must.roleMatchers).toBeUndefined();
  });

  it("includes research fellows without including unrelated occupations", () => {
    const result = compileQueryPlan(
      "Researchers in Cambridge, Massachusetts",
      plan({ roleMatchers: ["Researcher", "Engineer"] }),
    );
    expect(result.must.roleMatchers).toContain("Research Fellow");
    expect(result.must.roleMatchers).not.toContain("Engineer");
  });

  it("includes venture scouts for investors but not for partners", () => {
    expect(
      compileQueryPlan("Investors at Sequoia", plan()).must.roleMatchers,
    ).toContain("Venture Scout");
    expect(
      compileQueryPlan("Partners at Sequoia", plan()).must.roleMatchers,
    ).not.toContain("Venture Scout");
  });

  it("does not equate founders with hired CEOs", () => {
    expect(
      compileQueryPlan(
        "Climate founders in Berlin",
        plan({ roleMatchers: ["CEO"] }),
      ).must.roleMatchers,
    ).not.toContain("CEO");
  });

  it("keeps seniority when the query requests a specific role", () => {
    expect(
      compileQueryPlan(
        "Senior software engineers",
        plan({ roleMatchers: ["Senior Software Engineer"] }),
      ).must.roleMatchers,
    ).toEqual([
      "Senior Software Engineer",
      "Senior Software Developer",
      "Senior SWE",
    ]);
  });

  it.each([
    "Former employees at Stripe",
    "People who used to work at Stripe",
    "People not at Stripe",
    "Ex-Stripe employees",
  ])("does not impose current employment for %s", (query) => {
    expect(
      compileQueryPlan(query, plan({ companyMatchers: ["Stripe"] })).must
        .companyMatchers,
    ).toBeUndefined();
  });

  it("keeps a positive employer restriction", () => {
    expect(
      compileQueryPlan(
        "Product managers at Stripe",
        plan({
          companyMatchers: ["Stripe", "Meta"],
          roleMatchers: ["Product Manager"],
        }),
      ).must.companyMatchers,
    ).toEqual(["Stripe"]);
  });

  it("derives older-than recency from the query instead of the model", () => {
    const result = compileQueryPlan(
      "People I haven't talked to in 6 months",
      plan({ temporal: { type: "lastContact", daysAgo: 30 } }),
    );
    expect(result.must.temporal).toEqual({ type: "lastContact", daysAgo: 180 });
    expect(result.evidence?.temporal).toContain("6 months");
  });

  it("does not invert a recent contact request", () => {
    expect(
      compileQueryPlan(
        "People contacted in the last 7 days",
        plan({ temporal: { type: "lastContact", daysAgo: 7 } }),
      ).must.temporal,
    ).toBeUndefined();
  });

  it("keeps both requested role families", () => {
    const result = compileQueryPlan(
      "Founders or researchers in London",
      plan(),
    );
    expect(result.must.roleMatchers).toContain("Founder");
    expect(result.must.roleMatchers).toContain("Research Fellow");
  });

  it("requires leadership instead of accepting every engineer", () => {
    const result = compileQueryPlan("Fintech leaders in London", plan());
    expect(result.must.roleMatchers).toContain("Staff Software Engineer");
    expect(result.must.roleMatchers).not.toContain("Engineer");
    expect(result.must.roleMatchers).not.toContain("Staff");
  });

  it("does not extract roles or industries from an employer name", () => {
    const result = compileQueryPlan(
      "People at Climate Founders",
      plan({ companyMatchers: ["Climate Founders"] }),
    );
    expect(result.must.companyMatchers).toEqual(["Climate Founders"]);
    expect(result.must.roleMatchers).toBeUndefined();
    expect(result.must.industryMatchers).toBeUndefined();
  });

  it("does not infer an industry from a role", () => {
    const result = compileQueryPlan(
      "Software engineers",
      plan({ industryMatchers: ["Software"] }),
    );
    expect(result.must.industryMatchers).toBeUndefined();
  });

  it.each([
    "People interested in fintech",
    "People who invest in climate startups",
    "People in London interested in biotech",
  ])("does not turn interests into current industry for %s", (query) => {
    expect(
      compileQueryPlan(
        query,
        plan({ industryMatchers: ["Fintech", "Climate", "Biotech"] }),
      ).must.industryMatchers,
    ).toBeUndefined();
  });

  it("does not turn unparsed employer words into a role or industry", () => {
    expect(
      compileQueryPlan("Software engineers at Researcher Labs", plan()).must
        .roleMatchers,
    ).not.toContain("Researcher");
    expect(
      compileQueryPlan("Partners at Climate Ventures", plan()).must
        .industryMatchers,
    ).toBeUndefined();
  });

  it("keeps an explicit role alternative outside the reviewed dictionary", () => {
    const result = compileQueryPlan(
      "Software engineers or designers",
      plan({ roleMatchers: ["Software Engineer", "Engineer", "Designer"] }),
    );
    expect(result.must.roleMatchers).toContain("Designer");
    expect(result.must.roleMatchers).toContain("Software Engineer");
    expect(result.must.roleMatchers).not.toContain("Engineer");
  });

  it("keeps explicit role qualifications when adding another role alternative", () => {
    const result = compileQueryPlan(
      "Senior software engineers or designers",
      plan({
        roleMatchers: [
          "Software Engineer",
          "Engineer",
          "Senior Software Engineer",
          "Designer",
        ],
      }),
    );
    expect(result.must.roleMatchers).toContain("Senior Software Engineer");
    expect(result.must.roleMatchers).toContain("Designer");
    expect(result.must.roleMatchers).not.toContain("Software Engineer");
    expect(result.must.roleMatchers).not.toContain("Engineer");
  });

  it("keeps a work clause after an interest clause", () => {
    const result = compileQueryPlan(
      "People who love climate and work as software engineers",
      plan({
        industryMatchers: ["Climate"],
        roleMatchers: ["Software Engineer"],
      }),
    );
    expect(result.must.roleMatchers).toContain("Software Engineer");
    expect(result.must.industryMatchers).toBeUndefined();
  });

  it("does not derive a city from an explicit employer name", () => {
    const result = compileQueryPlan(
      "Who works at London Capital?",
      plan({
        companyMatchers: ["London Capital"],
        locationMatchers: ["London"],
      }),
    );
    expect(result.must.companyMatchers).toEqual(["London Capital"]);
    expect(result.must.locations).toBeUndefined();
    expect(result.must.locationMatchers).toBeUndefined();
  });

  it("preserves a separate location after an employer with a city name", () => {
    const result = compileQueryPlan(
      "Who works at London Capital in Toronto?",
      plan({
        companyMatchers: ["London Capital"],
        locationMatchers: ["London", "Toronto"],
      }),
    );
    expect(result.must.companyMatchers).toEqual(["London Capital"]);
    expect(result.must.locations).toEqual([
      expect.objectContaining({ city: "toronto", sourcePhrase: "Toronto" }),
    ]);
    expect(result.evidence?.location).toBe("Toronto");
  });

  it("preserves geography when the model also puts it in the company field", () => {
    const result = compileQueryPlan(
      "Who lives in California?",
      plan({
        companyMatchers: ["California"],
        locationMatchers: ["California"],
      }),
    );
    expect(result.must.locations).toEqual([
      expect.objectContaining({ region: "california" }),
    ]);
    expect(result.must.companyMatchers).toBeUndefined();
  });

  it("does not derive a state from an employer name", () => {
    const result = compileQueryPlan(
      "People employed by California Design",
      plan({
        companyMatchers: ["California Design"],
        locationMatchers: ["California"],
      }),
    );
    expect(result.must.companyMatchers).toEqual(["California Design"]);
    expect(result.must.locations).toBeUndefined();
  });

  it("derives written-number recency from the original query", () => {
    expect(
      compileQueryPlan(
        "People I haven't contacted in six months",
        plan({ temporal: { type: "lastContact", daysAgo: 10 } }),
      ).must.temporal,
    ).toEqual({ type: "lastContact", daysAgo: 180 });
  });

  it("converts written-number weeks and years", () => {
    expect(
      compileQueryPlan("People I have not contacted for two weeks", plan()).must
        .temporal,
    ).toEqual({ type: "lastContact", daysAgo: 14 });
    expect(
      compileQueryPlan("People I haven't seen in one year", plan()).must
        .temporal,
    ).toEqual({ type: "lastContact", daysAgo: 365 });
  });

  it("does not invert a recent written-number request", () => {
    expect(
      compileQueryPlan(
        "People contacted in the last six months",
        plan({ temporal: { type: "lastContact", daysAgo: 180 } }),
      ).must.temporal,
    ).toBeUndefined();
  });

  it("preserves a specific raw role without its nested broader matcher", () => {
    const result = compileQueryPlan(
      "Mechanical engineers",
      plan({ roleMatchers: ["Engineer", "Mechanical Engineer"] }),
    );
    expect(result.must.roleMatchers).toEqual(["Mechanical Engineer"]);
  });

  it("retains a separately requested broader role alternative", () => {
    const result = compileQueryPlan(
      "Mechanical engineers or engineers",
      plan({ roleMatchers: ["Engineer", "Mechanical Engineer"] }),
    );
    expect(result.must.roleMatchers).toEqual([
      "Mechanical Engineer",
      "Engineer",
    ]);
  });

  it("maps working in accounting to accountant roles", () => {
    const result = compileQueryPlan(
      "Who works in accounting?",
      plan({ roleMatchers: ["accounting"] }),
    );
    expect(result.must.roleMatchers).toEqual(["Accountant", "Accounting"]);
    expect(result.must.roleMatchers).not.toContain("Finance");
    expect(result.must.roleMatchers).not.toContain("Analyst");
  });

  it("keeps an accounting employer from implying an accountant role", () => {
    const result = compileQueryPlan(
      "Who works at Apex Global Accounting?",
      plan({ companyMatchers: ["Apex Global Accounting"] }),
    );
    expect(result.must.roleMatchers).toBeUndefined();
  });

  it("does not treat accounting industry founders as accountants", () => {
    const result = compileQueryPlan(
      "Accounting founders",
      plan({ industryMatchers: ["Accounting"] }),
    );
    expect(result.must.roleMatchers).toContain("Founder");
    expect(result.must.roleMatchers).not.toContain("Accountant");
    expect(result.must.industryMatchers).toEqual(["Accounting"]);
  });

  it.each(["Maritime", "contacts"])(
    "rejects the non-role matcher %s from an industry query",
    (role) => {
      const result = compileQueryPlan(
        "Maritime contacts in Portland, Maine",
        plan({
          roleMatchers: [role],
          industryMatchers: ["Maritime"],
          locationMatchers: ["Portland", "Maine"],
        }),
      );
      expect(result.must.roleMatchers).toBeUndefined();
      expect(result.must.industryMatchers).toEqual(["Maritime"]);
    },
  );

  it("preserves an explicit role qualified by an industry", () => {
    const result = compileQueryPlan(
      "Maritime engineers",
      plan({ roleMatchers: ["Maritime Engineer", "Maritime"] }),
    );
    expect(result.must.roleMatchers).toEqual(["Maritime Engineer"]);
  });

  it("preserves the complete employer name without a nested broad alias", () => {
    const result = compileQueryPlan(
      "People at Acme Labs",
      plan({ companyMatchers: ["Acme", "Acme Labs"] }),
    );
    expect(result.must.companyMatchers).toEqual(["Acme Labs"]);
  });

  it("preserves a separately requested employer alternative", () => {
    const result = compileQueryPlan(
      "People at Acme Labs or Acme",
      plan({ companyMatchers: ["Acme", "Acme Labs"] }),
    );
    expect(result.must.companyMatchers).toEqual(["Acme Labs", "Acme"]);
  });

  it("grounds never-contacted intent", () => {
    expect(
      compileQueryPlan("People I have never contacted", plan()).must.temporal,
    ).toEqual({ type: "neverContacted" });
  });
});

describe("role variants", () => {
  it("finds a field from a person and a person from a field", () => {
    expect(roleVariants("Engineer")).toContain("engineering");
    expect(roleVariants("Engineering")).toContain("engineer");
    expect(roleVariants("Designers")).toEqual(
      expect.arrayContaining(["designer", "design"]),
    );
    expect(roleVariants("Design")).toContain("designer");
    expect(roleVariants("Marketing")).toContain("marketer");
    expect(roleVariants("Consultant")).toContain("consulting");
  });

  it("keeps the first words of a phrase, so a qualifier still narrows", () => {
    const forms = roleVariants("Software Engineer");
    expect(forms).toContain("software engineering");
    expect(forms.every((form) => form.startsWith("software "))).toBe(true);
  });

  it("leaves an acronym and a short word with their plural alone", () => {
    expect(roleVariants("CEO")).toEqual(["ceo", "ceos"]);
    expect(roleVariants("GP")).toEqual(["gp", "gps"]);
  });

  it("never offers a field's bare stem", () => {
    expect(roleVariants("Accounting")).not.toContain("account");
    expect(roleVariants("Accounting")).toContain("accountant");
  });
});
