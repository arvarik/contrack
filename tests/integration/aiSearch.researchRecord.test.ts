// Integration: the research record the enrichment merge keeps
// Every enrichment is recorded on the contact (`aiResearch`): when it ran,
// which models, what it added field by field, the searches, the facts and the
// pages. A second enrichment adds to the record, and "Not this person" takes
// a run back.

import { beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import {
  enrichmentContact,
  lockEnrichment,
} from "../../server/services/aiSearch/contactSnapshot.ts";
import {
  mergeSearchResult,
  researchHistory,
  type ResearchProvenance,
} from "../../server/services/aiSearch/mergeEngine.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import {
  parseResearchRecord,
  type ResearchRecord,
} from "../../shared/researchRecord.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());
let id: string;

beforeEach(async () => {
  sqlite.prepare("DELETE FROM contacts").run();
  id = (
    await request(app)
      .post("/api/contacts")
      .send({ name: "Research Subject", company: "Northwind Partners" })
  ).body.id;
});

/** One research result merged into the contact, as a job would. */
const merge = (output: unknown, provenance: ResearchProvenance = {}) =>
  mergeSearchResult(scope(), id, enrichmentContact(scope(), id), output, {
    models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    outcome: "found",
    ...provenance,
  });

const record = (): ResearchRecord =>
  parseResearchRecord(enrichmentContact(scope(), id).aiResearch)!;

const finra = { title: "finra.org", uri: "https://brokercheck.finra.org/x" };
const fellows = {
  title: "fellows.example.org",
  uri: "http://fellows.example.org/y",
};

