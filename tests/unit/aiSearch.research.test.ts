// =============================================================================
// Unit: contact research — prompts, parsers and the research record
// =============================================================================
// The two passes of contact research, and what their answers are read into:
//
//   buildSearchPrompt      a first round, and a second that knows the first
//   parseFindings          "- Topic: fact [site]" lines
//   parseExtraction        the schema, one field and one entry at a time
//   tidyExtraction         the job rules a model follows only sometimes
//   normalize              one school, degree, employer or label, however
//                          a page writes it
//   researchDate           dates as the dossier stores them
//   resolveCitations       Gemini's redirect links, as the pages they name
//   shared/researchRecord  the record the dossier's Research card reads
// =============================================================================

import { describe, it, expect, vi } from "vitest";
import type { HydratedContact } from "../../server/repositories/types.ts";
import {
  attachSources,
  buildExtractionPrompt,
  buildSearchPrompt,
  buildShortSearchPrompt,
  formalName,
  missingTopics,
  NO_MATCHING_PAGES,
  parseExtraction,
  parseFindings,
  PRIVATE_TOPICS,
  suggestedSearches,
  tidyExtraction,
} from "../../server/services/aiSearch/promptTemplate.ts";
import {
  degreeLevel,
  orgKey,
  researchDate,
  sameLabel,
  sameOrg,
} from "../../server/services/aiSearch/normalize.ts";
import { resolveCitations } from "../../server/ai/citations.ts";
import {
  isLegacyDossier,
  parseResearchRecord,
  sourceForSite,
  type ResearchRecord,
} from "../../shared/researchRecord.ts";

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

  it("leaves private details out, in every prompt", () => {
    for (const prompt of [
      buildSearchPrompt(contact()),
      buildShortSearchPrompt(contact()),
      buildExtractionPrompt(contact(), "- Award: Fellow [example.org]"),
    ])
      expect(prompt).toContain(`Leave out ${PRIVATE_TOPICS}`);
    expect(PRIVATE_TOPICS).toMatch(/politics/);
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

describe("resolveCitations", () => {
  const redirect = (id: string) =>
    `https://vertexaisearch.cloud.google.com/grounding-api-redirect/${id}`;

  it("replaces a grounding redirect with the page it names, and merges repeats", async () => {
    const fetchImpl = vi.fn(
      async (url: string | URL | Request) =>
        new Response(null, {
          status: 302,
          headers: {
            location: String(url).endsWith("a")
              ? "https://brokercheck.finra.org/individual/summary/1234567"
              : "http://fellows.example.org/people/rowan-vale",
          },
        }),
    ) as unknown as typeof fetch;
    const resolved = await resolveCitations(
      [
        { title: "finra.org", uri: redirect("a") },
        { title: "finra.org", uri: redirect("aa") },
        { title: "fellows.example.org", uri: redirect("b") },
        { title: "A page", uri: "https://example.com/page" },
      ],
      { fetchImpl },
    );
    expect(resolved).toEqual([
      {
        title: "finra.org",
        uri: "https://brokercheck.finra.org/individual/summary/1234567",
      },
      {
        title: "fellows.example.org",
        uri: "http://fellows.example.org/people/rowan-vale",
      },
      { title: "A page", uri: "https://example.com/page" },
    ]);
    // Only Google's redirects are asked, with HEAD, and never followed: the
    // page itself is not requested.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [, init] of vi.mocked(fetchImpl).mock.calls)
      expect(init).toMatchObject({ method: "HEAD", redirect: "manual" });
  });

  it("keeps the redirect when it does not answer with a page", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        new Response("", { status: 200 }),
      ) as unknown as typeof fetch;
    const links = [
      { title: "a.com", uri: redirect("x") },
      { title: "b.com", uri: redirect("y") },
    ];
    expect(await resolveCitations(links, { fetchImpl })).toEqual(links);
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

  it("knows the dossier the old merge wrote", () => {
    expect(
      isLegacyDossier(
        "About.\n\n### Sources\n- [Source 1](<https://vertexaisearch.cloud.google.com/grounding-api-redirect/X>)",
      ),
    ).toBe(true);
    expect(isLegacyDossier("Notes from a call.\n\n[Site](https://a.com)")).toBe(
      false,
    );
    expect(isLegacyDossier(null)).toBe(false);
  });
});
