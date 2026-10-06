/**
 * The synthetic network: who `createNetwork` makes, and the plan that fills
 * each contact in.
 *
 * Both are pure. The same seed gives the same people and plans, so the
 * script can run twice and a test can read the answer.
 */
import { describe, expect, it } from "vitest";
import { allFakers } from "@faker-js/faker";
import {
  dice,
  planEnrichment,
  sqliteStamp,
  type BenchInput,
  type BenchPlan,
} from "../../../scripts/bench/plan.ts";
import { createNetwork } from "../../../scripts/bench/create.ts";
import { CITIES, COUNTRIES, cityKey } from "../../../scripts/bench/places.ts";
import { LOCAL_NAMES, localName } from "../../../scripts/bench/names.ts";
import {
  INDUSTRIES,
  INTERACTION_TOPICS,
  PRONOUNS,
  TAGS,
} from "../../../scripts/bench/profiles.ts";
import { defaultAvatarUrl } from "../../../server/utils/avatarUrl.ts";
import { classifyName } from "../../../server/utils/smartAvatar.ts";
import { parseBirthday } from "../../../shared/birthday.ts";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const SEED = "test-seed";
const FACE = defaultAvatarUrl("Christy Russel");

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
    about: "Hires the payments team at Strosin. Knows everyone in Berlin.",
    website: null,
    birthday: null,
    pronouns: null,
    preferences: null,
    avatarUrl: FACE,
    cadenceDays: 90,
    isTracked: 0,
    interests: ["sailing", "chess"],
    emails: ["christy.russel@gmail.com"],
    phones: [],
    interactions: [],
    ...over,
  };
}

const plan = (over: Partial<BenchInput> = {}, seed = SEED) =>
  planEnrichment(contact(over), { seed, now: NOW });

/** The postcode at the end of a town's address, before or after its name. */
function postcodeOf(address: string, town: string, zipFirst: boolean) {
  const last = address.slice(address.lastIndexOf(", ") + 2);
  return zipFirst
    ? last.slice(0, -town.length - 1)
    : last.slice(town.length + 1);
}

