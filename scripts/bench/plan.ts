/**
 * The plan for one synthetic benchmark contact: what to add and what to keep.
 *
 * `planEnrichment` is pure. The same contact, seed and clock give the same
 * plan, so the script can run again and change nothing, and a test can read
 * the answer. The runner (`run.ts`) writes the plan.
 *
 * Nothing here is real. Streets and neighbourhoods are real places, with
 * invented house numbers, and every person is made up. See `places.ts`.
 *
 * @module scripts/bench/plan
 */
import { createHash } from "node:crypto";
import { allFakers } from "@faker-js/faker";
import {
  defaultAvatarUrl,
  isDefaultAvatarFor,
} from "../../server/utils/avatarUrl.ts";
import { classifyName } from "../../server/utils/smartAvatar.ts";
import {
  CITIES,
  COUNTRIES,
  cityKey,
  type City,
  type Country,
} from "./places.ts";
import {
  ATTRIBUTES,
  BEST_TIMES,
  CHANNELS,
  COMPANY_FIRST,
  DEGREES,
  FIELDS,
  INTERACTION_TOPICS,
  INTERESTS,
  PRONOUNS,
  SCHOOLS,
  SOCIAL_PLATFORMS,
  TASKS,
  industryFor,
} from "./profiles.ts";

/** A contact's own columns, as the script reads them. */
export interface BenchContact {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  role: string | null;
  headline: string | null;
  industry: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  about: string | null;
  website: string | null;
  birthday: string | null;
  pronouns: string | null;
  preferences: string | null;
  avatarUrl: string | null;
  cadenceDays: number | null;
  isTracked: number;
}

/** What the script needs to know about one contact before it plans. */
export interface BenchInput extends BenchContact {
  interests: string[];
  emails: string[];
  phones: string[];
  /** Notes it already has. Their dates bound the history, and no new note repeats one. */
  interactions: {
    type: string;
    title: string | null;
    content: string | null;
    date: string;
  }[];
}

export interface PlanOptions {
  /** Changes every choice. The same seed gives the same contacts back. */
  seed: string;
  now: Date;
}

/** A row with an id and these text columns. */
type Row<K extends string> = { id: string } & Record<K, string>;
/** One of a contact's emails, phones or addresses. */
type ListRow<K extends string> = Row<K | "label"> & {
  isPrimary: number;
  sortOrder: number;
};
type ExperienceRow = Row<"company" | "role" | "startDate"> & {
  endDate: string | null;
  isCurrent: number;
  location: string | null;
};

/** The rows a plan adds, by table. Each row uses the table's column names. */
export interface BenchRows {
  contact_emails: ListRow<"email">[];
  contact_phones: ListRow<"phone">[];
  contact_addresses: ListRow<"address">[];
  contact_social_links: Row<"platform" | "url" | "handle">[];
  contact_education: Row<
    "school" | "degree" | "fieldOfStudy" | "startDate" | "endDate"
  >[];
  contact_experience: ExperienceRow[];
  contact_interests: Row<"interest">[];
  contact_attributes: Row<"name" | "value">[];
  interactions: Row<"type" | "title" | "content" | "date">[];
  action_items: (Row<"title" | "dueAt"> & { completedAt: string | null })[];
}

/** The columns of `contacts` a plan may set. */
type ContactColumns = Omit<
  BenchContact,
  "id" | "name" | "firstName" | "lastName" | "industry" | "location"
> &
  Record<"geoSource" | "trackedAt" | "lastContactedAt", string>;

export interface BenchPlan {
  /**
   * Columns of `contacts` to set. A key that is absent stays as it is. The
   * name, the industry and the location are who the contact is, and stay.
   * Every plan dates the contact.
   */
  contact: Partial<ContactColumns> & Record<"addedAt" | "updatedAt", string>;
  /** Rows to add. A run removes the ones it added before, by their `be-` id. */
  add: BenchRows;
}

/** A date as the database writes one: "2026-09-30 12:00:00". */
export const sqliteStamp = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");

// ─── Randomness ────────────────────────────────────────────────────────────

export function hash32(text: string): number {
  return createHash("sha1").update(text).digest().readUInt32BE(0);
}