describe("the research record", () => {
  it("records each run: what it added, the searches, the facts and the pages", () => {
    const added = merge(
      {
        location: "New York, NY",
        experience: [
          {
            company: "Northwind Partners, LP",
            role: "Associate",
            isCurrent: true,
          },
        ],
        tags: [{ tag: "restructuring" }],
      },
      {
        citations: [finra],
        findings: [
          {
            topic: "Current role",
            text: "Associate, Northwind Partners",
            site: "finra.org",
          },
        ],
        searchQueries: ['"Research Subject" Northwind Partners'],
      },
    );
    expect(added).toBe(3);
    const first = record();
    expect(first.runs).toHaveLength(1);
    expect(first.runs[0]).toMatchObject({
      models: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
      outcome: "added",
      added: [
        { field: "location", count: 1 },
        { field: "experience", count: 1 },
        { field: "tags", count: 1 },
      ],
      sourceCount: 1,
      queries: ['"Research Subject" Northwind Partners'],
      findings: [
        {
          topic: "Current role",
          text: "Associate, Northwind Partners",
          site: "finra.org",
        },
      ],
    });
    expect(first.sources).toEqual([
      { url: finra.uri, title: "finra.org", firstSeenAt: first.runs[0].at },
    ]);
  });

  it("adds a second run beside the first, and each page once", () => {
    merge({ location: "New York, NY" }, { citations: [finra] });
    merge(
      { education: [{ school: "Example Business School", degree: "MBA" }] },
      { citations: [finra, fellows] },
    );
    const second = record();
    expect(second.runs.map((run) => run.added)).toEqual([
      [{ field: "location", count: 1 }],
      [{ field: "education", count: 1 }],
    ]);
    expect(second.sources.map((source) => source.url)).toEqual([
      finra.uri,
      fellows.uri,
    ]);
    // The page the first run read keeps the time it was first read.
    expect(second.sources[0].firstSeenAt).toBe(second.runs[0].at);
  });

  it("keeps the facts of the latest two runs, and the summary of every run", () => {
    const facts = [{ topic: "Award", text: "Fellow" }];
    merge({ location: "New York, NY" }, { findings: facts });
    merge({ industry: "Investment banking" }, { findings: facts });
    merge({ headline: "Associate" }, { findings: facts });
    const runs = record().runs;
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.findings.length)).toEqual([0, 1, 1]);
    expect(runs[0].added).toEqual([{ field: "location", count: 1 }]);
  });

  it("records a run that found nobody, and changes no field", () => {
    const added = merge(
      {},
      { outcome: "no-public-info", models: ["gemini-3.8-flash"] },
    );
    expect(added).toBe(0);
    const contact = enrichmentContact(scope(), id);
    expect(contact.aiHydratedAt).toBeTruthy();
    expect(record().runs[0]).toMatchObject({
      outcome: "no-public-info",
      added: [],
      sourceCount: 0,
    });
  });

  it("says a run found nothing new when every detail was already there", () => {
    merge({ location: "New York, NY" });
    merge({ location: "Chicago, IL" }, { citations: [finra] });
    expect(record().runs[1]).toMatchObject({
      outcome: "nothing-new",
      sourceCount: 1,
    });
    expect(enrichmentContact(scope(), id).location).toBe("New York, NY");
  });

  it("counts an enrichment that left no record in the history", () => {
    sqlite
      .prepare("UPDATE contacts SET aiHydratedAt = ? WHERE id = ?")
      .run("2026-09-26T22:21:58.046Z", id);
    const before = enrichmentContact(scope(), id);
    expect(researchHistory(before)?.runs).toEqual([
      expect.objectContaining({ at: "2026-09-26T22:21:58.046Z", models: [] }),
    ]);
    merge({ location: "New York, NY" }, { citations: [finra] });
    expect(record().runs.map((run) => run.models.length)).toEqual([0, 2]);
  });

  it("tells the contact list how the latest run ended", async () => {
    const outcome = async () =>
      (
        (await request(app).get("/api/contacts?view=slim")).body as Array<{
          id: string;
          researchOutcome: string | null;
        }>
      ).find((row) => row.id === id)?.researchOutcome;
    expect(await outcome()).toBeNull();
    merge({}, { outcome: "no-public-info", models: ["gemini-3.8-flash"] });
    expect(await outcome()).toBe("no-public-info");
    merge({ location: "New York, NY" }, { citations: [finra] });
    expect(await outcome()).toBe("added");
    // A record the list cannot read is no outcome, not a failed list.
    sqlite
      .prepare("UPDATE contacts SET aiResearch = ? WHERE id = ?")
      .run("not json", id);
    expect(await outcome()).toBeNull();
  });

  it("keeps notes that came from an import or the API", () => {
    sqlite
      .prepare("UPDATE contacts SET aiBackground = ? WHERE id = ?")
      .run("Met at the Example alumni dinner.", id);
    merge({ location: "New York, NY" }, { citations: [finra] });
    expect(enrichmentContact(scope(), id).aiBackground).toBe(
      "Met at the Example alumni dinner.",
    );
  });

  it("reads a school, a degree, an interest and a tag worded two ways as one", () => {
    merge({
      education: [
        {
          school: "University of Example",
          degree: "BA",
          fieldOfStudy: "Economics",
          startDate: "2013",
          endDate: "2017-03",
        },
        {
          school: "Example High School North / South",
          degree: "High School Diploma",
          endDate: "2013",
        },
      ],
      interests: [{ interest: "Distance running" }],
      tags: [{ tag: "statistics" }],
    });
    const added = merge({
      education: [
        { school: "The University of Example", degree: "AB", endDate: "2017" },
        { school: "Example High School North" },
        { school: "University of Example", degree: "MBA", endDate: "2025" },
      ],
      interests: [
        { interest: "Distance running coach" },
        { interest: "Tennis" },
      ],
      tags: [{ tag: "statistical analysis" }],
    });
    expect(added).toBe(2);
    const contact = enrichmentContact(scope(), id);
    expect(contact.education.map((entry) => entry.degree).sort()).toEqual([
      "BA",
      "High School Diploma",
      "MBA",
    ]);
    expect(contact.interests.map((entry) => entry.interest).sort()).toEqual([
      "Distance running",
      "Tennis",
    ]);
    expect(contact.tags.map((entry) => entry.tag)).toEqual(["statistics"]);
    expect(record().runs[1].added).toEqual([
      { field: "education", count: 1 },
      { field: "interests", count: 1 },
    ]);
  });

  it("reads a job that started the same month as the same job, however its title is worded", () => {
    merge({
      experience: [
        {
          company: "Northwind Partners, LP",
          role: "Associate, Restructuring Group",
          startDate: "2025-07",
          isCurrent: true,
        },
        {
          company: "Northwind Partners, LP",
          role: "Summer Associate",
          startDate: "2024-06",
          endDate: "2024-08",
        },
      ],
    });
    const added = merge({
      experience: [
        {
          company: "Northwind Partners",
          role: "Associate",
          startDate: "2025-07",
        },
        {
          company: "Northwind Partners",
          role: "Associate",
          startDate: "2026-01",
        },
      ],
    });
    expect(added).toBe(1);
    expect(
      enrichmentContact(scope(), id)
        .experience.map((job) => job.startDate)
        .sort(),
    ).toEqual(["2024-06", "2025-07", "2026-01"]);
  });

  it("reads one employer's two spellings as one job", () => {
    merge({
      experience: [{ company: "Northwind Partners", role: "Associate" }],
    });
    const added = merge({
      experience: [
        { company: "Northwind Partners, LP", role: "Associate" },
        {
          company: "Northwind Partners Group",
          role: "Associate",
          startDate: "2025-07",
        },
      ],
      education: [{ school: "The University of Example", degree: "BA" }],
    });
    expect(added).toBe(1);
    merge({ education: [{ school: "University of Example", degree: "BA" }] });
    const contact = enrichmentContact(scope(), id);
    expect(contact.experience).toHaveLength(1);
    expect(contact.education).toHaveLength(1);
  });

  it("keeps the contact's one LinkedIn profile, and drops another handle", async () => {
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({
        socialLinks: [
          {
            platform: "linkedin",
            url: "https://www.linkedin.com/in/research-subject",
          },
        ],
      })
      .expect(200);
    const added = merge({
      socialLinks: [
        // The same profile at another address.
        {
          platform: "linkedin",
          url: "https://uk.linkedin.com/in/Research-Subject/?trk=profile",
        },
        // Someone else with the same name.
        {
          platform: "linkedin",
          url: "https://www.linkedin.com/in/research-subject-4b2",
        },
        { platform: "github", url: "https://github.com/research-subject" },
      ],
    });
    expect(added).toBe(1);
    expect(
      enrichmentContact(scope(), id)
        .socialLinks.map((link) => link.url)
        .sort(),
    ).toEqual([
      "https://github.com/research-subject",
      "https://www.linkedin.com/in/research-subject",
    ]);
  });

  it("adds one LinkedIn profile to a contact with none", () => {
    merge({
      socialLinks: [
        {
          platform: "linkedin",
          url: "https://www.linkedin.com/in/research-subject",
        },
        {
          platform: "linkedin",
          url: "https://www.linkedin.com/in/research-subject-4b2",
        },
      ],
    });
    expect(
      enrichmentContact(scope(), id).socialLinks.map((link) => link.url),
    ).toEqual(["https://www.linkedin.com/in/research-subject"]);
  });

  it("does not add back an entry the person removed, however a page words it", async () => {
    expect(
      merge({
        education: [
          {
            school: "Example High School",
            degree: "High School Diploma",
            endDate: "2013",
          },
        ],
        experience: [
          {
            company: "Harbor Point Partners",
            role: "Associate",
            startDate: "2018-01",
          },
        ],
        socialLinks: [
          { platform: "github", url: "https://github.com/someone-else" },
        ],
        interests: [{ interest: "Sailing" }],
        tags: [{ tag: "direct lending" }],
        attributes: [{ name: "Hometown", value: "Springfield" }],
      }),
    ).toBe(6);
    // The person removes what was someone else's.
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({
        education: [],
        experience: [],
        socialLinks: [],
        interests: [],
        tags: [],
        attributes: [],
      })
      .expect(200);
    // The next run finds the same things written another way, and one new
    // school.
    const added = merge({
      education: [
        { school: "Example High School", degree: "Diploma", endDate: "2013" },
        { school: "University of Example", degree: "BA", endDate: "2017" },
      ],
      experience: [
        {
          company: "Harbor Point Partners LLC",
          role: "Associate",
          startDate: "2018-01",
        },
      ],
      socialLinks: [
        { platform: "github", url: "https://github.com/someone-else/" },
      ],
      interests: [{ interest: "Sailing" }],
      tags: [{ tag: "Direct lending" }],
      attributes: [{ name: "hometown", value: "Springfield" }],
    });
    expect(added).toBe(1);
    const contact = enrichmentContact(scope(), id);
    expect(contact.education.map((entry) => entry.school)).toEqual([
      "University of Example",
    ]);
    expect(contact.experience).toEqual([]);
    expect(contact.socialLinks).toEqual([]);
    expect(contact.interests).toEqual([]);
    expect(contact.tags).toEqual([]);
    expect(contact.attributes).toEqual([]);
    // Both runs' entries are kept, the new school last.
    expect(record().addedEntries?.map((entry) => entry.field)).toEqual([
      "socialLinks",
      "education",
      "experience",
      "tags",
      "interests",
      "attributes",
      "education",
    ]);
    // Each entry names the run that added it, for "Not this person".
    expect(record().addedEntries?.at(-1)).toEqual({
      field: "education",
      value: "University of Example",
      detail: "BA",
      date: "2017",
      at: record().runs.at(-1)!.at,
    });
  });
});