/** Every postcode format the towns use, as the postal services write them. */
const FORMATS: [RegExp, string[]][] = [
  [/^\d{4}$/, ["AT", "BE", "CH", "DK", "HU", "NO", "SI"]],
  [/^\d{5}$/, ["DE", "EE", "ES", "FI", "FR", "HR", "IT"]],
  [/^\d{6}$/, ["NG"]],
  [/^\d{3} \d{2}$/, ["CZ", "GR", "SE", "SK"]],
  [/^\d{2}-\d{3}$/, ["PL"]],
  [/^\d{4}-\d{3}$/, ["PT"]],
  [/^\d{3}-\d{4}$/, ["JP"]],
  [/^\d{4} [A-Z]{2}$/, ["NL"]],
  [/^LV-\d{4}$/, ["LV"]],
  [/^LT-\d{5}$/, ["LT"]],
  [/^[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/, ["GB"]],
  [/^[A-Z]\d{2} [A-Z\d]{4}$/, ["IE"]],
];

/** A template as a pattern, each blank matching any words. */
const templatePattern = (template: string) =>
  new RegExp(
    `^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, ".+")}$`,
  );

/** Whether a note's title and body belong to one topic. */
const fromOneTopic = (type: string, title: string, content: string) =>
  INTERACTION_TOPICS[type].some(
    (topic) =>
      templatePattern(topic.title).test(title) &&
      topic.body.some((body) =>
        templatePattern(`<p>${body}</p>`).test(content),
      ),
  );

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

    it("writes each town's postcode from its real prefix, in its country's format", () => {
      const towns = Object.entries(CITIES).filter(([, city]) => city.zip);
      expect(towns).toHaveLength(54);
      for (const [key, city] of towns) {
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        const { zipFirst } = COUNTRIES[city.country];
        const [format] = FORMATS.find(([, codes]) =>
          codes.includes(city.country),
        )!;
        for (let i = 0; i < 4; i++) {
          const { address } = plan({ id: `t-${i}`, location: name }).add
            .contact_addresses[0];
          const zip = postcodeOf(address, name, zipFirst);
          expect(zip.startsWith(city.zip!), address).toBe(true);
          expect(zip, address).toMatch(format);
        }
      }
    });

    it("writes a postcode with the letters its country uses, and none it leaves out", () => {
      // [where, the end of every address there]
      const rules: [string, RegExp, number][] = [
        // A UK inward code never has C, I, K, M, O or V.
        ["London, UK", / \d[ABD-HJLNP-UW-Z]{2}$/, 300],
        // An Eircode's identifier uses the ten digits and fifteen letters.
        ["Dublin, Ireland", / [A-Z]\d{2} [\dACDEFHKNPRTVWXY]{4}$/, 300],
        // Canada Post never uses D, F, I, O, Q or U.
        ["Toronto, ON, Canada", / [A-Z]\d[A-Z] \d[ABCEGHJ-NPRSTV-Z]\d$/, 300],
        // PostNL never ends a postcode in SA, SD or SS, which 3 in 676
        // random pairs do, so this place draws many.
        [
          "Amsterdam, Netherlands",
          /, \d{4} (?!S[ADS])[A-Z]{2} Amsterdam$/,
          2500,
        ],
      ];
      for (const [location, rule, count] of rules)
        for (let i = 0; i < count; i++)
          for (const { address } of plan({ id: `z-${i}`, location }).add
            .contact_addresses)
            expect(address, location).toMatch(rule);
    });

    it("puts a town faker has no streets for on one of its real main streets", () => {
      for (const town of ["athens", "sapporo", "tallinn", "vilnius"]) {
        const { streets } = CITIES[town];
        expect(streets?.length, town).toBeGreaterThan(3);
        const name = town.charAt(0).toUpperCase() + town.slice(1);
        for (let i = 0; i < 20; i++)
          for (const { address } of plan({ id: `r-${i}`, location: name }).add
            .contact_addresses)
            expect(
              streets!.some((street) => address.includes(street)),
              address,
            ).toBe(true);
      }
      // A Lithuanian postcode comes before the town: "LT-01103 Vilnius".
      const [vilnius] = plan({ location: "Vilnius" }).add.contact_addresses;
      expect(vilnius.address).toMatch(/, LT-\d{5} Vilnius$/);
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
      expect(p.add.contact_addresses[0].address).toMatch(
        /^\d+ .+, Atlantis \d{5}$/,
      );
      expect(p.contact).not.toHaveProperty("lat");
      expect(p.contact).not.toHaveProperty("lng");
      for (const location of [null, " , Spain"]) {
        const nowhere = Array.from({ length: 12 }, (_, i) =>
          plan({ id: `n-${i}`, location, lat: null, lng: null }),
        );
        for (const p of nowhere) {
          expect(p.add.contact_addresses).toEqual([]);
          expect(p.contact.lat).toBeUndefined();
        }
        const jobs = nowhere.flatMap((p) => p.add.contact_experience);
        expect(jobs.length).toBeGreaterThan(12);
        expect(jobs.every((job) => job.location === null)).toBe(true);
      }
    });

    it("knows every city the benchmark contacts live in, and the centre and prefix of every town", () => {
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
        if (city.neighbourhoods) continue;
        expect(city.centre, key).toBeDefined();
        expect(city.zip, key).toBeTruthy();
      }
    });
  });

  it("fills empty words from the industry, the role and the company, and keeps the words a contact has", () => {
    const own = plan({ industry: "Robotics", headline: null, about: null });
    expect(own.contact.headline).toContain("Recruiter");
    expect(own.contact.headline).toContain("Strosin LLC");
    expect(own.contact.about).toContain("Strosin LLC");
    expect(own.contact).not.toHaveProperty("role");
    expect(own.contact).not.toHaveProperty("company");
    const empty = plan({
      industry: "Robotics",
      role: null,
      company: null,
      headline: null,
      about: null,
    });
    expect(INDUSTRIES.Robotics.roles).toContain(empty.contact.role);
    expect(empty.contact.headline).toContain(empty.contact.role as string);
    expect(empty.contact.headline).toContain(empty.contact.company as string);
    expect((empty.contact.about as string).length).toBeGreaterThan(40);
    // An industry the table does not know gets the general words.
    const general = plan({ industry: null, role: null, headline: null });
    expect(general.contact.headline).toContain(general.contact.role as string);
    // A contact with all its words keeps them, and so does its identity.
    const kept = plan({ industry: "Robotics" });
    for (const key of ["role", "headline", "about", "company", "industry"])
      expect(kept.contact).not.toHaveProperty(key);
  });

  it("makes handles from the name, in plain letters, when the contact has no first and last name", () => {
    const links = Array.from(
      { length: 6 },
      (_, i) =>
        plan({
          id: `h-${i}`,
          name: "Søren Łukasiewicz",
          firstName: null,
          lastName: null,
        }).add.contact_social_links,
    ).flat();
    expect(links.some((link) => link.platform === "linkedin")).toBe(true);
    for (const { platform, handle } of links)
      expect(handle).toMatch(
        platform === "linkedin"
          ? /^soren-lukasiewicz-[0-9a-f]{6}$/
          : /^sorenlukasiewicz[0-9a-f]{3}$/,
      );
  });

  it("gives some contacts that have an email or a phone a second one, of the other kind", () => {
    for (const [email, label] of [
      ["christy@strosin.example", "personal"],
      ["christy.russel@gmail.com", "work"],
    ]) {
      const added = Array.from(
        { length: 30 },
        (_, i) =>
          plan({ id: `s-${i}`, emails: [email], phones: ["+49 151 12345678"] })
            .add,
      );
      const mails = added.flatMap((add) => add.contact_emails);
      expect(mails.length).toBeGreaterThan(3);
      for (const mail of mails)
        expect(mail).toMatchObject({ label, isPrimary: 0, sortOrder: 1 });
      const phones = added.flatMap((add) => add.contact_phones);
      expect(phones.length).toBeGreaterThan(0);
      for (const phone of phones)
        expect(phone).toMatchObject({
          phone: expect.stringMatching(/^\+49 1(51|60|70) \d{8}$/),
          isPrimary: 0,
          sortOrder: 1,
        });
    }
  });

  it("keeps the default face in step with the pronouns, and leaves a face somebody chose", () => {
    const people = Array.from({ length: 40 }, (_, i) => plan({ id: `p-${i}` }));
    const given = people.filter((p) => p.contact.pronouns);
    expect(given.length).toBeGreaterThan(4);
    for (const p of given)
      expect(p.contact.avatarUrl).toBe(
        defaultAvatarUrl("Christy Russel", p.contact.pronouns),
      );
    for (const p of people.filter((p) => !p.contact.pronouns))
      expect(p.contact).not.toHaveProperty("avatarUrl");
    // Pronouns the contact has, on a face drawn before it had them.
    const she = defaultAvatarUrl("Christy Russel", "she/her");
    expect(plan({ pronouns: "she/her" }).contact.avatarUrl).toBe(she);
    for (const avatarUrl of [she, "/uploads/photo.webp"])
      expect(
        plan({ pronouns: "she/her", avatarUrl }).contact,
      ).not.toHaveProperty("avatarUrl");
  });

  it("gives pronouns that follow the name, so the face and the pronouns agree", () => {
    const planned = createNetwork(400, SEED, "benchseed").map(
      ({ contact }) => ({
        name: contact.name,
        pronouns: planEnrichment(
          {
            ...contact,
            interests: [],
            emails: [],
            phones: [],
            interactions: [],
          },
          { seed: SEED, now: NOW },
        ).contact.pronouns,
      }),
    );
    const given = planned.filter((p) => p.pronouns);
    expect(given.length).toBeGreaterThan(60);
    for (const { name, pronouns } of given)
      expect(pronouns, name).toBe(PRONOUNS[classifyName(name)]);
    // Each of the three, where a name calls for it.
    expect(new Set(given.map((p) => p.pronouns))).toEqual(
      new Set(Object.values(PRONOUNS)),
    );
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

  it("adds a contact before its first note, edits it after, and never repeats a note it has", () => {
    const old = {
      type: "call",
      title: "Quick catch-up",
      content: "<p>Nothing new.</p>",
      date: "2026-01-15T10:00:00.000Z",
    };
    for (let i = 0; i < 150; i++) {
      const p = plan({ id: `c-${i}`, interactions: i % 4 === 0 ? [old] : [] });
      const { addedAt, updatedAt } = p.contact;
      expect(addedAt <= updatedAt && updatedAt <= sqliteStamp(NOW)).toBe(true);
      const dates = p.add.interactions.map((x) => x.date);
      if (i % 4 === 0) {
        dates.push(old.date);
        expect(p.contact.lastContactedAt).toBeDefined();
      }
      for (const date of dates)
        expect(addedAt <= sqliteStamp(new Date(date))).toBe(true);
    }
    // A note dated after the clock moves neither date past it.
    const ahead = plan({
      interactions: [{ ...old, date: "2027-01-01T09:00:00.000Z" }],
    }).contact;
    expect(ahead.lastContactedAt).toBe(NOW.toISOString());
    expect(ahead.addedAt < sqliteStamp(NOW)).toBe(true);
    // The note a plan writes first, given the contact already has one. Then
    // the contact has that very note.
    const [once] = plan({ id: "c-1", interactions: [old] }).add.interactions;
    const [twice] = plan({ id: "c-1", interactions: [{ ...once }] }).add
      .interactions;
    expect(twice.type).toBe(once.type);
    expect([twice.title, twice.content]).not.toEqual([
      once.title,
      once.content,
    ]);
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
        role: null,
        headline: null,
        about: null,
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
      ["an email", (p) => p.add.contact_emails.length > 0, 0.65, 0.85],
      ["a phone", (p) => p.add.contact_phones.length > 0, 0.45, 0.65],
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
      ["added a year ago", (p) => p.contact.addedAt < "2025-09-30", 0.4],
      ["older than a month", (p) => p.contact.addedAt < "2026-08-30", 0.88],
    ];
    for (const [part, has, above, below] of shares) {
      expect(share(has), part).toBeGreaterThan(above);
      if (below !== undefined) expect(share(has), part).toBeLessThan(below);
    }
    expect(people.flatMap((p) => p.add.action_items).length).toBeGreaterThan(5);
    // Every template's blanks are filled.
    const words = people.flatMap(({ add, contact }) => [
      contact.headline,
      contact.about,
      ...add.interactions.flatMap((x) => [x.title, x.content]),
      ...add.action_items.map((x) => x.title),
    ]);
    expect(words.join("\n")).not.toMatch(/undefined|[{}]/);
    // Each note's title and body come from one topic, so a "Breakfast" never
    // reads as a long walk.
    for (const { add } of people)
      for (const x of add.interactions)
        expect(
          fromOneTopic(x.type, x.title!, x.content),
          `${x.title}: ${x.content}`,
        ).toBe(true);

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

describe("createNetwork", () => {
  it("makes the same people from the same seed, ids included, and the first of them for a smaller count", () => {
    const people = createNetwork(60, SEED, "benchseed");
    expect(createNetwork(60, SEED, "benchseed")).toEqual(people);
    expect(createNetwork(25, SEED, "benchseed")).toEqual(people.slice(0, 25));
    expect(createNetwork(60, "other-seed", "benchseed")[0]).not.toEqual(
      people[0],
    );
    for (const { contact } of people)
      expect(contact.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    expect(new Set(people.map((p) => p.contact.id)).size).toBe(60);
  });

  it("gives each person a city from the table, a name in its language, an industry, a company, a role and a few tags", () => {
    const people = createNetwork(1500, SEED, "benchseed");
    expect(new Set(people.map((p) => p.contact.name)).size).toBe(1500);
    const keys = new Set<string>();
    for (const { contact, tags } of people) {
      const key = cityKey(contact.location)!;
      const city = CITIES[key];
      keys.add(key);
      const local = LOCAL_NAMES[city.country];
      if (local) {
        // Faker has no Latin-script names there, so the country's own list.
        const group = local.find((g) =>
          [...g.female, ...g.male].includes(contact.firstName!),
        );
        expect(group, contact.name).toBeDefined();
        const female = group!.female.includes(contact.firstName!);
        expect(
          group!.surnames.map((s) => (typeof s === "string" ? s : s[+female])),
          contact.name,
        ).toContain(contact.lastName);
      } else {
        const { locale = "en" } = COUNTRIES[city.country];
        const names = allFakers[locale].rawDefinitions.person!.first_name!;
        const firstNames = [names.generic, names.female, names.male].flat();
        expect(firstNames, contact.name).toContain(contact.firstName);
      }
      expect(contact.name).toBe(`${contact.firstName} ${contact.lastName}`);
      // Two surnames run together get a hyphen: "Hohoš-Babić".
      expect(contact.lastName).not.toMatch(/\p{Lu}\p{Ll}{3,}\p{Lu}/u);
      const { roles, nouns } = INDUSTRIES[contact.industry!];
      expect(roles).toContain(contact.role);
      expect(nouns).toContain(contact.company!.replace(/^\S+ /, ""));
      const [own, ...more] = tags;
      expect(own).toBe("benchseed");
      expect(more.length).toBeGreaterThanOrEqual(1);
      expect(more.length).toBeLessThanOrEqual(3);
      expect(new Set(more).size).toBe(more.length);
      expect(more.every((tag) => TAGS.includes(tag))).toBe(true);
      expect(contact.avatarUrl).toBe(defaultAvatarUrl(contact.name));
      expect(contact.phoneticHash).toMatch(/^[A-Z0]{1,4}$/);
    }
    // Every city appears, and the planner gives each person a real address.
    expect(keys.size).toBe(Object.keys(CITIES).length);
    const locations = new Set(people.map((p) => p.contact.location));
    for (const location of ["Boston, MA, US", "Valencia, Spain", "Singapore"])
      expect(locations).toContain(location);
    // A run's own tag is never drawn a second time.
    for (const { tags } of createNetwork(60, SEED, "mentor"))
      expect(tags.filter((tag) => tag === "mentor")).toEqual(["mentor"]);
    // Every country faker has no Latin-script names for has a list, and
    // the people there take theirs from it.
    for (const [code, country] of Object.entries(COUNTRIES))
      expect(!!country.locale !== !!LOCAL_NAMES[code], code).toBe(true);
    expect(
      people.filter(
        (p) => LOCAL_NAMES[CITIES[cityKey(p.contact.location)!].country],
      ).length,
    ).toBeGreaterThan(100);
    // A Greek or a Lithuanian surname takes its female form for a woman.
    for (const code of ["GR", "LT"]) {
      const [group] = LOCAL_NAMES[code]!;
      for (let i = 0; i < 100; i++) {
        const { firstName, lastName } = localName([group], dice(`n-${i}`));
        const pair = group.surnames.find(
          (s) => typeof s !== "string" && s.includes(lastName),
        );
        if (pair)
          expect(lastName, `${firstName} ${lastName}`).toBe(
            pair[+group.female.includes(firstName)],
          );
      }
    }
    // Faker's Croatian surnames join some pairs with no space. Person 3039 of
    // the default network is one, "DuvnjakČuljak".
    const joined = createNetwork(3040, "contrack-bench", "benchseed")[3039];
    expect(joined.contact.name).toBe("Nela Duvnjak-Čuljak");
    for (const { contact } of people.slice(0, 200)) {
      const filled = planEnrichment(
        { ...contact, interests: [], emails: [], phones: [], interactions: [] },
        { seed: SEED, now: NOW },
      );
      expect(filled.add.contact_addresses.length).toBeGreaterThan(0);
      expect(filled.contact.geoSource).toBe("geocoder");
    }
  });
});
