// =============================================================================
// Unit: contact research — prompts, parsers and the research record
// =============================================================================
// The two passes of contact research, and what their answers are read into:
//
//   buildSearchPrompt      a first round, and a second that knows the first
//   searchName             the name a search quotes, and its other forms
//   parseFindings          "- Topic: fact [site]" lines
//   mergeFindings          the fact lines of several asks, each fact once
//   parseExtraction        the schema, one field and one entry at a time
//   tidyExtraction         the job rules a model follows only sometimes
//   normalize              one school, degree, employer or label, however
//                          a page writes it
//   researchDate           dates as the dossier stores them
//   linkedInHandle         the profile a LinkedIn address names
//   resolveRedirects       Gemini's redirect links, as the pages they name
//   shared/researchRecord  the record the dossier's Research card reads
// =============================================================================

import { afterEach, describe, it, expect, vi } from "vitest";
import type { HydratedContact } from "../../../../server/repositories/types.ts";
import {
  attachSources,
  buildExtractionPrompt,
  buildSearchPrompt,
  buildShortSearchPrompt,
  clipList,
  formalName,
  isPlaceholderEmployer,
  mergeFindings,
  missingTopics,
  nameFromHandle,
  nameWithoutMiddleInitial,
  NO_MATCHING_PAGES,
  otherNameForms,
  parseExtraction,
  parseFindings,
  searchName,
  suggestedSearches,
  tidyExtraction,
} from "../../../../server/services/aiSearch/promptTemplate.ts";
import {
  degreeLevel,
  linkedInHandle,
  orgKey,
  researchDate,
  sameLabel,
  sameOrg,
} from "../../../../server/services/aiSearch/normalize.ts";
import { resolveRedirects } from "../../../../server/ai/citations.ts";
import {
  parseResearchRecord,
  sourceForSite,
  type ResearchRecord,
} from "../../../../shared/researchRecord.ts";

/** A contact as the records hold it, with only what a test names. */
function contact(fields: Partial<HydratedContact> = {}): HydratedContact {
  return {
    id: "c1",
    name: "Rowan Vale",
    company: "Northwind Partners",
    role: "Associate, Restructuring Group",
    emails: [],
    phones: [],
    socialLinks: [],
    experience: [],
    education: [],
    interests: [],
    tags: [],
    attributes: [],
    addresses: [],
    ...fields,
  } as unknown as HydratedContact;
}

/** A record with one earlier run that read two sites. */
const EARLIER: ResearchRecord = {
  version: 1,
  runs: [
    {
      at: "2026-09-26T22:00:00.000Z",
      models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
      outcome: "added",
      added: [{ field: "experience", count: 4 }],
      sourceCount: 2,
      queries: [],
      findings: [],
    },
  ],
  sources: [
    {
      url: "https://brokercheck.finra.org/individual/summary/1234567",
      title: "finra.org",
      firstSeenAt: "2026-09-26T22:00:00.000Z",
    },
    {
      url: "http://fellows.example.org/people/rowan-vale",
      title: "fellows.example.org",
      firstSeenAt: "2026-09-26T22:00:00.000Z",
    },
  ],
};

