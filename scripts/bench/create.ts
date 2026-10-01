/**
 * A synthetic network for an account that has none: people with a name that
 * fits their city, a city from the planner's table, an industry, a company,
 * a role and a few tags. The planner (`plan.ts`) fills in everything else.
 *
 * `createNetwork` is pure. The same seed gives the same people, ids
 * included, and a smaller count gives the first of them.
 *
 * @module scripts/bench/create
 */
import { createHash } from "node:crypto";
import { allFakers } from "@faker-js/faker";
import { defaultAvatarUrl } from "../../server/utils/avatarUrl.ts";
import { doubleMetaphone } from "../../server/utils/nlp/index.ts";
import { CITIES, COUNTRIES } from "./places.ts";
import { INDUSTRIES, TAGS } from "./profiles.ts";
import { LOCAL_NAMES, localName } from "./names.ts";
import { companyName, dice, hash32, type BenchContact } from "./plan.ts";

/** One new contact: its row, as the app's create path writes it, and its tags. */
export interface NewContact {
  contact: BenchContact & { phoneticHash: string };
  /** The run's own tag, then one to three more. */
  tags: string[];
}

/** A version 4 UUID made from a hash, so the same text gives the same id. */
export function uuidFrom(text: string): string {
  const hex = createHash("sha256").update(text).digest("hex");
  const variant = "89ab"[parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A city with neighbourhoods draws ten times the people of a town. */
const PLACES = Object.entries(CITIES).map(
  ([key, city]) => [key, city.neighbourhoods ? 10 : 1] as const,
);
const COUNTRY_NAME = new Intl.DisplayNames(["en"], {
  type: "region",
  style: "short",
});

/** "Boston, MA, US", "Valencia, Spain", "Singapore". */
function locationOf(key: string): string {
  const city = CITIES[key];
  const name = key.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const country = COUNTRY_NAME.of(city.country);
  return [name, city.region, country === name ? undefined : country]
    .filter(Boolean)
    .join(", ");
}

export function createNetwork(
  count: number,
  seed: string,
  tag: string,
): NewContact[] {
  const names = new Set<string>();
  return Array.from({ length: count }, (_, i) => {
    const d = dice(`${seed}:create:${i}`);
    const key = d.weighted(PLACES);
    const { country } = CITIES[key];
    const local = LOCAL_NAMES[country];
    // A name in the city's own language, and another when it is taken.
    let firstName = "";
    let lastName = "";
    for (let attempt = 0; attempt < 8; attempt++) {
      const salt = `${seed}:name:${i}:${attempt}`;
      if (local) ({ firstName, lastName } = localName(local, dice(salt)));
      else {
        const faker = allFakers[COUNTRIES[country].locale ?? "en"];
        faker.seed(hash32(salt));
        const sex = faker.person.sexType();
        firstName = faker.person.firstName(sex);
        // Some locales join two surnames with no space: "HohošBabić".
        lastName = faker.person
          .lastName(sex)
          .replace(/(\p{Lu}\p{Ll}{3,})(?=\p{Lu})/gu, "$1-");
      }
      if (!names.has(`${firstName} ${lastName}`)) break;
    }
    const name = `${firstName} ${lastName}`;
    names.add(name);
    const industry = d.pick(Object.keys(INDUSTRIES));
    const { roles, nouns } = INDUSTRIES[industry];
    const role = d.pick(roles);
    const company = companyName(d, nouns);
    const pool = TAGS.filter((other) => other !== tag);
    const tags = [
      tag,
      ...Array.from(
        { length: d.int(1, 3) },
        () => pool.splice(d.int(0, pool.length - 1), 1)[0],
      ),
    ];
    return {
      contact: {
        id: uuidFrom(`${seed}:contact:${i}`),
        name,
        firstName,
        lastName,
        company,
        role,
        headline: null,
        industry,
        location: locationOf(key),
        lat: null,
        lng: null,
        about: null,
        website: null,
        birthday: null,
        pronouns: null,
        preferences: null,
        // What the app's create path sets that a raw insert would not.
        avatarUrl: defaultAvatarUrl(name),
        phoneticHash: doubleMetaphone(name).primary,
        cadenceDays: 90,
        isTracked: 0,
      },
      tags,
    };
  });
}
