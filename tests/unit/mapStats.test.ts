import { describe, expect, it } from "vitest";
import { computeMapStats } from "../../src/views/map/mapStats";
import type { MapContact } from "../../shared/geo";

describe("computeMapStats", () => {
  const baseContact: MapContact = {
    id: "1",
    name: "Ada Lovelace",
    company: "Babbage & Co",
    role: "Engineer",
    industry: "Computing",
    location: "London, UK",
    avatarUrl: null,
    lat: 51.5074,
    lng: -0.1278,
    relationshipScore: 85,
    lastContactedAt: "2026-09-01T10:00:00Z",
    nextFollowUpAt: "2026-10-01T10:00:00Z",
    interactionCount: 5,
    tags: ["mathematician", "founder"],
    lists: [],
  };

  it("returns zeros and null avgScore when contacts list is empty", () => {
    const stats = computeMapStats([]);
    expect(stats.inView).toBe(0);
    expect(stats.matching).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.atRisk).toBe(0);
    expect(stats.overdue).toBe(0);
    expect(stats.neverContacted).toBe(0);
    expect(stats.avgScore).toBeNull();
    expect(stats.topIndustries).toEqual([]);
    expect(stats.topCompanies).toEqual([]);
    expect(stats.topTags).toEqual([]);
    expect(stats.timeZones).toEqual([]);
  });

  it("returns zeros and null avgScore when no contacts are inside bounds", () => {
    const contacts: MapContact[] = [baseContact];
    // Bounds far away (e.g. Sydney, Australia)
    const bounds: [number, number, number, number] = [150, -35, 152, -33];
    const stats = computeMapStats(contacts, bounds, new Date(), 10);
    expect(stats.inView).toBe(0);
    expect(stats.matching).toBe(1);
    expect(stats.total).toBe(10);
    expect(stats.avgScore).toBeNull();
  });

  it("counts inView, atRisk, overdue, and neverContacted accurately", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const contacts: MapContact[] = [
      {
        ...baseContact,
        id: "1",
        relationshipScore: 80, // Strong
        nextFollowUpAt: "2026-09-20T00:00:00Z", // Not overdue
      },
      {
        ...baseContact,
        id: "2",
        name: "Alan Turing",
        relationshipScore: 30, // At-risk (<40)
        nextFollowUpAt: "2026-09-10T00:00:00Z", // Overdue
      },
      {
        ...baseContact,
        id: "3",
        name: "Charles Babbage",
        relationshipScore: 20, // At-risk (<40)
        lastContactedAt: null,
        interactionCount: 0, // Never contacted
        nextFollowUpAt: null,
      },
      {
        ...baseContact,
        id: "4",
        name: "Grace Hopper",
        relationshipScore: 60, // Fading
        nextFollowUpAt: null,
      },
    ];

    const stats = computeMapStats(contacts, null, now, 10);
    expect(stats.inView).toBe(4);
    expect(stats.matching).toBe(4);
    expect(stats.total).toBe(10);
    expect(stats.atRisk).toBe(2); // IDs 2 and 3
    expect(stats.overdue).toBe(1); // ID 2
    expect(stats.neverContacted).toBe(1); // ID 3
    // avgScore: (80 + 30 + 20 + 60) / 4 = 190 / 4 = 47.5 -> 48
    expect(stats.avgScore).toBe(48);
  });

  it("sorts top lists by count descending then name ascending and caps at five", () => {
    const contacts: MapContact[] = [
      {
        ...baseContact,
        id: "1",
        industry: "Tech",
        company: "Acme",
        tags: ["alpha", "beta"],
      },
      {
        ...baseContact,
        id: "2",
        industry: "Tech",
        company: "BetaCorp",
        tags: ["beta", "gamma"],
      },
      {
        ...baseContact,
        id: "3",
        industry: "Finance",
        company: "Acme",
        tags: ["gamma", "delta"],
      },
      {
        ...baseContact,
        id: "4",
        industry: "Healthcare",
        company: "Zeta",
        tags: ["epsilon"],
      },
      {
        ...baseContact,
        id: "5",
        industry: "Education",
        company: "AlphaCo",
        tags: ["zeta"],
      },
      {
        ...baseContact,
        id: "6",
        industry: "Aerospace",
        company: "Delta",
        tags: ["eta"],
      },
      {
        ...baseContact,
        id: "7",
        industry: "Automotive",
        company: "Epsilon",
        tags: ["theta"],
      },
    ];

    const stats = computeMapStats(contacts);
    expect(stats.topIndustries.length).toBeLessThanOrEqual(5);
    // Tech has 2, others have 1. Among count 1, sorted alphabetically.
    expect(stats.topIndustries[0]).toEqual({ name: "Tech", count: 2 });
    expect(stats.topIndustries[1].name).toBe("Aerospace");
    expect(stats.topIndustries[1].count).toBe(1);

    // Acme has 2, others have 1
    expect(stats.topCompanies.length).toBeLessThanOrEqual(5);
    expect(stats.topCompanies[0]).toEqual({ name: "Acme", count: 2 });
    expect(stats.topCompanies[1].name).toBe("AlphaCo");

    // Tags: beta and gamma have 2 each. Alphabetical: beta before gamma.
    expect(stats.topTags.length).toBeLessThanOrEqual(5);
    expect(stats.topTags[0]).toEqual({ name: "beta", count: 2 });
    expect(stats.topTags[1]).toEqual({ name: "gamma", count: 2 });
  });

  it("buckets time zones from tz-lookup by UTC offset", () => {
    const now = new Date("2026-09-18T12:00:00Z");
    const contacts: MapContact[] = [
      { ...baseContact, id: "1", lat: 51.5074, lng: -0.1278 }, // London (Europe/London -> GMT+1)
      { ...baseContact, id: "2", lat: 53.4808, lng: -2.2426 }, // Manchester (Europe/London -> GMT+1)
      { ...baseContact, id: "3", lat: 40.7128, lng: -74.006 }, // New York (America/New_York -> GMT-4)
      { ...baseContact, id: "4", lat: 35.6762, lng: 139.6503 }, // Tokyo (Asia/Tokyo -> GMT+9)
    ];

    const stats = computeMapStats(contacts, null, now);
    expect(stats.timeZones.length).toBe(3);
    // GMT+1 has 2, GMT-4 has 1, GMT+9 has 1
    const gmtPlus1 = stats.timeZones.find((tz) => tz.label === "GMT+1");
    expect(gmtPlus1).toBeDefined();
    expect(gmtPlus1?.count).toBe(2);

    const gmtMinus4 = stats.timeZones.find((tz) => tz.label === "GMT-4");
    expect(gmtMinus4).toBeDefined();
    expect(gmtMinus4?.count).toBe(1);
    expect(gmtMinus4?.offsetMinutes).toBe(-240);
  });
});