describe("the search prompt", () => {
  it("asks for fact lines with their sites, and names the reply for nobody found", () => {
    const prompt = buildSearchPrompt(contact());
    expect(prompt).toContain("- <Topic>: <fact> [<site>]");
    expect(prompt).toContain(`reply with exactly: ${NO_MATCHING_PAGES}`);
    // No field list to fill with nulls: that is what a model answered with
    // when it ran no search.
    expect(prompt).not.toMatch(/\*\*emails\*\*|return null/i);
    expect(prompt).not.toContain("research round");
  });

  it("starts from the records' details, the most specific search first", () => {
    const searches = suggestedSearches(
      contact({
        socialLinks: [
          { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
        ] as HydratedContact["socialLinks"],
      }),
    );
    expect(searches[0]).toBe('"Rowan Vale" Northwind Partners');
    expect(searches).toContain('"rowanv"');
  });

  it("keeps a stale page's current job out of the present", () => {
    expect(buildSearchPrompt(contact())).toContain(
      "When a page names a current employer other than Northwind Partners, report that job as a Past role.",
    );
    expect(buildSearchPrompt(contact({ company: null }))).not.toContain(
      "current employer other than",
    );
  });

  it("leaves no topic out, and keeps every email and phone a page lists", () => {
    for (const prompt of [
      buildSearchPrompt(contact()),
      buildShortSearchPrompt(contact()),
      buildExtractionPrompt(contact(), "- Award: Fellow [example.org]"),
    ]) {
      expect(prompt).not.toMatch(/leave out (?!any topic you found nothing)/i);
      expect(prompt).not.toMatch(
        /relatives|health|religion|politics|sexuality|home purchases/i,
      );
    }
    expect(buildSearchPrompt(contact())).toContain(
      "Report every email address and phone number that a page about them lists.",
    );
    expect(buildSearchPrompt(contact())).not.toContain(
      "published it for contact",
    );
    // An address, home or office, is research's to report when a page states it.
    expect(buildSearchPrompt(contact())).toContain(
      "- Address: a home or office street address a page states",
    );
    expect(buildShortSearchPrompt(contact())).toMatch(/Topics: .*\bAddress\b/);
    expect(
      buildExtractionPrompt(contact(), "- Address: 1 Main St [example.org]"),
    ).toContain("each home or office address an Address fact states");
  });

  it("sends a second round elsewhere: what is known, what was read, what is missing", () => {
    const prompt = buildSearchPrompt(contact(), EARLIER);
    expect(prompt).toContain("## This is research round 2");
    expect(prompt).toContain("brokercheck.finra.org, fellows.example.org");
    expect(prompt).toContain("especially past roles, education");
  });

  it("names what the records have nothing on", () => {
    expect(missingTopics(contact())).toEqual([
      "past roles",
      "education",
      "location",
      "public profiles",
      "a professional summary",
      "awards, publications, talks or licences",
      "interests",
    ]);
    expect(
      missingTopics(
        contact({
          location: "New York, NY",
          about: "Banker",
          education: [
            { school: "University of Example" },
          ] as HydratedContact["education"],
        }),
      ),
    ).not.toContain("education");
  });
});

describe("what the prompt knows about the person", () => {
  const imported = contact({
    socialLinks: [
      { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
    ] as HydratedContact["socialLinks"],
    sources: [
      {
        id: "s1",
        platform: "linkedin",
        externalId: "https://www.linkedin.com/in/rowanv",
        connectedOn: "14 Oct 2013",
        importedAt: "2026-09-24 20:39:22",
      },
    ],
  });

  it("says where the records came from, and when", () => {
    expect(buildSearchPrompt(imported)).toContain(
      "Where these records came from:\n  - the user's LinkedIn connections, imported 2026-09-24, connected since 14 Oct 2013",
    );
  });

  it("says a page that links to the person's own profile is about them", () => {
    expect(buildSearchPrompt(imported)).toContain(
      "The profile addresses in the records are this person's own. A page that links to one of them is about them.",
    );
    expect(buildSearchPrompt(contact())).not.toContain(
      "profile addresses in the records",
    );
    // The short form names the profile too.
    expect(buildShortSearchPrompt(imported)).toContain(
      "https://www.linkedin.com/in/rowanv",
    );
  });

  it("reads a city from the addresses for its place, and sends a street as an Address", () => {
    const at = (address: string) =>
      contact({
        addresses: [
          { id: "a1", address, label: "home", isPrimary: true, source: null },
        ] as HydratedContact["addresses"],
      });
    expect(buildSearchPrompt(at("San Francisco, CA"))).toContain(
      "Location: San Francisco, CA",
    );
    expect(suggestedSearches(at("San Francisco, CA"))).toContain(
      '"Rowan Vale" San Francisco, CA',
    );
    // A house number or a postcode: a street. It is a known fact, never the
    // place: a web search with a street in it finds almost nothing.
    for (const street of [
      "12 Harbor Street, Springfield",
      "Springfield 02110",
    ]) {
      expect(buildSearchPrompt(at(street))).toContain(`Address: ${street}`);
      expect(buildSearchPrompt(at(street))).not.toContain(
        `Location: ${street}`,
      );
      expect(suggestedSearches(at(street)).join("\n")).not.toContain(street);
    }
    expect(missingTopics(at("12 Harbor Street, Springfield"))).toContain(
      "location",
    );
    // A city added after a street address: the Research card's Add a city
    // appends it, and the city is the place.
    const both = contact({
      addresses: [
        ...at("12 Harbor Street, Springfield").addresses,
        {
          id: "a2",
          address: "Austin, TX",
          label: "work",
          isPrimary: false,
          source: null,
        },
      ] as HydratedContact["addresses"],
    });
    expect(buildSearchPrompt(both)).toContain("Location: Austin, TX");
    expect(suggestedSearches(both).join("\n")).not.toContain("Harbor Street");
    // The records' own location comes first.
    expect(
      buildSearchPrompt(
        contact({
          location: "New York, NY",
          addresses: at("San Francisco, CA").addresses,
        }),
      ),
    ).toContain("Location: New York, NY");
  });

  it("searches with a work email's domain, even one after a personal email", () => {
    const withEmails = (...emails: string[]) =>
      contact({
        emails: emails.map((email, index) => ({
          id: `e${index}`,
          email,
          label: null,
          isPrimary: index === 0,
          source: null,
        })) as HydratedContact["emails"],
      });
    // The Research card's Add a work email appends the new email.
    expect(
      suggestedSearches(withEmails("rowan@gmail.com", "rv@northwind.example")),
    ).toContain('"Rowan Vale" northwind.example');
    expect(
      suggestedSearches(withEmails("rowan@gmail.com")).join(" "),
    ).not.toContain("gmail.com");
  });

  it("searches the formal name behind a short one, and only an unambiguous one", () => {
    expect(formalName("Tom Ashby")).toBe("Thomas Ashby");
    expect(formalName("Chris Lee")).toBeNull();
    expect(formalName("Tom")).toBeNull();
    expect(
      suggestedSearches(contact({ name: "Tom Vale" })).slice(0, 2),
    ).toEqual([
      '"Tom Vale" Northwind Partners',
      '"Thomas Vale" Northwind Partners',
    ]);
  });
});

describe("the name a search quotes", () => {
  const linkedIn = (handle: string) =>
    [
      { platform: "linkedin", url: `https://www.linkedin.com/in/${handle}` },
    ] as HydratedContact["socialLinks"];

  it("leaves out credentials, symbols and a note in brackets", () => {
    expect(searchName("Greg Whitlock, CPA")).toBe("Greg Whitlock");
    expect(searchName("Morgan Ellery - MBA, MS, LSS Black Belt")).toBe(
      "Morgan Ellery",
    );
    expect(searchName("Riley Tanaka, CFA, CFP®, MBA")).toBe("Riley Tanaka");
    expect(searchName("Avery Quill  林艾")).toBe("Avery Quill");
    expect(searchName("Robert (Bob) Smith")).toBe("Robert Smith");
    // A hyphen inside a name, an apostrophe and accents stay.
    expect(searchName("Mary-Jane O'Neil")).toBe("Mary-Jane O'Neil");
    expect(searchName("José Núñez")).toBe("José Núñez");
    // A name with no Latin letters is kept as written.
    expect(searchName("斯丹福")).toBe("斯丹福");
  });

  it("drops a middle initial for a second form", () => {
    expect(nameWithoutMiddleInitial("Casey J. Moreau")).toBe("Casey Moreau");
    expect(nameWithoutMiddleInitial("Jordan W Hale")).toBe("Jordan Hale");
    expect(nameWithoutMiddleInitial("Rowan Vale")).toBeNull();
    expect(nameWithoutMiddleInitial("Ana Maria Ferrand")).toBeNull();
  });

  it("reads the surname from the LinkedIn handle when the records end in an initial", () => {
    expect(nameFromHandle("Priya K.", linkedIn("priyakapoor"))).toBe(
      "Priya Kapoor",
    );
    expect(nameFromHandle("Theo V", linkedIn("theo-varga-0a1b2c3"))).toBe(
      "Theo Varga",
    );
    expect(nameFromHandle("Imani S.", linkedIn("imanisato8"))).toBe(
      "Imani Sato",
    );
    // The handle's surname has to start with the initial, and the handle
    // with the given name.
    expect(nameFromHandle("Priya Q.", linkedIn("priyakapoor"))).toBeNull();
    expect(nameFromHandle("Priya K.", linkedIn("pkapoor"))).toBeNull();
    expect(nameFromHandle("Priya K.", linkedIn("priya-k-123"))).toBeNull();
    // A full surname needs nothing, and nor does a link that is not LinkedIn.
    expect(nameFromHandle("Priya Kapoor", linkedIn("priyakapoor"))).toBeNull();
    expect(
      nameFromHandle("Priya K.", [{ url: "https://github.com/priyakapoor" }]),
    ).toBeNull();
  });

  it("names the other forms pages may use, and none for a plain name", () => {
    expect(
      otherNameForms(
        contact({ name: "Priya K.", socialLinks: linkedIn("priyakapoor") }),
      ),
    ).toEqual(["Priya Kapoor"]);
    expect(otherNameForms(contact({ name: "Greg Whitlock, CPA" }))).toEqual([
      "Greg Whitlock",
    ]);
    expect(otherNameForms(contact({ name: "Casey J. Moreau" }))).toEqual([
      "Casey Moreau",
    ]);
    expect(otherNameForms(contact())).toEqual([]);
    expect(
      buildSearchPrompt(contact({ name: "Greg Whitlock, CPA" })),
    ).toContain(
      "Full name: Greg Whitlock, CPA\nPages may write the name as: Greg Whitlock",
    );
    expect(
      buildShortSearchPrompt(contact({ name: "Greg Whitlock, CPA" })),
    ).toContain("Greg Whitlock, CPA (also written Greg Whitlock)");
    expect(buildSearchPrompt(contact())).not.toContain("Pages may write");
  });

  it("tells a placeholder employer from a real one", () => {
    for (const company of [
      "Stealth Startup",
      "Stealth",
      "Self-employed",
      "Freelance | Self-Employed",
      "Independent Consultant",
    ])
      expect(isPlaceholderEmployer(company)).toBe(true);
    for (const company of [
      "FTI Consulting",
      "Wyzant + Self Employed",
      "Northwind Partners",
      null,
      "",
    ])
      expect(isPlaceholderEmployer(company)).toBe(false);
  });

  it("searches the clean name, the handle's full name first, and never a placeholder employer", () => {
    // The formal name is read from the clean one, not "Greg Whitlock, CPA".
    expect(
      suggestedSearches(contact({ name: "Greg Whitlock, CPA" })).slice(0, 2),
    ).toEqual([
      '"Greg Whitlock" Northwind Partners',
      '"Gregory Whitlock" Northwind Partners',
    ]);
    expect(
      suggestedSearches(
        contact({ name: "Priya K.", socialLinks: linkedIn("priyakapoor") }),
      ),
    ).toEqual([
      '"Priya Kapoor" Northwind Partners',
      '"Priya K." Northwind Partners',
      '"Priya Kapoor" Associate, Restructuring Group',
      '"priyakapoor"',
    ]);
    expect(
      suggestedSearches(contact({ name: "Casey J. Moreau" })).slice(0, 2),
    ).toEqual([
      '"Casey J. Moreau" Northwind Partners',
      '"Casey Moreau" Northwind Partners',
    ]);
    const stealth = suggestedSearches(
      contact({ company: "Stealth Startup", role: "Co-Founder" }),
    );
    expect(stealth).toEqual(['"Rowan Vale" Co-Founder']);
    expect(
      suggestedSearches(
        contact({
          experience: [
            { company: "Self-employed", isCurrent: false },
            { company: "Harbor Point Partners", isCurrent: false },
          ] as HydratedContact["experience"],
        }),
      ).join("\n"),
    ).not.toContain("Self-employed");
    // Nothing but a name: the name.
    expect(suggestedSearches(contact({ company: null, role: null }))).toEqual([
      '"Rowan Vale"',
    ]);
  });
});

describe("the search budget", () => {
  it("asks the first search for four to six searches", () => {
    expect(buildSearchPrompt(contact())).toContain("Run four to six searches.");
  });

  it("asks a deep run's second ask for a complete profile, with ten or more searches", () => {
    const prompt = buildSearchPrompt(contact(), null, "complete");
    expect(prompt).toContain("Aim for a complete profile");
    expect(prompt).toContain("Run at least ten different searches");
    expect(prompt).not.toContain("Run four to six searches.");
  });
});

describe("the extraction prompt", () => {
  it("keeps the records' job current and the facts inside the untrusted block", () => {
    const prompt = buildExtractionPrompt(contact(), "- Past role: x [y]");
    expect(prompt).toContain(
      "The records say this person works at Northwind Partners as Associate, Restructuring Group now.",
    );
    expect(prompt).toMatch(
      /<untrusted_data label="web research facts">\n- Past role: x \[y\]\n<\/untrusted_data>/,
    );
  });
});

describe("parseFindings", () => {
  it("reads a fact line in each way a model writes it", () => {
    const findings = parseFindings(
      [
        "Based on the search results, here are the facts:",
        "### Career",
        "- Past role: Associate, Harbor Point Partners, 2018 to 2020 [brokercheck.finra.org]",
        "* **Education:** BA Economics, University of Example [fellows.example.org]",
        "1. Award: Distinguished Fellow",
        "- Location: null",
        "- Past role: Associate, Harbor Point Partners, 2018 to 2020 [finra.org]",
      ].join("\n"),
    );
    expect(findings).toEqual([
      {
        topic: "Past role",
        text: "Associate, Harbor Point Partners, 2018 to 2020",
        site: "brokercheck.finra.org",
      },
      {
        topic: "Education",
        text: "BA Economics, University of Example",
        site: "fellows.example.org",
      },
      { topic: "Award", text: "Distinguished Fellow" },
    ]);
  });

  it("finds nothing in the no-match reply", () => {
    expect(parseFindings(NO_MATCHING_PAGES)).toEqual([]);
  });

  it("reads the site when a line ends in citation markers or several brackets", () => {
    const findings = parseFindings(
      [
        "- Current role: Vice President, Support, Northwind [news.example.com [1.1.1], press.example.org] []",
        "- Past role: Litigation Fellow, Harbor Law Group [harborlaw.example] [fellows.example.org]",
        "- Award: Fellow, Example Society [2.2.3] [society.example.org]",
        "- Talk: Keynote, Example Summit, 2019 [1, 4]",
        "- Board role: Member, Advisory Board []",
      ].join("\n"),
    );
    expect(findings).toEqual([
      {
        topic: "Current role",
        text: "Vice President, Support, Northwind",
        site: "news.example.com",
      },
      {
        topic: "Past role",
        text: "Litigation Fellow, Harbor Law Group",
        site: "harborlaw.example",
      },
      {
        topic: "Award",
        text: "Fellow, Example Society",
        site: "society.example.org",
      },
      { topic: "Talk", text: "Keynote, Example Summit, 2019" },
      { topic: "Board role", text: "Member, Advisory Board" },
    ]);
    // A year in brackets is part of the fact, not a citation or a site.
    expect(parseFindings("- Talk: Example Summit [2019] [a.com]")).toEqual([
      { topic: "Talk", text: "Example Summit [2019]", site: "a.com" },
    ]);
  });
});

describe("mergeFindings", () => {
  it("keeps one copy of a fact that two asks word slightly apart", () => {
    const merged = mergeFindings([
      parseFindings(
        [
          "- Current role: Co-Founder & CEO at Northwind",
          "- Education: BA Economics, University of Example",
        ].join("\n"),
      ),
      parseFindings(
        [
          "- Current role: Co-Founder and CEO of Northwind [northwind.example]",
          "- Education: BA Economics, University of Example",
          "- Award: Fellow, Example Society",
        ].join("\n"),
      ),
    ]);
    // The current role keeps its first place, with the copy that names a site.
    expect(merged).toEqual([
      {
        topic: "Current role",
        text: "Co-Founder and CEO of Northwind",
        site: "northwind.example",
      },
      { topic: "Education", text: "BA Economics, University of Example" },
      { topic: "Award", text: "Fellow, Example Society" },
    ]);
  });

  it("prefers a copy with a page to one with a site only", () => {
    const merged = mergeFindings([
      [{ topic: "Award", text: "Fellow", site: "a.com" }],
      [{ topic: "Award", text: "Fellow", url: "https://b.org/fellows" }],
      [{ topic: "Award", text: "Fellow", site: "c.net" }],
    ]);
    expect(merged).toEqual([
      { topic: "Award", text: "Fellow", url: "https://b.org/fellows" },
    ]);
    // The same text under another topic is another fact.
    expect(
      mergeFindings([
        [
          { topic: "Past role", text: "Analyst, Acme" },
          { topic: "Board role", text: "Analyst, Acme" },
        ],
      ]),
    ).toHaveLength(2);
  });
});

describe("attachSources", () => {
  it("gives each fact the page whose passage holds it, with or without a site", () => {
    const redirect =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/a";
    const findings = attachSources(
      parseFindings(
        [
          "- Past role: Associate, Harbor Point Partners, 2018 to 2020",
          "- **Award:** Distinguished Fellow [fellows.example.org]",
          "- Hometown: Springfield, NJ",
        ].join("\n"),
      ),
      [
        {
          text: "- Past role: Associate, Harbor Point Partners, 2018 to 2020",
          uris: [redirect],
        },
        {
          text: "**Award:** Distinguished Fellow [fellows.example.org]",
          uris: ["https://fellows.example.org/people/rowan-vale"],
        },
      ],
      new Map([
        [redirect, "https://brokercheck.finra.org/individual/summary/1"],
      ]),
    );
    expect(findings.map((finding) => finding.url)).toEqual([
      "https://brokercheck.finra.org/individual/summary/1",
      "https://fellows.example.org/people/rowan-vale",
      undefined,
    ]);
    expect(findings[1].site).toBe("fellows.example.org");
  });

  it("leaves the facts alone when the provider matched no passages", () => {
    const findings = parseFindings("- Award: Fellow [a.com]");
    expect(attachSources(findings, [])).toBe(findings);
  });
});

describe("parseExtraction", () => {
  it("reads a bare string in a one-key list as that key", () => {
    // Claude Haiku 4.5 wrote tags this way in two runs of three.
    const { data, dropped } = parseExtraction({
      tags: ["restructuring", { tag: "m&a" }],
      interests: ["Distance running"],
    });
    expect(data.tags).toEqual([{ tag: "restructuring" }, { tag: "m&a" }]);
    expect(data.interests).toEqual([{ interest: "Distance running" }]);
    expect(dropped).toEqual([]);
  });

  it("drops one bad entry and keeps the rest of the answer", () => {
    const { data, dropped } = parseExtraction({
      role: "Associate",
      emails: [{ email: "not an address" }, { email: "ada@example.com" }],
      website: "javascript:alert(1)",
      experience: "Northwind Partners",
    });
    expect(data.role).toBe("Associate");
    expect(data.emails).toEqual([{ email: "ada@example.com" }]);
    expect(data.website).toBeUndefined();
    expect(data.experience).toBeUndefined();
    expect(dropped.sort()).toEqual(["emails", "experience", "website"]);
  });

  it("cuts a long list of one kind at a separator, and keeps the entry", () => {
    const papers = Array.from(
      { length: 50 },
      (_, index) =>
        `Paper number ${index + 1} on percolation thresholds (19${50 + index})`,
    ).join("; ");
    expect(papers.length).toBeGreaterThan(2_000);
    const { data, dropped } = parseExtraction({
      attributes: [
        { name: "Publications", value: papers },
        { name: "Awards", value: "Fellow, Example Society (1984)" },
      ],
    });
    expect(dropped).toEqual([]);
    const kept = data.attributes?.[0].value ?? "";
    expect(kept.length).toBeLessThanOrEqual(2_000);
    expect(kept.length).toBeGreaterThan(1_000);
    expect(papers.startsWith(kept)).toBe(true);
    expect(kept.endsWith(")")).toBe(true);
    expect(data.attributes?.[1]).toEqual({
      name: "Awards",
      value: "Fellow, Example Society (1984)",
    });
    // A value is cut at the last separator in its second half, else at the
    // limit.
    expect(clipList("ab; cdefgh; ij", 12)).toBe("ab; cdefgh");
    expect(clipList("ab; cdefghijkl", 12)).toBe("ab; cdefghij");
    expect(clipList("x".repeat(30), 10)).toBe("x".repeat(10));
    expect(clipList("short", 10)).toBe("short");
  });

  it("keeps profiles, not posts", () => {
    const { data } = parseExtraction({
      socialLinks: [
        { platform: "LinkedIn", url: "https://www.linkedin.com/in/rowanv" },
        {
          platform: "linkedin",
          url: "https://www.linkedin.com/posts/rowanv_excited-activity-68105",
        },
        { platform: "x", url: "https://x.com/ada/status/1" },
        { platform: "github", url: "https://github.com/ada" },
      ],
    });
    expect(data.socialLinks).toEqual([
      { platform: "linkedin", url: "https://www.linkedin.com/in/rowanv" },
      { platform: "github", url: "https://github.com/ada" },
    ]);
  });

  it("reads 'null' and friends as no value, and trims a location to the city", () => {
    const { data } = parseExtraction({
      headline: "null",
      industry: "N/A",
      location: "New York, NY, USA (previously Chicago)",
      interests: [{ interest: "Tennis (former USTA junior player)" }],
    });
    expect(data.headline).toBeUndefined();
    expect(data.industry).toBeUndefined();
    expect(data.location).toBe("New York, NY, USA");
    expect(data.interests).toEqual([{ interest: "Tennis" }]);
  });

  it("stores dates one way, and a date with text around it as none", () => {
    const { data } = parseExtraction({
      education: [
        {
          school: "Example Business School",
          startDate: "Aug 2023",
          endDate: "2025-05-01",
        },
        {
          school: "University of Example",
          startDate: "2023-08-01T00:00:00.000Z-05:00 to 2025-05-01 (approx)",
          endDate: "2023-08副",
        },
      ],
    });
    expect(data.education).toEqual([
      {
        school: "Example Business School",
        startDate: "2023-08",
        endDate: "2025-05",
      },
      {
        school: "University of Example",
        startDate: undefined,
        endDate: undefined,
      },
    ]);
  });
});

describe("researchDate", () => {
  it.each([
    ["2018", "2018"],
    ["2018-1", "2018-01"],
    ["2018-01-15", "2018-01"],
    ["2018-01-15T00:00:00Z", "2018-01"],
    ["Jan 2018", "2018-01"],
    ["September 2013", "2013-09"],
    ["3/2017", "2017-03"],
  ])("reads %s as %s", (input, output) => {
    expect(researchDate(input)).toBe(output);
  });

  it.each(["Present", "2018-13", "Summer 2012", "", "circa 2010"])(
    "reads %s as no date",
    (input) => {
      expect(researchDate(input)).toBeUndefined();
    },
  );
});

describe("linkedInHandle", () => {
  it.each([
    ["https://www.linkedin.com/in/rowan-vale", "rowan-vale"],
    ["https://uk.linkedin.com/in/Rowan-Vale/?trk=profile", "rowan-vale"],
    ["linkedin.com/in/rowan-vale/", "rowan-vale"],
    ["https://www.linkedin.com/in/ren%C3%A9-vale", "ren\u00e9-vale"],
    ["https://www.linkedin.com/pub/rowan-vale/1/2/3", "rowan-vale"],
  ])("reads %s as %s", (input, output) => {
    expect(linkedInHandle(input)).toBe(output);
  });

  it.each([
    "https://www.linkedin.com/company/northwind-partners",
    "https://www.linkedin.com/posts/rowan-vale_activity-1",
    "https://github.com/rowan-vale",
    "https://notlinkedin.com/in/rowan-vale",
    "",
    "not a url",
  ])("reads %s as no profile", (input) => {
    expect(linkedInHandle(input)).toBeNull();
  });
});

describe("tidyExtraction", () => {
  it("moves broker registrations to a fact, and keeps the records' job current", () => {
    const { data } = parseExtraction({
      experience: [
        {
          company: "Northwind Partners, LP",
          role: "Associate",
          isCurrent: true,
        },
        {
          company: "Kestrel",
          role: "Quantitative Researcher",
          isCurrent: true,
        },
        {
          company: "Acme Securities, LLC",
          role: "Registered Representative",
          startDate: "2020-09",
          endDate: "2022-02",
        },
        { company: "Pinecrest Inc.", role: "Registered Broker" },
        {
          company: "Harbor Point Securities",
          role: "Previously Registered Broker",
        },
        { company: "Kestrel", role: "Sales Representative" },
      ],
      attributes: [{ name: "Registrations", value: "FINRA CRD 1234567" }],
    });
    const tidy = tidyExtraction(data, { company: "Northwind Partners" });
    expect(tidy.experience?.map((job) => [job.company, job.isCurrent])).toEqual(
      [
        ["Northwind Partners, LP", true],
        ["Kestrel", false],
        ["Kestrel", undefined],
      ],
    );
    expect(tidy.attributes).toEqual([
      {
        name: "Registrations",
        value:
          "FINRA CRD 1234567; Acme Securities, LLC (2020-09 to 2022-02); Pinecrest Inc.; Harbor Point Securities",
      },
    ]);
  });

  it("keeps a long list of registrations whole up to the attribute's limit", () => {
    const firms = Array.from(
      { length: 30 },
      (_, index) => `Example Securities Number ${index + 1}, LLC`,
    );
    const { data } = parseExtraction({
      experience: firms.map((company) => ({
        company,
        role: "Registered Representative",
      })),
    });
    const value =
      tidyExtraction(data, { company: "Northwind Partners" }).attributes?.[0]
        .value ?? "";
    // Past 500 characters, and every firm kept whole.
    expect(value.length).toBeGreaterThan(500);
    expect(value.split("; ")).toEqual(firms);
  });

  it("says a degree's field once", () => {
    const { data } = parseExtraction({
      education: [
        {
          school: "University of Example",
          degree: "BA Economics",
          fieldOfStudy: "Economics",
        },
        {
          school: "Example Institute",
          degree: "Bachelor of Science in Applied Mathematics",
          fieldOfStudy: "Applied Mathematics",
        },
        {
          school: "Example Business School",
          degree: "Master of Finance",
          fieldOfStudy: "Finance",
        },
        {
          school: "Example College",
          degree: "Economics",
          fieldOfStudy: "Economics",
        },
        { school: "Example High School", degree: "MBA" },
      ],
    });
    const tidy = tidyExtraction(data, { company: "Northwind Partners" });
    expect(tidy.education?.map((entry) => entry.degree)).toEqual([
      "BA",
      "Bachelor of Science",
      "Master of Finance",
      undefined,
      "MBA",
    ]);
    expect(tidy.education?.[0].fieldOfStudy).toBe("Economics");
  });

  it("leaves a result with no jobs as it was", () => {
    const { data } = parseExtraction({ role: "Associate" });
    expect(tidyExtraction(data, { company: "Northwind Partners" })).toEqual(
      data,
    );
  });
});

describe("one organization, however it is written", () => {
  it("reads legal suffixes and a leading 'The' as the same name", () => {
    expect(orgKey("Northwind Partners, LP")).toBe(orgKey("Northwind Partners"));
    expect(orgKey("The Example State University")).toBe(
      orgKey("Example State University"),
    );
    expect(sameOrg("Kestrel Securities International, Inc.", "Kestrel")).toBe(
      true,
    );
    expect(sameOrg("Juniper Capital", "Kestrel")).toBe(false);
    expect(
      sameOrg("Example High School North / South", "Example High School North"),
    ).toBe(true);
  });

  it("reads one degree's names as one level", () => {
    for (const name of ["BA", "B.A.", "AB", "A.B.", "BSc", "Bachelor of Arts"])
      expect(degreeLevel(name)).toBe("bachelor");
    for (const name of ["MBA", "M.S.", "SM", "Master's", "Master of Finance"])
      expect(degreeLevel(name)).toBe("master");
    expect(degreeLevel("Ph.D.")).toBe("doctorate");
    expect(degreeLevel("J.D.")).toBe("law");
    expect(degreeLevel("MD")).toBe("medicine");
    expect(degreeLevel("Doctor of Medicine")).toBe("medicine");
    expect(degreeLevel("High School Diploma")).toBe("school");
    expect(degreeLevel("Certificate in Data Science")).toBe(
      "certificate in data science",
    );
    expect(degreeLevel(undefined)).toBe("");
  });

  it("reads an interest or tag worded two ways as one", () => {
    expect(sameLabel("Distance running", "Distance running coach")).toBe(true);
    expect(
      sameLabel(
        "Electronic music producer",
        "Electronic music production and DJing",
      ),
    ).toBe(true);
    expect(sameLabel("statistics", "statistical analysis")).toBe(true);
    expect(sameLabel("Machine learning", "Machine vision")).toBe(false);
    expect(sameLabel("Track and field", "Cross country running")).toBe(false);
  });
});

describe("resolveRedirects", () => {
  const redirect = (id: string) =>
    `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${id}`;
  const finra = "https://brokercheck.finra.org/individual/summary/1234567";
  const fellows = "http://fellows.example.org/people/rowan-vale";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps each grounding redirect to the page it names", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (url) =>
        new Response(null, {
          status: 302,
          headers: { location: String(url).endsWith("a") ? finra : fellows },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const pages = await resolveRedirects([
      redirect("a"),
      redirect("aa"),
      redirect("b"),
      "https://example.com/page",
    ]);
    expect(pages).toEqual(
      new Map([
        [redirect("a"), finra],
        [redirect("aa"), finra],
        [redirect("b"), fellows],
      ]),
    );
    // Only Google's redirects are asked, with HEAD, and never followed: the
    // page itself is not requested.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls)
      expect(init).toMatchObject({ method: "HEAD", redirect: "manual" });
  });

  it("leaves a redirect out when it does not answer with a page", async () => {
    // The caller then keeps the redirect itself.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(new Response("", { status: 200 })),
    );
    expect(await resolveRedirects([redirect("x"), redirect("y")])).toEqual(
      new Map(),
    );
  });
});

describe("the research record", () => {
  it("reads a stored record, and reads anything else as none", () => {
    expect(parseResearchRecord(JSON.stringify(EARLIER))).toEqual(EARLIER);
    expect(parseResearchRecord(EARLIER)).toEqual(EARLIER);
    expect(parseResearchRecord("{not json")).toBeNull();
    expect(
      parseResearchRecord({ version: 2, runs: [], sources: [] }),
    ).toBeNull();
    expect(parseResearchRecord(null)).toBeNull();
  });

  it("finds the source a finding names, however loosely", () => {
    const [finra, fellowsPage] = EARLIER.sources;
    expect(sourceForSite("brokercheck.finra.org", EARLIER.sources)).toBe(finra);
    expect(sourceForSite("finra.org", EARLIER.sources)).toBe(finra);
    expect(
      sourceForSite("https://fellows.example.org/x", EARLIER.sources),
    ).toBe(fellowsPage);
    expect(sourceForSite("Fellows", EARLIER.sources)).toBe(fellowsPage);
    expect(sourceForSite("linkedin.com", EARLIER.sources)).toBeNull();
    expect(sourceForSite(undefined, EARLIER.sources)).toBeNull();
  });
});