/** A small seeded generator. The same seed gives the same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Dice {
  next: () => number;
  chance: (p: number) => boolean;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
}

export function dice(seed: string): Dice {
  const next = mulberry32(hash32(seed));
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  return {
    next,
    chance: (p) => next() < p,
    int,
    pick: (items) => items[int(0, items.length - 1)],
    weighted: (entries) => {
      const total = entries.reduce((sum, [, w]) => sum + w, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1][0];
    },
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Fill a pattern: `#` a digit, `N` a digit 2 to 9, `A` one of `letters`, `@`
 * the value given.
 */
function fillPattern(
  pattern: string,
  d: Dice,
  value = "",
  letters = LETTERS,
): string {
  return [...pattern]
    .map((ch) => {
      if (ch === "#") return String(d.int(0, 9));
      if (ch === "N") return String(d.int(2, 9));
      if (ch === "A") return letters[d.int(0, letters.length - 1)];
      if (ch === "@") return value;
      return ch;
    })
    .join("");
}

// ─── Small helpers ─────────────────────────────────────────────────────────

/** Letters that no accent folds away, written in the letters of English. */
const PLAIN: Record<string, string> = {
  ø: "o",
  æ: "ae",
  ł: "l",
  đ: "d",
  ß: "ss",
  œ: "oe",
  þ: "th",
  ı: "i",
};

const slug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[øæłđßœþı]/g, (ch) => PLAIN[ch])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const letters = (text: string): string => slug(text).replace(/-/g, "");

const capitalise = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

const PERSONAL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "me.com",
  "live.com",
]);

/** "personal" for an address at a mail provider, "work" for any other. */
const labelFor = (email: string) =>
  PERSONAL_DOMAINS.has(email.slice(email.indexOf("@") + 1).toLowerCase())
    ? "personal"
    : "work";

const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 86_400_000);

/** A row id that marks the row as the script's, and is the same on every run. */
function rowId(seed: string, contactId: string, kind: string, index: number) {
  const digest = createHash("sha1")
    .update(`${seed}:${contactId}:${kind}:${index}`)
    .digest("hex");
  return `be-${digest.slice(0, 20)}`;
}

/** An invented company name in an industry: "Halcyon Robotics". */
export function companyName(d: Dice, nouns: readonly string[]): string {
  return `${d.pick(COMPANY_FIRST)} ${d.pick(nouns)}`;
}

// ─── Places ────────────────────────────────────────────────────────────────

/** For a city the tables do not list: a plain address in a plain format. */
const FALLBACK_COUNTRY: Country = {
  calling: "",
  numberAfter: false,
  zipFirst: false,
  zip: "#####",
  phones: ["+## ## ### ####"],
};

interface Place {
  /** The city as the contact's location writes it. */
  name: string;
  city: City | null;
  country: Country;
}

function placeOf(input: BenchInput): Place | null {
  const key = cityKey(input.location);
  if (!key) return null;
  const city = CITIES[key] ?? null;
  return {
    name: input.location!.split(",")[0].trim(),
    city,
    country: city ? COUNTRIES[city.country] : FALLBACK_COUNTRY,
  };
}

/**
 * A postcode that starts with a place's prefix, in its country's format and
 * with the letters it uses. One that ends as the country's never do is drawn
 * again.
 */
function postcode(prefix: string, country: Country, d: Dice): string {
  const letters = country.zipLetters ?? LETTERS;
  for (;;) {
    const zip = country.zip.includes("@")
      ? fillPattern(country.zip, d, prefix, letters)
      : prefix + fillPattern(country.zip.slice(prefix.length), d, "", letters);
    // A whole postcode from the table has nothing to draw again.
    if (zip === prefix || !country.zipNever?.some((end) => zip.endsWith(end)))
      return zip;
  }
}

/** A point within `radiusM` metres of a centre, most of them near it. */
function jitter(
  lat: number,
  lng: number,
  radiusM: number,
  d: Dice,
): { lat: number; lng: number } {
  const angle = d.next() * 2 * Math.PI;
  const distance = radiusM * Math.sqrt(d.next());
  const dLat = (distance * Math.cos(angle)) / 111_320;
  const dLng =
    (distance * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Math.round((lat + dLat) * 1e5) / 1e5,
    lng: Math.round((lng + dLng) * 1e5) / 1e5,
  };
}

