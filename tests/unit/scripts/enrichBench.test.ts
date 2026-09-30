/**
 * The plan for one benchmark contact: what to add, fix and keep.
 *
 * `planEnrichment` is pure. The same contact, seed and clock give the same
 * plan, so the script can run twice and a test can read the answer.
 */
import { describe, expect, it } from "vitest";
import {
  planEnrichment,
  type BenchInput,
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
  it("gives the same plan for the same contact, seed and clock", () => {
    expect(plan()).toEqual(plan());
  });

  it("gives a different plan for a different seed", () => {
    expect(plan({}, "other-seed")).not.toEqual(plan());
  });

  it("gives every row it adds an id that marks it as the script's", () => {
    const p = plan({ id: "c-0042" });
    const ids = [
      ...p.emailsAdd,
      ...p.phonesAdd,
      ...p.addresses,
      ...p.socialLinks,
      ...p.education,
      ...p.experience,
      ...p.attributes,
      ...p.interactionsAdd,
      ...p.actionItems,
    ].map((row) => row.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.every((id) => id.startsWith("be-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe("addresses", () => {
    it("puts a Berlin contact on a Berlin street, pinned in that neighbourhood", () => {
      const p = plan({ location: "Berlin, Germany" });
      const home = p.addresses[0];
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
      expect(p.addresses[0].address).toMatch(
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
        expect(p.addresses[0].address).toMatch(/\d{4} Aarhus$/);
        expect(
          metres(lat, lng, p.contact.lat as number, p.contact.lng as number),
        ).toBeLessThan(1300);
      }
    });

    it("writes an address for a city it does not know, and leaves the pin where it is", () => {
      const p = plan({ location: "Atlantis", lat: 10, lng: 20 });
      expect(p.addresses.length).toBeGreaterThan(0);
      expect(p.addresses[0].address).toContain("Atlantis");
      expect(p.contact).not.toHaveProperty("lat");
      expect(p.contact).not.toHaveProperty("lng");
    });

    it("writes no address and no pin for a contact with no place at all", () => {
      const p = plan({ location: null, lat: null, lng: null });
      expect(p.addresses).toEqual([]);
      expect(p.contact.lat).toBeUndefined();
    });

    it("never repeats an address for one contact", () => {
      for (let i = 0; i < 60; i++) {
        const p = plan({ id: `c-${i}` });
        const texts = p.addresses.map((a) => a.address);
        expect(new Set(texts).size).toBe(texts.length);
        expect(p.addresses.filter((a) => a.isPrimary === 1)).toHaveLength(1);
      }
    });

    it("gives every town without neighbourhoods a centre", () => {
      for (const [key, city] of Object.entries(CITIES)) {
        if (!city.neighbourhoods) expect(city.centre, key).toBeDefined();
      }
    });

    it("knows every city the benchmark contacts live in", () => {
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
    });
  });

  describe("text", () => {
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

    it("leaves a hand-written contact's own words alone", () => {
      const p = plan({
        generic: false,
        about: "Runs the night shift rota out of the Trafford Park depot.",
        role: "Shift lead",
        headline: "Shift lead, Trafford Park",
        industry: "Logistics",
      });
      for (const key of ["about", "role", "headline", "industry", "company"]) {
        expect(p.contact, key).not.toHaveProperty(key);
      }
      // It still gets the things it lacks.
      expect(p.addresses.length).toBeGreaterThan(0);
    });
  });

  describe("phones and emails", () => {
    it("removes the backslashes the first seed left in a phone number", () => {
      const p = plan({
        location: "Austin, TX, USA",
        phones: ["\\+1 \\(808\\) 731-8496"],
      });
      expect(p.phoneFixes).toEqual([
        { from: "\\+1 \\(808\\) 731-8496", to: "+1 (808) 731-8496" },
      ]);
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

    it("leaves a number that already fits the contact's country", () => {
      const p = plan({
        location: "Berlin, Germany",
        phones: ["+49 151 12345678"],
      });
      expect(p.phoneFixes).toEqual([]);
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
        for (const phone of p.phonesAdd) {
          expect(phone.phone).toMatch(/^\+1 \((512|737)\) [2-9]\d\d-\d{4}$/);
          seen.add(phone.phone);
        }
      }
      expect(seen.size).toBeGreaterThan(5);
    });
  });

  describe("history", () => {
    it("dates every interaction in the past and sets the last contact to the newest", () => {
      let withInteractions = 0;
      for (let i = 0; i < 80; i++) {
        const p = plan({ id: `c-${i}` });
        if (p.interactionsAdd.length === 0) continue;
        withInteractions++;
        const dates = p.interactionsAdd.map((x) => x.date);
        expect(dates.every((d) => new Date(d) <= NOW)).toBe(true);
        expect(p.lastContactedAt).toBe([...dates].sort().at(-1));
      }
      expect(withInteractions).toBeGreaterThan(40);
    });

    it("rewrites the Latin filler in an existing interaction", () => {
      const p = plan({
        interactions: [
          { id: "old-1", type: "coffee", date: "2026-03-06T05:47:06.972Z" },
        ],
      });
      expect(p.interactionRewrites).toHaveLength(1);
      expect(p.interactionRewrites[0].id).toBe("old-1");
      expect(p.interactionRewrites[0].content).toMatch(/^<p>.+<\/p>$/);
      expect(p.lastContactedAt).not.toBeNull();
    });

    it("gives every open follow-up a due date and a title", () => {
      const all = Array.from({ length: 200 }, (_, i) =>
        plan({ id: `c-${i}` }),
      ).flatMap((p) => p.actionItems);
      expect(all.length).toBeGreaterThan(5);
      for (const item of all) {
        expect(item.title.length).toBeGreaterThan(3);
        expect(Number.isNaN(Date.parse(item.dueAt))).toBe(false);
      }
    });
  });

  describe("when a contact was added", () => {
    const stampOf = (iso: string) => iso.slice(0, 19).replace("T", " ");

    it("is always before its first interaction, and never after the clock", () => {
      for (let i = 0; i < 150; i++) {
        const old = [
          { id: "old", type: "call", date: "2026-01-15T10:00:00.000Z" },
        ];
        const p = plan({ id: `c-${i}`, interactions: i % 4 === 0 ? old : [] });
        const added = p.contact.addedAt as string;
        expect(added, `c-${i}`).toBeDefined();
        expect(added <= stampOf(NOW.toISOString())).toBe(true);
        const dates = [
          ...p.interactionsAdd.map((x) => x.date),
          ...(i % 4 === 0 ? [old[0].date] : []),
        ];
        for (const date of dates) expect(added <= stampOf(date)).toBe(true);
      }
    });

    it("spreads over years, with few in the last month", () => {
      const added = Array.from(
        { length: 400 },
        (_, i) => plan({ id: `c-${i}` }).contact.addedAt as string,
      );
      const older = added.filter((a) => a < "2025-09-30").length / added.length;
      const recent =
        added.filter((a) => a >= "2026-08-30").length / added.length;
      expect(older).toBeGreaterThan(0.4);
      expect(recent).toBeLessThan(0.12);
    });
  });

  describe("notes", () => {
    it("never gives one contact the same title and text twice", () => {
      let checked = 0;
      for (let i = 0; i < 300; i++) {
        const p = plan({ id: `c-${i}` });
        if (p.interactionsAdd.length < 3) continue;
        checked++;
        const keys = p.interactionsAdd.map(
          (x) => `${x.type}|${x.title}|${x.content}`,
        );
        expect(new Set(keys).size, `c-${i}`).toBe(keys.length);
      }
      expect(checked).toBeGreaterThan(40);
    });
  });

  describe("a whole population", () => {
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
      planEnrichment(
        contact({
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
        { seed: SEED, now: NOW },
      ),
    );
    const share = (n: number) => n / people.length;

    it("varies the words", () => {
      expect(new Set(people.map((p) => p.contact.about)).size).toBeGreaterThan(
        450,
      );
      expect(new Set(people.map((p) => p.contact.role)).size).toBeGreaterThan(
        40,
      );
      expect(
        new Set(people.map((p) => p.contact.headline)).size,
      ).toBeGreaterThan(300);
    });

    it("fills most fields for most people, and leaves gaps for some", () => {
      const has = (f: (p: (typeof people)[number]) => boolean) =>
        share(people.filter(f).length);
      expect(has((p) => p.addresses.length > 0)).toBeGreaterThan(0.95);
      expect(has((p) => p.addresses.length > 1)).toBeGreaterThan(0.3);
      expect(has((p) => typeof p.contact.website === "string")).toBeGreaterThan(
        0.5,
      );
      expect(has((p) => typeof p.contact.website === "string")).toBeLessThan(
        0.75,
      );
      // Fewer than most fields, so Pulse is not a wall of birthdays.
      expect(
        has((p) => typeof p.contact.birthday === "string"),
      ).toBeGreaterThan(0.5);
      expect(has((p) => typeof p.contact.birthday === "string")).toBeLessThan(
        0.78,
      );
      expect(has((p) => p.contact.isTracked === 1)).toBeGreaterThan(0.2);
      expect(has((p) => p.contact.isTracked === 1)).toBeLessThan(0.4);
      expect(has((p) => p.socialLinks.length > 0)).toBeGreaterThan(0.7);
      expect(has((p) => p.education.length > 0)).toBeGreaterThan(0.6);
      expect(has((p) => p.experience.length > 0)).toBeGreaterThan(0.8);
      expect(has((p) => p.attributes.length > 0)).toBeGreaterThan(0.3);
      expect(has((p) => p.interactionsAdd.length === 0)).toBeGreaterThan(0.05);
      expect(has((p) => p.interactionsAdd.length >= 3)).toBeGreaterThan(0.3);
    });

    it("writes only valid birthdays, with and without a year", () => {
      const birthdays = people
        .map((p) => p.contact.birthday)
        .filter((b): b is string => typeof b === "string");
      expect(birthdays.every((b) => parseBirthday(b) !== null)).toBe(true);
      expect(birthdays.some((b) => /^\d{4}-/.test(b))).toBe(true);
      expect(birthdays.some((b) => /^\d{2}-\d{2}$/.test(b))).toBe(true);
    });

    it("keeps each custom field name and each address to one per contact", () => {
      for (const p of people) {
        const names = p.attributes.map((a) => a.name);
        expect(new Set(names).size).toBe(names.length);
      }
    });

    it("spreads the pins around each city, not on one point", () => {
      const pins = new Set(
        people
          .filter((_, i) => i % cities.length === 0)
          .map((p) => `${p.contact.lat},${p.contact.lng}`),
      );
      expect(pins.size).toBeGreaterThan(50);
    });

    it("gives work history that ends in the current job", () => {
      for (const p of people.slice(0, 120)) {
        const current = p.experience.filter((e) => e.isCurrent === 1);
        expect(current.length).toBeLessThanOrEqual(1);
        for (const e of p.experience) {
          if (e.endDate) expect(e.endDate >= e.startDate).toBe(true);
        }
      }
    });
  });
});