describe("a second round, worded another way", () => {
  it("adds no job or school again for a title or a school name worded two ways", () => {
    merge({
      experience: [{ company: "Juniper Review", role: "Editor, Writer" }],
      education: [{ school: "Example University", degree: "BS" }],
    });
    const added = merge({
      experience: [
        { company: "Juniper Review", role: "Editor and Writer" },
        // Two roles, not one: both words do not fit in either title.
        { company: "Juniper Review", role: "Research Assistant" },
      ],
      education: [
        {
          school: "Harbor School of Engineering at Example University",
          degree: "Bachelor of Science",
        },
      ],
    });
    expect(added).toBe(1);
    const contact = enrichmentContact(scope(), id);
    expect(contact.experience.map((job) => job.role).sort()).toEqual([
      "Editor, Writer",
      "Research Assistant",
    ]);
    expect(contact.education).toHaveLength(1);
  });

  it("keeps a promotion and a second university apart, even with no dates", () => {
    merge({
      experience: [{ company: "Juniper Review", role: "Analyst" }],
      education: [{ school: "University of Example" }],
    });
    merge({
      experience: [{ company: "Juniper Review", role: "Senior Analyst" }],
      education: [{ school: "Example State University" }],
    });
    const contact = enrichmentContact(scope(), id);
    expect(contact.experience.map((job) => job.role).sort()).toEqual([
      "Analyst",
      "Senior Analyst",
    ]);
    expect(contact.education).toHaveLength(2);
  });

  it("adds new items to a list an earlier run made, and leaves the person's own list alone", async () => {
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({ attributes: [{ name: "Languages", value: "Spanish" }] });
    merge({
      attributes: [
        { name: "Publications", value: "Tidal Patterns in Harbor Sediment" },
      ],
    });
    merge({
      attributes: [
        {
          name: "Publications",
          value:
            "572 Tidal Patterns in Harbor Sediment; Lichen Growth on Coastal Granite",
        },
        { name: "Languages", value: "French" },
      ],
    });
    const values = Object.fromEntries(
      enrichmentContact(scope(), id).attributes.map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
    );
    expect(values).toEqual({
      Publications:
        "Tidal Patterns in Harbor Sediment; Lichen Growth on Coastal Granite",
      Languages: "Spanish",
    });
    expect(record().addedEntries?.at(-1)).toMatchObject({
      field: "attributeItems",
      value: "Publications",
      detail: "Lichen Growth on Coastal Granite",
    });
  });

  it("does not add back an item the person removed from research's list", async () => {
    merge({
      attributes: [{ name: "Awards", value: "Dean's List; Example Prize" }],
    });
    merge({ attributes: [{ name: "Awards", value: "Fellowship of Note" }] });
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({ attributes: [{ name: "Awards", value: "Dean's List" }] });
    merge({
      attributes: [
        {
          name: "Awards",
          value: "Fellowship of Note; Example Prize; New Medal",
        },
      ],
    });
    // Both items the person removed stay out: the one in the list the first
    // run made, and the one a later run added.
    expect(enrichmentContact(scope(), id).attributes[0].value).toBe(
      "Dean's List; New Medal",
    );
  });
});