function houseNumber(countryCode: string | undefined, d: Dice): string {
  if (countryCode === "US" || countryCode === "CA")
    return String(d.int(100, 3900));
  if (countryCode === "JP")
    return `${d.int(1, 5)}-${d.int(1, 30)}-${d.int(1, 20)}`;
  return String(d.int(1, 160));
}

function formatAddress(
  place: Place,
  number: string,
  street: string,
  zip: string,
): string {
  const { country, name } = place;
  const line = country.numberAfter
    ? `${street} ${number}`
    : `${number} ${street}`;
  if (country.zipFirst) return `${line}, ${zip} ${name}`;
  if (place.city?.region)
    return `${line}, ${name}, ${place.city.region} ${zip}`;
  return `${line}, ${name} ${zip}`;
}

interface Spot {
  address: string;
  pin: { lat: number; lng: number } | null;
  /** The neighbourhood's name, or the city when there is none. */
  area: string;
}

/** One address in the contact's city, and where its pin stands. */
function spotIn(
  place: Place,
  d: Dice,
  salt: string,
  avoid: Set<string>,
): Spot | null {
  const code = place.city?.country;
  const hoods = place.city?.neighbourhoods;
  for (let attempt = 0; attempt < 6; attempt++) {
    let spot: Spot;
    if (hoods && hoods.length > 0) {
      const hood = d.pick(hoods);
      const zip = postcode(hood.zip, place.country, d);
      const pin = jitter(hood.lat, hood.lng, 350, d);
      const number = houseNumber(code, d);
      spot = {
        address: formatAddress(place, number, hood.street, zip),
        pin,
        area: hood.name,
      };
    } else {
      // A real main street when the table lists the town's, since faker
      // has no locale to name one in Athens, Sapporo, Tallinn or Vilnius.
      const streets = place.city?.streets;
      const faker = allFakers[place.country.locale ?? "en"];
      faker.seed(hash32(`${salt}:${attempt}`));
      const street = streets ? d.pick(streets) : faker.location.street();
      // The table's centre, never the contact's own pin: a run moves the pin,
      // and a second run would drift from it. A city the table does not know
      // keeps the pin it has.
      const centre = place.city?.centre;
      const pin = centre ? jitter(centre[0], centre[1], 1800, d) : null;
      const number = houseNumber(code, d);
      const zip = postcode(place.city?.zip ?? "", place.country, d);
      spot = {
        address: formatAddress(place, number, street, zip),
        pin,
        area: place.name,
      };
    }
    if (!avoid.has(spot.address)) return spot;
  }
  return null;
}

// ─── Text ──────────────────────────────────────────────────────────────────

function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key]);
}

// ─── The plan ──────────────────────────────────────────────────────────────

