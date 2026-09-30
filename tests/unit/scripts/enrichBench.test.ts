/**
 * The plan for one benchmark contact: what to add, fix and keep.
 *
 * `planEnrichment` is pure. The same contact, seed and clock give the same
 * plan, so the script can run twice and a test can read the answer.
 */
import { describe, expect, it } from "vitest";
import {
  planEnrichment,
  sqliteStamp,
  type BenchInput,
  type BenchPlan,
} from "../../../scripts/bench/enrich.ts";
import { CITIES, cityKey } from "../../../scripts/bench/places.ts";
import { INDUSTRIES } from "../../../scripts/bench/profiles.ts";
import { parseBirthday } from "../../../src/lib/birthday";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const SEED = "test-seed";

/** Metres between two points, near enough for a few kilometres. */
function metres(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = (bLat - aLat) * 111_320;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function contact(over: Partial<BenchInput> = {}): BenchInput {
  return {
    id: "c-0001",
    name: "Christy Russel",
    firstName: "Christy",
    lastName: "Russel",
    company: "Strosin LLC",
    role: "Recruiter",
    headline: "Recruiter at Strosin LLC",
    industry: "Fintech",
    location: "Berlin, Germany",
    lat: 52.52,
    lng: 13.405,
    about:
      "Christy works on leverage open-source infrastructures. Previously at Runolfsdottir - Steuber. Enjoys climate tech.",
    website: null,
    birthday: null,
    pronouns: null,
    preferences: null,
    cadenceDays: 90,
    isTracked: 0,
    generic: true,
    interests: ["sailing", "chess"],
    emails: [
      { email: "christy.russel@gmail.com", label: "work", isPrimary: 1 },
    ],
    phones: ["\\+1 \\(808\\) 731-8496"],
    interactions: [],
    ...over,
  };
}

const plan = (over: Partial<BenchInput> = {}, seed = SEED) =>
  planEnrichment(contact(over), { seed, now: NOW });

describe("planEnrichment", () => {
  it("gives the same plan for the same contact, seed and clock, and another for another seed", () => {
    expect(plan()).toEqual(plan());
    expect(plan({}, "other-seed")).not.toEqual(plan());
  });

  it("gives every row it adds an id that marks it as the script's", () => {
    const ids = Object.values(plan({ id: "c-0042" }).add)
      .flat()
      .map((row) => row.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.startsWith("be-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("addresses", () => {
    it("puts a Berlin contact on a Berlin street, pinned in that neighbourhood", () => {
      const p = plan({ location: "Berlin, Germany" });
      const home = p.add.contact_addresses[0];
      expect(home.label).toBe("home");
      expect(home.isPrimary).toBe(1);
      expect(home.address).toMatch(/\d{5} Berlin$/);
      const hoods = CITIES.berlin.neighbourhoods!;
      expect(hoods.some((h) => home.address.startsWith(h.street))).toBe(true);
      const near = Math.min(
        ...hoods.map((h) =>
          metres(
            h.lat,
            h.lng,
            p.contact.lat as number,
            p.contact.lng as number,
          ),
        ),
      );
      expect(near).toBeLessThan(900);
      expect(p.contact.geoSource).toBe("geocoder");
    });

    it("writes a US address the way the US does", () => {
      const p = plan({ location: "San Francisco, CA, USA" });
      expect(p.add.contact_addresses[0].address).toMatch(
        /^\d+ .+, San Francisco, CA 941\d\d$/,
      );
    });

    it("places a town's pin beside the town's centre, whatever pin the contact has", () => {
      const [lat, lng] = CITIES.aarhus.centre!;
      for (const pin of [
        { lat: 56.1496, lng: 10.2045 },
        { lat: 0, lng: 0 },
      ]) {
        const p = plan({ location: "Aarhus", ...pin });
        expect(p.add.contact_addresses[0].address).toMatch(/\d{4} Aarhus$/);
        expect(
          metres(lat, lng, p.contact.lat as number, p.contact.lng as number),
        ).toBeLessThan(1300);
      }
    });

    it("draws again when a contact's second address repeats its first", () => {
      // c-316 is one such contact. A repeat would break the unique index.
      const texts = plan({ id: "c-316" }).add.contact_addresses.map(
        (a) => a.address,
      );
      expect(texts.length).toBeGreaterThan(1);
      expect(new Set(texts).size).toBe(texts.length);
    });

    it("writes an address for a city it does not know and leaves its pin, and none without a place", () => {
      const p = plan({ location: "Atlantis", lat: 10, lng: 20 });
      expect(p.add.contact_addresses[0].address).toContain("Atlantis");
      expect(p.contact).not.toHaveProperty("lat");
      expect(p.contact).not.toHaveProperty("lng");
      const nowhere = plan({ location: null, lat: null, lng: null });
      expect(nowhere.add.contact_addresses).toEqual([]);
      expect(nowhere.contact.lat).toBeUndefined();
    });

    it("knows every city the benchmark contacts live in, and the centre of every town", () => {
      const cities = [
        "Amsterdam, Netherlands",
        "Austin, TX, USA",
        "Bangalore, India",
        "Berlin, Germany",
        "Boston, MA, USA",
        "Chicago, IL, USA",
        "Dublin, Ireland",
        "Lisbon, Portugal",
        "London, UK",
        "Mexico City, Mexico",
        "Nairobi, Kenya",
        "New York, NY, USA",
        "Paris, France",
        "San Francisco, CA, USA",
        "Sao Paulo, Brazil",
        "Seattle, WA, USA",
        "Seoul, South Korea",
        "Singapore",
        "Stockholm, Sweden",
        "Sydney, Australia",
        "Tel Aviv, Israel",
        "Tokyo, Japan",
        "Toronto, Canada",
        "Zurich, Switzerland",
        "Aarhus",
        "Abuja",
        "Zagreb",
      ];
      for (const location of cities) {
        expect(CITIES[cityKey(location)!], location).toBeDefined();
      }
      for (const [key, city] of Object.entries(CITIES)) {
        if (!city.neighbourhoods) expect(city.centre, key).toBeDefined();
      }
    });
  });

  it("rewrites a generated contact's role, headline and about to fit its industry", () => {
    const p = plan({ industry: "Robotics" });
    expect(INDUSTRIES.Robotics.roles).toContain(p.contact.role);
    expect(p.contact.headline).toContain(p.contact.role as string);
    expect(p.contact.headline).toContain("Strosin LLC");
    expect(p.contact.about).not.toMatch(/works on .* Previously at/);
    expect((p.contact.about as string).length).toBeGreaterThan(60);
    // The identity stays.
    expect(p.contact).not.toHaveProperty("company");
    expect(p.contact).not.toHaveProperty("industry");
  });

  describe("phones and emails", () => {
    it("removes the backslashes the first seed left, and leaves a number that fits", () => {
      const seeded = "\\+1 \\(808\\) 731-8496";
      expect(
        plan({ location: "Austin, TX, USA", phones: [seeded] }).phoneFixes,
      ).toEqual([{ from: seeded, to: "+1 (808) 731-8496" }]);
      expect(plan({ phones: ["+49 151 12345678"] }).phoneFixes).toEqual([]);
    });

    it("gives a contact who lives elsewhere a local number in place of the seed's US one", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const p = plan({
          id: `c-${i}`,
          location: "Berlin, Germany",
          phones: ["\\+1 \\(808\\) 731-8496"],
        });
        expect(p.phoneFixes).toHaveLength(1);
        expect(p.phoneFixes[0].to).toMatch(/^\+49 1(51|60|70) \d{8}$/);
        seen.add(p.phoneFixes[0].to);
      }
      expect(seen.size).toBeGreaterThan(20);
    });

    it("labels a personal mail provider personal and a company address work", () => {
      const p = plan({
        emails: [
          { email: "a@gmail.com", label: "work", isPrimary: 1 },
          { email: "b@strosin.example", label: "personal", isPrimary: 0 },
        ],
      });
      expect(p.emailLabels).toContainEqual({
        email: "a@gmail.com",
        label: "personal",
      });
      expect(p.emailLabels).toContainEqual({
        email: "b@strosin.example",
        label: "work",
      });
    });

    it("writes phone numbers in the contact's country, from the city's area codes", () => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const p = plan({
          id: `c-${i}`,
          phones: [],
          location: "Austin, TX, USA",
        });
        for (const phone of p.add.contact_phones) {
          expect(phone.phone).toMatch(/^\+1 \((512|737)\) [2-9]\d\d-\d{4}$/);
          seen.add(phone.phone);
        }
      }
      expect(seen.size).toBeGreaterThan(5);
    });
  });

  it("adds a contact before its first interaction and never after the clock, and rewrites the Latin filler", () => {
    const old = { id: "old", type: "coffee", date: "2026-01-15T10:00:00.000Z" };
    for (let i = 0; i < 150; i++) {
      const p = plan({ id: `c-${i}`, interactions: i % 4 === 0 ? [old] : [] });
      const added = p.contact.addedAt as string;
      expect(added, `c-${i}`).toBeDefined();
      expect(added <= sqliteStamp(NOW)).toBe(true);
      const dates = p.add.interactions.map((x) => x.date);
      if (i % 4 === 0) {
        dates.push(old.date);
        expect(p.interactionRewrites).toEqual([
          expect.objectContaining({
            id: "old",
            content: expect.stringMatching(/^<p>.+<\/p>$/),
          }),
        ]);
        expect(p.contact.lastContactedAt).toBeDefined();
      }
      for (const date of dates)
        expect(added <= sqliteStamp(new Date(date))).toBe(true);
    }
  });

  it("varies a whole population, fills most fields for most people, and keeps each one valid", () => {
    const cities = [
      "Berlin, Germany",
      "Boston, MA, USA",
      "Tokyo, Japan",
      "Nairobi, Kenya",
      "Seoul, South Korea",
      "Aarhus",
      "London, UK",
      "Sao Paulo, Brazil",
    ];
    const industries = Object.keys(INDUSTRIES);
    const people = Array.from({ length: 480 }, (_, i) =>
      plan({
        id: `c-${String(i).padStart(4, "0")}`,
        name: `Person ${i}`,
        firstName: `Person${i}`,
        lastName: "Test",
        location: cities[i % cities.length],
        industry: industries[i % industries.length],
        lat: 50,
        lng: 10,
        emails: [],
        phones: [],
      }),
    );
    const share = (has: (p: BenchPlan) => boolean) =>
      people.filter(has).length / people.length;
    const distinct = (value: (p: BenchPlan) => unknown) =>
      new Set(people.map(value)).size;

    expect(distinct((p) => p.contact.about)).toBeGreaterThan(450);
    expect(distinct((p) => p.contact.role)).toBeGreaterThan(40);
    expect(distinct((p) => p.contact.headline)).toBeGreaterThan(300);
    // The pins spread around each city, not on one point.
    const berlin = people.filter((_, i) => i % cities.length === 0);
    expect(
      new Set(berlin.map((p) => `${p.contact.lat},${p.contact.lng}`)).size,
    ).toBeGreaterThan(50);

    // Most fields for most people, and gaps for some: [part, has it, above, below].
    const shares: [string, (p: BenchPlan) => boolean, number, number?][] = [
      ["an address", (p) => p.add.contact_addresses.length > 0, 0.95],
      ["two addresses", (p) => p.add.contact_addresses.length > 1, 0.3],
      ["a website", (p) => typeof p.contact.website === "string", 0.5, 0.75],
      // Fewer than most fields, so Pulse is not a wall of birthdays.
      ["a birthday", (p) => typeof p.contact.birthday === "string", 0.5, 0.78],
      ["tracked", (p) => p.contact.isTracked === 1, 0.2, 0.4],
      ["a link", (p) => p.add.contact_social_links.length > 0, 0.7],
      ["a school", (p) => p.add.contact_education.length > 0, 0.6],
      ["a job", (p) => p.add.contact_experience.length > 0, 0.8],
      ["a custom field", (p) => p.add.contact_attributes.length > 0, 0.3],
      // The counts follow their weights: a bound drawn again on every pass
      // gave 0.18, 0.13 and 0.32 here.
      ["two custom fields", (p) => p.add.contact_attributes.length > 1, 0.24],
      ["two earlier jobs", (p) => p.add.contact_experience.length > 2, 0.17],
      ["two new interests", (p) => p.add.contact_interests.length > 1, 0.38],
      ["no history", (p) => p.add.interactions.length === 0, 0.05],
      ["three notes", (p) => p.add.interactions.length >= 3, 0.3],
      // Added over years, and few in the last month.
      ["added a year ago", (p) => p.contact.addedAt! < "2025-09-30", 0.4],
      ["older than a month", (p) => p.contact.addedAt! < "2026-08-30", 0.88],
    ];
    for (const [part, has, above, below] of shares) {
      expect(share(has), part).toBeGreaterThan(above);
      if (below !== undefined) expect(share(has), part).toBeLessThan(below);
    }
    expect(people.flatMap((p) => p.add.action_items).length).toBeGreaterThan(5);

    const days = people
      .map((p) => p.contact.birthday)
      .filter((b): b is string => typeof b === "string");
    expect(days.every((b) => parseBirthday(b) !== null)).toBe(true);
    expect(days.some((b) => /^\d{4}-/.test(b))).toBe(true);
    expect(days.some((b) => /^\d{2}-\d{2}$/.test(b))).toBe(true);

    for (const { add, contact } of people) {
      const addresses = add.contact_addresses.map((a) => a.address);
      expect(new Set(addresses).size).toBe(addresses.length);
      expect(
        add.contact_addresses.filter((a) => a.isPrimary === 1),
      ).toHaveLength(1);
      const names = add.contact_attributes.map((a) => a.name);
      expect(new Set(names).size).toBe(names.length);
      // Work history ends in the current job.
      const current = add.contact_experience.filter((e) => e.isCurrent === 1);
      expect(current.length).toBeLessThanOrEqual(1);
      for (const e of add.contact_experience) {
        if (e.endDate) expect(e.endDate >= e.startDate).toBe(true);
      }
      // Never the same note twice, every one in the past, the newest the last contact.
      const notes = add.interactions.map(
        (x) => `${x.type}|${x.title}|${x.content}`,
      );
      expect(new Set(notes).size).toBe(notes.length);
      const dates = add.interactions.map((x) => x.date).sort();
      expect(dates.every((d) => new Date(d) <= NOW)).toBe(true);
      expect(contact.lastContactedAt).toBe(dates.at(-1));
      for (const item of add.action_items) {
        expect(item.title.length).toBeGreaterThan(3);
        expect(Number.isNaN(Date.parse(item.dueAt))).toBe(false);
      }
    }
  });
});