describe("Not this person", () => {
  const reject = (runAt: string) =>
    request(app).post(`/api/contacts/${id}/research/reject`).send({ runAt });

  it("takes back what the run added, keeps what the person changed, and leaves its pages out", async () => {
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({ interests: [{ interest: "Sailing", isAiGenerated: false }] });
    merge(
      {
        location: "Boston, MA",
        headline: "Analyst at Harbor Point",
        education: [{ school: "Example College", degree: "BA" }],
        experience: [{ company: "Harbor Point Partners", role: "Analyst" }],
        interests: [{ interest: "Track and field" }],
        attributes: [{ name: "Awards", value: "Conference Champion" }],
      },
      { citations: [finra, fellows] },
    );
    const runAt = record().runs[0].at;
    // The person corrects the job research wrote: it is theirs now.
    const before = enrichmentContact(scope(), id);
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({
        experience: before.experience.map((job) => ({
          company: job.company,
          role: "Senior Analyst",
        })),
      });

    const response = await reject(runAt);
    expect(response.status).toBe(200);
    expect(response.body.removed).toBe(5);
    const after = enrichmentContact(scope(), id);
    expect(response.body.contact.id).toBe(id);
    expect(after.location).toBeNull();
    expect(after.headline).toBeNull();
    expect(after.education).toEqual([]);
    expect(after.attributes).toEqual([]);
    expect(after.interests.map((entry) => entry.interest)).toEqual(["Sailing"]);
    expect(after.experience.map((job) => job.role)).toEqual(["Senior Analyst"]);
    const kept = record();
    expect(kept.runs[0]).toMatchObject({ rejected: true, findings: [] });
    expect(kept.sources).toEqual([]);
    expect(kept.rejectedSources).toEqual([finra.uri, fellows.uri]);

    // A later run does not add the same values back.
    merge({
      location: "Boston, MA",
      education: [{ school: "Example College", degree: "BA" }],
    });
    expect(enrichmentContact(scope(), id).location).toBeNull();
    expect(enrichmentContact(scope(), id).education).toEqual([]);

    // A run is taken back once.
    expect((await reject(runAt)).body.error.code).toBe(
      "RESEARCH_RUN_NOT_FOUND",
    );
  });

  it("keeps an About the person added to, and clears one left as the run wrote it", async () => {
    const about = `A trader at Harbor Point. ${"Writes about markets. ".repeat(20)}`;
    merge({ about, headline: "Trader" });
    const runAt = record().runs[0].at;
    // The person adds a line after the run's 400 characters.
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({ about: `${about} Met at the fair.` });

    expect((await reject(runAt)).status).toBe(200);
    const after = enrichmentContact(scope(), id);
    expect(after.about).toBe(`${about} Met at the fair.`);
    expect(after.headline).toBeNull();
  });

  it("takes back a run's own list items, and keeps what a later run added to the list", async () => {
    merge({
      attributes: [
        {
          name: "Publications",
          value: "Tidal Patterns in Harbor Sediment; Lichen on Granite",
        },
      ],
    });
    const first = record().runs[0].at;
    merge({
      attributes: [{ name: "Publications", value: "Salt Marsh Survey" }],
    });
    expect((await reject(first)).body.removed).toBe(1);
    expect(enrichmentContact(scope(), id).attributes).toEqual([
      expect.objectContaining({
        name: "Publications",
        value: "Salt Marsh Survey",
      }),
    ]);
  });

  it("keeps a taken-back run's pages and items out of every later run", async () => {
    merge(
      {
        attributes: [
          { name: "Publications", value: "Tidal Patterns in Harbor Sediment" },
        ],
      },
      { citations: [finra] },
    );
    await reject(record().runs[0].at);
    // Two later runs: the pages stay left out after the first.
    merge({ location: "Boston, MA" }, { citations: [fellows] });
    merge({
      attributes: [
        {
          name: "Publications",
          value: "Tidal Patterns in Harbor Sediment; Salt Marsh Survey",
        },
      ],
    });
    expect(record().rejectedSources).toEqual([finra.uri]);
    // The kind may come again with the right person's items, not the
    // stranger's.
    expect(enrichmentContact(scope(), id).attributes).toEqual([
      expect.objectContaining({
        name: "Publications",
        value: "Salt Marsh Survey",
      }),
    ]);
  });

  it("moves the map pin with its text, and leaves a pin the person's own address placed", async () => {
    const pin = () =>
      sqlite.prepare("SELECT lat, lng FROM contacts WHERE id = ?").get(id) as {
        lat: number | null;
        lng: number | null;
      };
    const placed = () =>
      sqlite
        .prepare(
          "UPDATE contacts SET lat = 42.36, lng = -71.06, geoSource = 'geocoder' WHERE id = ?",
        )
        .run(id);
    // The location research wrote placed the pin: it goes with it.
    merge({ location: "Boston, MA" });
    placed();
    await reject(record().runs[0].at);
    expect(pin()).toEqual({ lat: null, lng: null });

    // The person's own address placed the pin: it stays.
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({ addresses: [{ address: "Denver, CO", isPrimary: true }] });
    merge({ location: "Boston, MA" });
    placed();
    await reject(record().runs.at(-1)!.at);
    expect(pin()).toEqual({ lat: 42.36, lng: -71.06 });
  });

  it("refuses a run that added details before entries named their run", async () => {
    merge({ location: "Boston, MA" });
    const old = record();
    old.addedEntries = old.addedEntries?.map(({ at: _at, ...entry }) => entry);
    sqlite
      .prepare("UPDATE contacts SET aiResearch = ? WHERE id = ?")
      .run(JSON.stringify(old), id);
    const response = await reject(old.runs[0].at);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("RESEARCH_RUN_UNTRACKED");
    expect(enrichmentContact(scope(), id).location).toBe("Boston, MA");
    expect(record().runs[0].rejected).toBeUndefined();
  });

  it("refuses while research runs for the contact", async () => {
    merge({ location: "Boston, MA" });
    const running = lockEnrichment(id);
    try {
      expect((await reject(record().runs[0].at)).status).toBe(409);
    } finally {
      running();
    }
    expect(enrichmentContact(scope(), id).location).toBe("Boston, MA");
  });
});
