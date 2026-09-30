/**
 * The plan for one synthetic benchmark contact: what to add, fix and keep.
 *
 * `planEnrichment` is pure. The same contact, seed and clock give the same
 * plan, so the script can run again and change nothing, and a test can read
 * the answer. The script (`scripts/enrich-bench-contacts.ts`) writes the plan.
 *
 * Nothing here is real. Streets and neighbourhoods are real places, with
 * invented house numbers, and every person is made up. See `places.ts`.
 *
 * @module scripts/bench/enrich
 */
import { createHash } from "node:crypto";
import {
  fakerCS_CZ,
  fakerDA,
  fakerDE,
  fakerDE_AT,
  fakerDE_CH,
  fakerEN,
  fakerEN_GB,
  fakerEN_IE,
  fakerEN_NG,
  fakerES,
  fakerFI,
  fakerFR,
  fakerHR,
  fakerHU,
  fakerIT,
  fakerLV,
  fakerNB_NO,
  fakerNL,
  fakerNL_BE,
  fakerPL,
  fakerPT_PT,
  fakerSK,
  fakerSL_SI,
  fakerSV,
  type Faker,
} from "@faker-js/faker";
import {
  CITIES,
  COUNTRIES,
  cityKey,
  type City,
  type Country,
  type Neighbourhood,
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

/** What the script needs to know about one contact before it plans. */
export interface BenchInput {
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
  cadenceDays: number | null;
  isTracked: number;
  /** True for a contact the first seed wrote from templates. False for a hand-written one. */
  generic: boolean;
  interests: string[];
  emails: { email: string; label: string | null; isPrimary: number }[];
  phones: string[];
  /** Interactions it already has. The first seed wrote Latin filler for them. */
  interactions: { id: string; type: string; date: string }[];
}

export interface PlanOptions {
  /** Changes every choice. The same seed gives the same contacts back. */
  seed: string;
  now: Date;
}

export interface EmailRow {
  id: string;
  email: string;
  label: string;
  isPrimary: number;
  sortOrder: number;
}
export interface PhoneRow {
  id: string;
  phone: string;
  label: string;
  isPrimary: number;
  sortOrder: number;
}
export interface AddressRow {
  id: string;
  address: string;
  label: string;
  isPrimary: number;
  sortOrder: number;
}
export interface SocialRow {
  id: string;
  platform: string;
  url: string;
  handle: string;
}
export interface EducationRow {
  id: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
}
export interface ExperienceRow {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string | null;
  isCurrent: number;
  location: string | null;
}
export interface InterestRow {
  id: string;
  interest: string;
}
export interface AttributeRow {
  id: string;
  name: string;
  value: string;
}
export interface InteractionRow {
  id: string;
  type: string;
  title: string;
  content: string;
  date: string;
}
export interface ActionItemRow {
  id: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
}

export interface BenchPlan {
  /** Columns of `contacts` to set. A key that is absent stays as it is. */
  contact: Record<string, string | number | null>;
  emailLabels: { email: string; label: string }[];
  emailsAdd: EmailRow[];
  phoneFixes: { from: string; to: string }[];
  phonesAdd: PhoneRow[];
  addresses: AddressRow[];
  socialLinks: SocialRow[];
  education: EducationRow[];
  experience: ExperienceRow[];
  interests: InterestRow[];
  attributes: AttributeRow[];
  interactionsAdd: InteractionRow[];
  interactionRewrites: {
    id: string;
    title: string;
    content: string;
    date: string;
  }[];
  actionItems: ActionItemRow[];
  /** The newest interaction, never after now. Null when there are none. */
  lastContactedAt: string | null;
}

/** The first seed's template: "X works on … Previously at … Enjoys …". */
export function isGenericAbout(about: string | null | undefined): boolean {
  return /\bworks on\b.*\bPreviously at\b.*\bEnjoys\b/s.test(about ?? "");
}

// ─── Randomness ────────────────────────────────────────────────────────────

function hash32(text: string): number {
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

interface Dice {
  next: () => number;
  chance: (p: number) => boolean;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
}

function dice(seed: string): Dice {
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

/** Fill a pattern: `#` a digit, `N` a digit 2 to 9, `A` a letter, `@` the area code. */
function fillPattern(pattern: string, d: Dice, area = ""): string {
  return [...pattern]
    .map((ch) => {
      if (ch === "#") return String(d.int(0, 9));
      if (ch === "N") return String(d.int(2, 9));
      if (ch === "A") return String.fromCharCode(65 + d.int(0, 25));
      if (ch === "@") return area;
      return ch;
    })
    .join("");
}

// ─── Small helpers ─────────────────────────────────────────────────────────

const slug = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
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

const SQLITE_STAMP = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");

const daysAgo = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 86_400_000);

/** A row id that marks the row as the script's, and is the same on every run. */
function rowId(seed: string, contactId: string, kind: string, index: number) {
  const digest = createHash("sha1")
    .update(`${seed}:${contactId}:${kind}:${index}`)
    .digest("hex");
  return `be-${digest.slice(0, 20)}`;
}

// ─── Places ────────────────────────────────────────────────────────────────

/** For a city the tables do not list: a plain address in a plain format. */
const FALLBACK_COUNTRY: Country = {
  name: "",
  calling: "",
  numberAfter: false,
  zipFirst: false,
  zipTail: "",
  zip: "#####",
  phones: ["+## ## ### ####"],
};

const STREET_FAKER: Record<string, Faker> = {
  DK: fakerDA,
  NG: fakerEN_NG,
  BE: fakerNL_BE,
  ES: fakerES,
  CH: fakerDE_CH,
  GB: fakerEN_GB,
  NO: fakerNB_NO,
  IT: fakerIT,
  FR: fakerFR,
  SK: fakerSK,
  HU: fakerHU,
  PL: fakerPL,
  IE: fakerEN_IE,
  SE: fakerSV,
  FI: fakerFI,
  AT: fakerDE_AT,
  SI: fakerSL_SI,
  CZ: fakerCS_CZ,
  LV: fakerLV,
  HR: fakerHR,
  DE: fakerDE,
  NL: fakerNL,
  PT: fakerPT_PT,
};

interface Place {
  /** The city as the contact's location writes it. */
  name: string;
  region: string | null;
  countryCode: string | null;
  country: Country;
  city: City | null;
  /** The middle of a town with no neighbourhoods. */
  centre: { lat: number; lng: number } | null;
}

function placeOf(input: BenchInput): Place | null {
  const key = cityKey(input.location);
  if (!key) return null;
  const city = CITIES[key] ?? null;
  const name = (input.location ?? "").split(",")[0].trim();
  return {
    name,
    region: city?.region ?? null,
    countryCode: city?.country ?? null,
    country: city ? COUNTRIES[city.country] : FALLBACK_COUNTRY,
    city,
    // The table's centre, never the contact's own pin: a run moves the pin,
    // and a second run would drift from it. A city the table does not know
    // keeps the pin it has.
    centre: city?.centre ? { lat: city.centre[0], lng: city.centre[1] } : null,
  };
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

function houseNumber(countryCode: string | null, d: Dice): string {
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
  const { country } = place;
  const line = country.numberAfter
    ? `${street} ${number}`
    : `${number} ${street}`;
  if (country.zipFirst) return `${line}, ${zip} ${place.name}`;
  if (place.region) return `${line}, ${place.name}, ${place.region} ${zip}`;
  return `${line}, ${place.name} ${zip}`;
}

interface Spot {
  address: string;
  lat: number | null;
  lng: number | null;
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
  for (let attempt = 0; attempt < 6; attempt++) {
    const hoods: Neighbourhood[] | undefined = place.city?.neighbourhoods;
    let spot: Spot;
    if (hoods && hoods.length > 0) {
      const hood = d.pick(hoods);
      const zip = hood.zip + fillPattern(place.country.zipTail, d);
      const pin = jitter(hood.lat, hood.lng, 350, d);
      spot = {
        address: formatAddress(
          place,
          houseNumber(place.countryCode, d),
          hood.street,
          zip,
        ),
        lat: pin.lat,
        lng: pin.lng,
        area: hood.name,
      };
    } else {
      const faker =
        (place.countryCode && STREET_FAKER[place.countryCode]) || fakerEN;
      faker.seed(hash32(`${salt}:${attempt}`));
      const street = faker.location.street();
      const pin = place.centre
        ? jitter(place.centre.lat, place.centre.lng, 1800, d)
        : null;
      spot = {
        address: formatAddress(
          place,
          houseNumber(place.countryCode, d),
          street,
          fillPattern(place.country.zip, d),
        ),
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        area: place.name,
      };
    }
    if (!avoid.has(spot.address)) return spot;
  }
  return null;
}

// ─── Text ──────────────────────────────────────────────────────────────────

function companyName(d: Dice, nouns: readonly string[]): string {
  return `${d.pick(COMPANY_FIRST)} ${d.pick(nouns)}`;
}

function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
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
  const first = input.firstName || input.name.split(" ")[0] || "They";
  const lastName = input.lastName || input.name.split(" ").slice(1).join(" ");
  const place = placeOf(input);

  const plan: BenchPlan = {
    contact: {},
    emailLabels: [],
    emailsAdd: [],
    phoneFixes: [],
    phonesAdd: [],
    addresses: [],
    socialLinks: [],
    education: [],
    experience: [],
    interests: [],
    attributes: [],
    interactionsAdd: [],
    interactionRewrites: [],
    actionItems: [],
    lastContactedAt: null,
  };

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
      const isPrimary = plan.addresses.length === 0 ? 1 : 0;
      plan.addresses.push({
        id: id("address", plan.addresses.length),
        address: spot.address,
        label: kind.label,
        isPrimary,
        sortOrder: plan.addresses.length,
      });
      if (isPrimary === 1) {
        area = spot.area;
        if (spot.lat != null && spot.lng != null) {
          plan.contact.lat = spot.lat;
          plan.contact.lng = spot.lng;
          plan.contact.geoSource = "geocoder";
        }
      }
    }
  }

  // Interests first, because the text refers to them.
  const dInt = stream("dInt");
  const interests = [...input.interests];
  for (let i = 0; i < dInt.int(0, 3); i++) {
    const interest = dInt.pick(INTERESTS);
    if (interests.includes(interest)) continue;
    interests.push(interest);
    plan.interests.push({ id: id("interest", i), interest });
  }

  // Words: a role, a headline and an about that fit the industry.
  const dText = stream("dText");
  const focus = [...industry.focus];
  const focus1 = focus.splice(dText.int(0, focus.length - 1), 1)[0];
  const focus2 = focus.splice(dText.int(0, focus.length - 1), 1)[0];
  const role = dText.pick(industry.roles);
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
  const text = {
    role,
    headline: dText.pick(headlines),
    about: dText.pick(abouts),
  };
  if (input.generic) {
    plan.contact.role = text.role;
    plan.contact.headline = text.headline;
    plan.contact.about = text.about;
  } else {
    if (!input.role) plan.contact.role = text.role;
    if (!input.headline) plan.contact.headline = text.headline;
    if (!input.about) plan.contact.about = text.about;
  }
  if (!input.company) plan.contact.company = company;

  // Other fields on the contact, each filled only when it is empty.
  const dWeb = stream("web");
  if (!input.website && dWeb.chance(0.6)) {
    plan.contact.website = dWeb.chance(0.7)
      ? `https://www.${slug(company)}.example`
      : `https://${letters(first)}${letters(lastName)}.example`;
  }
  const dBirth = stream("birth");
  if (!input.birthday && dBirth.chance(0.65)) {
    const month = String(dBirth.int(1, 12)).padStart(2, "0");
    const day = String(dBirth.int(1, 28)).padStart(2, "0");
    plan.contact.birthday = dBirth.chance(0.75)
      ? `${dBirth.int(1958, 2001)}-${month}-${day}`
      : `${month}-${day}`;
  }
  const dPronoun = stream("pronoun");
  if (!input.pronouns && dPronoun.chance(0.28))
    plan.contact.pronouns = dPronoun.pick(PRONOUNS);
  const dPrefs = stream("prefs");
  if (!input.preferences && dPrefs.chance(0.7)) {
    const extras = [
      "",
      "",
      " Keep it short.",
      " Agenda a day ahead helps.",
      " Loves a plan B.",
    ];
    plan.contact.preferences = `Prefers ${dPrefs.pick(CHANNELS)}. Best ${dPrefs.pick(BEST_TIMES)}.${dPrefs.pick(extras)}`;
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
  if (cadence !== input.cadenceDays) plan.contact.cadenceDays = cadence;
  const dTrack = stream("track");
  if (input.isTracked === 0 && dTrack.chance(0.3)) plan.contact.isTracked = 1;
  // A spread of ages, so "stale data" has something to count.
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
  plan.contact.updatedAt = SQLITE_STAMP(touched > now ? now : touched);

  // Email labels, then addresses to add.
  const dEmail = stream("dEmail");
  for (const row of input.emails) {
    const domain = row.email.split("@")[1]?.toLowerCase() ?? "";
    const label = PERSONAL_DOMAINS.has(domain) ? "personal" : "work";
    if (row.label !== label) plan.emailLabels.push({ email: row.email, label });
  }
  const handles = [
    `${letters(first)}.${letters(lastName)}`,
    `${letters(first).slice(0, 1)}${letters(lastName)}`,
    `${letters(first)}${letters(lastName).slice(0, 1)}${dEmail.int(2, 98)}`,
  ];
  const personalMail = () =>
    `${dEmail.pick(handles)}${dEmail.int(10, 99)}@${dEmail.pick([...PERSONAL_DOMAINS].slice(0, 6))}`;
  const workMail = () =>
    `${dEmail.pick(handles.slice(0, 2))}@${slug(company)}.example`;
  if (input.emails.length === 0 && dEmail.chance(0.75)) {
    plan.emailsAdd.push({
      id: id("email", 0),
      email: dEmail.chance(0.5) ? personalMail() : workMail(),
      label: "",
      isPrimary: 1,
      sortOrder: 0,
    });
  } else if (input.emails.length > 0 && dEmail.chance(0.35)) {
    const firstDomain =
      input.emails[0].email.split("@")[1]?.toLowerCase() ?? "";
    plan.emailsAdd.push({
      id: id("email", 0),
      email: PERSONAL_DOMAINS.has(firstDomain) ? workMail() : personalMail(),
      label: "",
      isPrimary: 0,
      sortOrder: input.emails.length,
    });
  }
  for (const row of plan.emailsAdd) {
    const domain = row.email.split("@")[1] ?? "";
    row.label = PERSONAL_DOMAINS.has(domain) ? "personal" : "work";
  }

  // Phones: clean the backslashes, give a foreign-format number a local one,
  // then add. The first seed wrote a US number for every contact.
  const dPhone = stream("dPhone");
  const home = place?.country;
  input.phones.forEach((phone, index) => {
    const cleaned = phone.replace(/\\/g, "");
    const foreign =
      home !== undefined &&
      home !== FALLBACK_COUNTRY &&
      home.calling !== "1" &&
      /^\+1\b/.test(cleaned);
    const r = stream(`phonefix:${index}`);
    const to = foreign ? fillPattern(r.pick(home.phones), r) : cleaned;
    if (to !== phone) plan.phoneFixes.push({ from: phone, to });
  });
  const areaCodes = place?.city?.area;
  const pattern = dPhone.pick(place?.country.phones ?? FALLBACK_COUNTRY.phones);
  const number = () =>
    fillPattern(pattern, dPhone, areaCodes ? dPhone.pick(areaCodes) : "");
  if (input.phones.length === 0 && dPhone.chance(0.55)) {
    plan.phonesAdd.push({
      id: id("phone", 0),
      phone: number(),
      label: "mobile",
      isPrimary: 1,
      sortOrder: 0,
    });
  } else if (input.phones.length > 0 && dPhone.chance(0.15)) {
    plan.phonesAdd.push({
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
  const suffix = () =>
    createHash("sha1")
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
        ? `${slug(first)}-${slug(lastName)}-${suffix()}`
        : `${letters(first)}${letters(lastName)}${suffix().slice(0, 3)}`;
    plan.socialLinks.push({
      id: id("social", plan.socialLinks.length),
      platform,
      url: `${base}${handle}`,
      handle,
    });
  }
  const dEdu = stream("education");
  const birthYear = /^\d{4}/.test(
    String(plan.contact.birthday ?? input.birthday ?? ""),
  )
    ? Number(String(plan.contact.birthday ?? input.birthday).slice(0, 4))
    : dEdu.int(1965, 1999);
  if (dEdu.chance(0.8)) {
    const schools = new Set<string>();
    for (let i = 0; i < (dEdu.chance(0.3) ? 2 : 1); i++) {
      const school = dEdu.pick(SCHOOLS);
      if (schools.has(school)) continue;
      schools.add(school);
      const end = birthYear + 21 + i * 3 + dEdu.int(0, 2);
      plan.education.push({
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
      role: input.generic ? text.role : input.role || text.role,
      startDate: `${startYear}-${String(dWork.int(1, 12)).padStart(2, "0")}`,
      endDate: null,
      isCurrent: 1,
      location: place?.name ?? null,
    };
    const earlier: ExperienceRow[] = [];
    let cursor = current.startDate;
    for (
      let i = 0;
      i <
      dWork.weighted([
        [0, 3],
        [1, 5],
        [2, 2],
      ] as const);
      i++
    ) {
      const [y, m] = cursor.split("-").map(Number);
      const endYear = y - (m === 1 ? 1 : 0);
      const endMonth = m === 1 ? 12 : m - 1;
      const length = dWork.int(1, 5);
      const start = `${Math.max(1985, endYear - length)}-${String(dWork.int(1, 12)).padStart(2, "0")}`;
      const end = `${endYear}-${String(endMonth).padStart(2, "0")}`;
      earlier.push({
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
    plan.experience = [current, ...earlier];
  }

  // Custom fields.
  const dAttr = stream("dAttr");
  const names = Object.keys(ATTRIBUTES);
  for (
    let i = 0;
    i <
    dAttr.weighted([
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 1],
    ] as const);
    i++
  ) {
    const name = names.splice(dAttr.int(0, names.length - 1), 1)[0];
    plan.attributes.push({
      id: id("attribute", i),
      name,
      value: dAttr.pick(ATTRIBUTES[name]),
    });
  }

  // Interactions: rewrite the ones it has, and add until it has a believable history.
  const dHist = stream("dHist");
  const types = [
    ["meeting", 0.3],
    ["call", 0.2],
    ["email", 0.3],
    ["note", 0.2],
  ] as const;
  const used = new Set<string>();
  const talk = (type: string, key: string) => {
    const topics = INTERACTION_TOPICS[type] ?? INTERACTION_TOPICS.note;
    const values = { focus: focus1, topic: interest1 };
    let said = { title: "", content: "" };
    // Try again when this contact already has the same note, up to a point.
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = dice(`${seed}:${input.id}:${key}:${attempt}`);
      said = {
        title: fillTemplate(r.pick(topics.title), values),
        content: `<p>${fillTemplate(r.pick(topics.body), values)}</p>`,
      };
      const signature = `${type}|${said.title}|${said.content}`;
      if (!used.has(signature)) {
        used.add(signature);
        break;
      }
    }
    return said;
  };
  const dates: string[] = input.interactions.map((x) => x.date);
  for (const existing of input.interactions) {
    plan.interactionRewrites.push({
      id: existing.id,
      ...talk(existing.type, existing.id),
      date: existing.date,
    });
  }
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
    plan.interactionsAdd.push({
      id: id("interaction", i),
      type,
      ...talk(type, `new-${i}`),
      date,
    });
  }
  const validDates = dates.filter((x) => !Number.isNaN(Date.parse(x)));
  if (validDates.length > 0) {
    const newest = validDates
      .map((x) => new Date(x))
      .sort((a, b) => +b - +a)[0];
    plan.lastContactedAt = (newest > now ? now : newest).toISOString();
  }

  // When the contact was added: years ago for most, and always before the
  // first thing that happened with them.
  const dAdded = stream("added");
  let added = daysAgo(now, Math.floor(10 + 1500 * dAdded.next() ** 1.3));
  const earliest = validDates
    .map((x) => new Date(x))
    .sort((a, b) => +a - +b)[0];
  if (earliest && added > earliest) {
    added = new Date(earliest.getTime() - dAdded.int(1, 60) * 86_400_000);
  }
  added.setUTCHours(dAdded.int(6, 20), dAdded.int(0, 59), dAdded.int(0, 59), 0);
  plan.contact.addedAt = SQLITE_STAMP(added > now ? now : added);

  // One open follow-up for some, and a finished one for a few.
  const dTask = stream("dTask");
  if (validDates.length > 0 && dTask.chance(0.16)) {
    const done = dTask.chance(0.25);
    const due = done
      ? daysAgo(now, dTask.int(3, 40))
      : daysAgo(now, dTask.int(-35, 12));
    due.setUTCHours(9, 0, 0, 0);
    plan.actionItems.push({
      id: id("action", 0),
      title: fillTemplate(dTask.pick(TASKS), { focus: focus1 }),
      dueAt: due.toISOString(),
      completedAt: done ? daysAgo(now, dTask.int(0, 2)).toISOString() : null,
    });
  }

  return plan;
}