export function planEnrichment(
  input: BenchInput,
  options: PlanOptions,
): BenchPlan {
  const { seed, now } = options;
  // One stream for each part of the plan, keyed by its name. A field that is
  // already filled skips its own draws and nobody else's, so the plan for a
  // contact does not change when an earlier run has filled part of it.
  const stream = (name: string) => dice(`${seed}:${input.id}:${name}`);
  const id = (kind: string, index: number) =>
    rowId(seed, input.id, kind, index);
  const industry = industryFor(input.industry);
  const first = input.firstName || input.name.split(" ")[0];
  const lastName = input.lastName || input.name.split(" ").slice(1).join(" ");
  const place = placeOf(input);

  // The tables in the order the script writes them.
  const add: BenchRows = {
    contact_emails: [],
    contact_phones: [],
    contact_addresses: [],
    contact_social_links: [],
    contact_education: [],
    contact_experience: [],
    contact_interests: [],
    contact_attributes: [],
    interactions: [],
    action_items: [],
  };
  const contact: Partial<ContactColumns> = {};

  // Addresses, and the pin that follows the primary one.
  const dAddr = stream("dAddr");
  let area = place?.name ?? "";
  if (place) {
    const used = new Set<string>();
    const kinds: { label: string; chance: number }[] = [
      { label: "home", chance: 1 },
      { label: "work", chance: 0.55 },
      { label: "other", chance: 0.1 },
    ];
    for (const kind of kinds) {
      if (!dAddr.chance(kind.chance)) continue;
      const spot = spotIn(
        place,
        dAddr,
        `${seed}:${input.id}:${kind.label}`,
        used,
      );
      if (!spot) continue;
      used.add(spot.address);
      const isPrimary = add.contact_addresses.length === 0 ? 1 : 0;
      add.contact_addresses.push({
        id: id("address", add.contact_addresses.length),
        address: spot.address,
        label: kind.label,
        isPrimary,
        sortOrder: add.contact_addresses.length,
      });
      if (isPrimary === 1) {
        area = spot.area;
        if (spot.pin) {
          contact.lat = spot.pin.lat;
          contact.lng = spot.pin.lng;
          contact.geoSource = "geocoder";
        }
      }
    }
  }

  // Interests first, because the text refers to them. Each loop's count is
  // drawn once, before it: a bound in the loop's test is drawn again on
  // every pass, which gave custom fields 40/42/16/2 percent, not 40/30/20/10.
  const dInt = stream("dInt");
  const interests = [...input.interests];
  const newInterests = dInt.int(0, 3);
  for (let i = 0; i < newInterests; i++) {
    const interest = dInt.pick(INTERESTS);
    if (interests.includes(interest)) continue;
    interests.push(interest);
    add.contact_interests.push({ id: id("interest", i), interest });
  }

  // Words: a role, a headline and an about that fit the industry, and the
  // role and company the contact already has.
  const dText = stream("dText");
  const focus = [...industry.focus];
  const focus1 = focus.splice(dText.int(0, focus.length - 1), 1)[0];
  const focus2 = focus.splice(dText.int(0, focus.length - 1), 1)[0];
  const drawnRole = dText.pick(industry.roles);
  const role = input.role || drawnRole;
  const company = input.company || companyName(dText, industry.nouns);
  const previous = companyName(dText, industry.nouns);
  const interest1 = interests[0] ?? dText.pick(INTERESTS);
  const interest2 = interests[1] ?? dText.pick(INTERESTS);
  const years = dText.int(2, 14);
  const headlines = [
    `${role} at ${company}`,
    `${role} at ${company} · ${focus1}`,
    `${role}, ${company} | ${focus1} and ${focus2}`,
    `${capitalise(focus1)} · ${role} @ ${company}`,
    `${company} · ${role} · ${focus1}`,
  ];
  const abouts = [
    `${first} is ${/^[AEIOU]/i.test(role) ? "an" : "a"} ${role.toLowerCase()} at ${company}, focused on ${focus1} and ${focus2}. Based in ${area}.`,
    `${years} years at ${company}, after ${previous}. Now works on ${focus1}. Outside work: ${interest1} and ${interest2}.`,
    `${capitalise(focus1)} person. Previously ${dText.pick(industry.roles).toLowerCase()} at ${previous}. Lives in ${area} and likes ${interest1}.`,
    `Runs the ${focus1} work at ${company} from ${area}. Used to be at ${previous}. Weekends are for ${interest1}.`,
    `${first} joined ${company} ${years} years ago to build out ${focus1}. Also into ${interest1}.`,
    `Knows ${focus1} and ${focus2} better than most. Came from ${previous}. Usually reachable in ${area}, unless out ${interest1}.`,
    `${role} at ${company} for ${years} years. Before that, ${previous}. Good person to ask about ${focus1}. Likes ${interest1} and ${interest2}.`,
    `Helps ${company} with ${focus1}. Earlier career at ${previous}. Based in ${area}. Fan of ${interest1}.`,
  ];
  const headline = dText.pick(headlines);
  const about = dText.pick(abouts);
  // Words the contact has stay. Only an empty field is filled.
  if (!input.role) contact.role = role;
  if (!input.headline) contact.headline = headline;
  if (!input.about) contact.about = about;
  if (!input.company) contact.company = company;

  // Other fields on the contact, each filled only when it is empty.
  const dWeb = stream("web");
  if (!input.website && dWeb.chance(0.6)) {
    contact.website = dWeb.chance(0.7)
      ? `https://www.${slug(company)}.example`
      : `https://${letters(first)}${letters(lastName)}.example`;
  }
  const dBirth = stream("birth");
  if (!input.birthday && dBirth.chance(0.65)) {
    const month = String(dBirth.int(1, 12)).padStart(2, "0");
    const day = String(dBirth.int(1, 28)).padStart(2, "0");
    contact.birthday = dBirth.chance(0.75)
      ? `${dBirth.int(1958, 2001)}-${month}-${day}`
      : `${month}-${day}`;
  }
  const dPronoun = stream("pronoun");
  if (!input.pronouns && dPronoun.chance(0.28))
    contact.pronouns = PRONOUNS[classifyName(input.name)];
  // The default face follows the pronouns, as an edit in the app redraws it.
  // Left to the server's boot, the redraw would stamp updatedAt with the
  // real clock.
  const face = defaultAvatarUrl(input.name, contact.pronouns ?? input.pronouns);
  if (
    isDefaultAvatarFor(input.avatarUrl, input.name) &&
    face !== input.avatarUrl
  )
    contact.avatarUrl = face;
  const dPrefs = stream("prefs");
  if (!input.preferences && dPrefs.chance(0.7)) {
    const extras = [
      "",
      "",
      " Keep it short.",
      " Agenda a day ahead helps.",
      " Loves a plan B.",
    ];
    contact.preferences = `Prefers ${dPrefs.pick(CHANNELS)}. Best ${dPrefs.pick(BEST_TIMES)}.${dPrefs.pick(extras)}`;
  }
  const dCadence = stream("cadence");
  const cadence = dCadence.weighted([
    [7, 8],
    [14, 6],
    [30, 28],
    [60, 10],
    [90, 30],
    [180, 10],
    [365, 8],
  ] as const);
  if (cadence !== input.cadenceDays) contact.cadenceDays = cadence;
  const dTrack = stream("track");
  if (input.isTracked === 0 && dTrack.chance(0.3)) contact.isTracked = 1;
  // A spread of ages, so "stale data" has something to count. It is dated
  // below, once the plan knows when the contact was added.
  const dTouch = stream("touch");
  const touched = daysAgo(
    now,
    dTouch.chance(0.15) ? dTouch.int(200, 430) : dTouch.int(0, 170),
  );
  touched.setUTCHours(
    dTouch.int(6, 20),
    dTouch.int(0, 59),
    dTouch.int(0, 59),
    0,
  );

  // An email, or a second one of the other kind.
  const dEmail = stream("dEmail");
  const handles = [
    `${letters(first)}.${letters(lastName)}`,
    `${letters(first).slice(0, 1)}${letters(lastName)}`,
    `${letters(first)}${letters(lastName).slice(0, 1)}${dEmail.int(2, 98)}`,
  ];
  const personalMail = () =>
    `${dEmail.pick(handles)}${dEmail.int(10, 99)}@${dEmail.pick([...PERSONAL_DOMAINS].slice(0, 6))}`;
  const workMail = () =>
    `${dEmail.pick(handles.slice(0, 2))}@${slug(company)}.example`;
  const addEmail = (email: string, isPrimary: number, sortOrder: number) =>
    add.contact_emails.push({
      id: id("email", 0),
      email,
      label: labelFor(email),
      isPrimary,
      sortOrder,
    });
  if (input.emails.length === 0 && dEmail.chance(0.75)) {
    addEmail(dEmail.chance(0.5) ? personalMail() : workMail(), 1, 0);
  } else if (input.emails.length > 0 && dEmail.chance(0.35)) {
    const other =
      labelFor(input.emails[0]) === "personal" ? workMail() : personalMail();
    addEmail(other, 0, input.emails.length);
  }

  // A phone number in the contact's country, from its city's area codes.
  const dPhone = stream("dPhone");
  const areaCodes = place?.city?.area;
  const pattern = dPhone.pick(place?.country.phones ?? FALLBACK_COUNTRY.phones);
  const number = () =>
    fillPattern(pattern, dPhone, areaCodes ? dPhone.pick(areaCodes) : "");
  if (input.phones.length === 0 && dPhone.chance(0.55)) {
    add.contact_phones.push({
      id: id("phone", 0),
      phone: number(),
      label: "mobile",
      isPrimary: 1,
      sortOrder: 0,
    });
  } else if (input.phones.length > 0 && dPhone.chance(0.15)) {
    add.contact_phones.push({
      id: id("phone", 0),
      phone: number(),
      label: dPhone.pick(["work", "home"]),
      isPrimary: 0,
      sortOrder: input.phones.length,
    });
  }

  // Links, schools and jobs.
  const dSocial = stream("social");
  const tech = new Set([
    "Developer Tools",
    "Robotics",
    "Cybersecurity",
    "Fintech",
    "Gaming",
    "Consumer Hardware",
  ]);
  const suffix = createHash("sha1")
    .update(`${seed}:${input.id}:h`)
    .digest("hex")
    .slice(0, 6);
  for (const { platform, base, chance } of SOCIAL_PLATFORMS) {
    const p =
      platform === "github" && !tech.has(input.industry ?? "")
        ? chance / 4
        : chance;
    if (!dSocial.chance(p)) continue;
    const handle =
      platform === "linkedin"
        ? `${slug(first)}-${slug(lastName)}-${suffix}`
        : `${letters(first)}${letters(lastName)}${suffix.slice(0, 3)}`;
    add.contact_social_links.push({
      id: id("social", add.contact_social_links.length),
      platform,
      url: `${base}${handle}`,
      handle,
    });
  }
  const dEdu = stream("education");
  const birthday = String(contact.birthday ?? input.birthday ?? "");
  const birthYear = /^\d{4}/.test(birthday)
    ? Number(birthday.slice(0, 4))
    : dEdu.int(1965, 1999);
  if (dEdu.chance(0.8)) {
    const schools = new Set<string>();
    const schoolCount = dEdu.chance(0.3) ? 2 : 1;
    for (let i = 0; i < schoolCount; i++) {
      const school = dEdu.pick(SCHOOLS);
      if (schools.has(school)) continue;
      schools.add(school);
      const end = birthYear + 21 + i * 3 + dEdu.int(0, 2);
      add.contact_education.push({
        id: id("education", i),
        school,
        degree:
          i === 0
            ? dEdu.pick(DEGREES.slice(0, 4))
            : dEdu.pick(DEGREES.slice(3)),
        fieldOfStudy: dEdu.pick(FIELDS),
        startDate: `${end - (i === 0 ? 4 : 2)}-09`,
        endDate: `${end}-06`,
      });
    }
  }
  const dWork = stream("work");
  if (dWork.chance(0.92)) {
    const startYear = Math.max(1990, now.getUTCFullYear() - years);
    const current: ExperienceRow = {
      id: id("experience", 0),
      company,
      role,
      startDate: `${startYear}-${String(dWork.int(1, 12)).padStart(2, "0")}`,
      endDate: null,
      isCurrent: 1,
      location: place?.name ?? null,
    };
    add.contact_experience.push(current);
    let cursor = current.startDate;
    const earlierJobs = [
      [0, 3],
      [1, 5],
      [2, 2],
    ] as const;
    const earlier = dWork.weighted(earlierJobs);
    for (let i = 0; i < earlier; i++) {
      const [y, m] = cursor.split("-").map(Number);
      const endYear = y - (m === 1 ? 1 : 0);
      const endMonth = m === 1 ? 12 : m - 1;
      const length = dWork.int(1, 5);
      const start = `${Math.max(1985, endYear - length)}-${String(dWork.int(1, 12)).padStart(2, "0")}`;
      const end = `${endYear}-${String(endMonth).padStart(2, "0")}`;
      add.contact_experience.push({
        id: id("experience", i + 1),
        company: i === 0 ? previous : companyName(dWork, industry.nouns),
        role: dWork.pick(industry.roles),
        startDate: start > end ? end : start,
        endDate: end,
        isCurrent: 0,
        location: dWork.chance(0.6) ? (place?.name ?? null) : null,
      });
      cursor = start > end ? end : start;
    }
  }

  // Custom fields.
  const dAttr = stream("dAttr");
  const names = Object.keys(ATTRIBUTES);
  const fieldCount = [
    [0, 4],
    [1, 3],
    [2, 2],
    [3, 1],
  ] as const;
  const fields = dAttr.weighted(fieldCount);
  for (let i = 0; i < fields; i++) {
    const name = names.splice(dAttr.int(0, names.length - 1), 1)[0];
    add.contact_attributes.push({
      id: id("attribute", i),
      name,
      value: dAttr.pick(ATTRIBUTES[name]),
    });
  }

  // Notes, added until the contact has a believable history.
  const dHist = stream("dHist");
  const types = [
    ["meeting", 0.3],
    ["call", 0.2],
    ["email", 0.3],
    ["note", 0.2],
  ] as const;
  const said = new Set(
    input.interactions.map((x) => `${x.type}|${x.title}|${x.content}`),
  );
  const talk = (type: string, key: string) => {
    const topics = INTERACTION_TOPICS[type];
    const values = { focus: focus1, topic: interest1 };
    let note = { title: "", content: "" };
    // Try again when this contact already has the same note, up to a point.
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = dice(`${seed}:${input.id}:${key}:${attempt}`);
      const topic = r.pick(topics);
      note = {
        title: fillTemplate(topic.title, values),
        content: `<p>${fillTemplate(r.pick(topic.body), values)}</p>`,
      };
      const signature = `${type}|${note.title}|${note.content}`;
      if (!said.has(signature)) {
        said.add(signature);
        break;
      }
    }
    return note;
  };
  const dates: string[] = input.interactions.map((x) => x.date);
  const wanted = dHist.weighted([
    [0, 22],
    [1, 16],
    [2, 16],
    [3, 14],
    [4, 10],
    [5, 8],
    [6, 6],
    [8, 5],
    [10, 3],
  ] as const);
  for (let i = input.interactions.length; i < wanted; i++) {
    const type = dHist.weighted(types);
    const days = Math.floor(620 * dHist.next() ** 1.8);
    const when = daysAgo(now, days);
    when.setUTCHours(dHist.int(8, 18), dHist.int(0, 59), 0, 0);
    const date = (when > now ? now : when).toISOString();
    dates.push(date);
    add.interactions.push({
      id: id("interaction", i),
      type,
      ...talk(type, `new-${i}`),
      date,
    });
  }
  const validDates = dates
    .filter((x) => !Number.isNaN(Date.parse(x)))
    .map((x) => new Date(x))
    .sort((a, b) => +a - +b);
  const newest = validDates.at(-1);
  // The newest interaction, never after now.
  if (newest)
    contact.lastContactedAt = (newest > now ? now : newest).toISOString();

  // When the contact was added: years ago for most, and always before the
  // first thing that happened with them.
  const dAdded = stream("added");
  let added = daysAgo(now, Math.floor(10 + 1500 * dAdded.next() ** 1.3));
  const earliest = validDates[0];
  if (earliest && added > earliest) {
    added = new Date(earliest.getTime() - dAdded.int(1, 60) * 86_400_000);
  }
  added.setUTCHours(dAdded.int(6, 20), dAdded.int(0, 59), dAdded.int(0, 59), 0);
  const addedAt = sqliteStamp(added);
  // The last edit, never before the contact was added nor after now.
  const editedAt = sqliteStamp(touched > now ? now : touched);
  const updatedAt = editedAt < addedAt ? addedAt : editedAt;
  // Tracking is an edit, so it happened by the last one. The trigger that
  // stamps trackedAt reads the real clock, and the runner writes this after.
  if (contact.isTracked === 1) contact.trackedAt = updatedAt;

  // One open follow-up for some, and a finished one for a few.
  const dTask = stream("dTask");
  if (validDates.length > 0 && dTask.chance(0.16)) {
    const done = dTask.chance(0.25);
    const due = done
      ? daysAgo(now, dTask.int(3, 40))
      : daysAgo(now, dTask.int(-35, 12));
    due.setUTCHours(9, 0, 0, 0);
    add.action_items.push({
      id: id("action", 0),
      title: fillTemplate(dTask.pick(TASKS), { focus: focus1 }),
      dueAt: due.toISOString(),
      completedAt: done ? daysAgo(now, dTask.int(0, 2)).toISOString() : null,
    });
  }

  return { contact: { ...contact, addedAt, updatedAt }, add };
}
