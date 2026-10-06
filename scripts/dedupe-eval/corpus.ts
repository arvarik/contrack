// The dedupe evaluation corpus: contacts with the answer written down, so
// running the passes gives a precision and a recall for the whole engine.
// Unit tests check each matcher alone, but blocking and pass order decide what
// reaches a matcher.
//
// Three kinds of contact:
//
// 1. DUPLICATE GROUPS. Two or three records of one person, hand written,
//    because the exact spelling is the point: a plausible typo, or the formal
//    name on one record and the short name on the other.
//
// 2. HARD NEGATIVES. Two people who look like one: a father and a son at one
//    firm, a married couple on one landline. Each is named, so a failure says
//    which kind of near miss started matching.
//
// 3. DISTRACTORS. Generated with a fixed seed. They give blocking something to
//    do, because a corpus of unique names measures a matcher, not an engine.
//
// The ground truth is closed: every pair the engine produces that is not in
// `duplicatePairs()` is a false positive. `validateCorpus()` makes that safe:
// it fails when two contacts from different groups share a normalized name,
// an email or a phone number without being named as a hard negative.
//
// Nothing here is a real person. The names are assembled from parts.

import {
  NICKNAME_GROUPS,
  normalizePhone,
  tokenizeName,
} from "../../server/utils/nlp/index.ts";
import { createRng } from "../../src/lib/corvidMotion.ts";

// Shapes

/** One contact record as the fixture stores it. */
export interface EvalContact {
  /** Stable identity across regenerations. Pairs name these. */
  key: string;
  /** The person this record is about. Two records with one personKey are a duplicate. */
  personKey: string;
  name: string;
  company: string | null;
  role: string | null;
  location: string | null;
  emails: string[];
  phones: string[];
  /** Import provenance. Two records from different platforms are cross-source. */
  sources: string[];
}

/**
 * Why a duplicate group is a duplicate.
 *
 * The gate reports recall per kind, so a change that breaks nicknames and
 * leaves everything else alone names itself.
 */
export type DuplicateKind =
  | "typo"
  | "nickname"
  | "moved-company"
  | "shared-email"
  | "shared-phone"
  | "cross-source"
  | "initial"
  | "diacritic"
  | "married-name"
  | "middle-name"
  | "title-suffix"
  | "formatting";

/**
 * Why a hard negative is hard.
 *
 * Each of these is a shape that a single matcher gets wrong on its own and
 * that the engine is supposed to get right in combination.
 */
export type NegativeKind =
  | "father-and-son"
  | "shared-landline"
  | "same-common-name"
  | "siblings"
  | "colleagues"
  | "shared-inbox"
  | "namesake";

export interface DuplicatePair {
  a: string;
  b: string;
  kind: DuplicateKind;
}

export interface NegativePair {
  a: string;
  b: string;
  kind: NegativeKind;
  /** One line on why somebody would match these, kept for the failure message. */
  why: string;
}

export interface Corpus {
  contacts: EvalContact[];
  duplicates: DuplicatePair[];
  negatives: NegativePair[];
}

// Duplicate groups
// Column order: personKey, kind, then two or three records. A record is
// `name | company | role | location | emails | phones | sources`, with `-` for
// an empty field and `;` between repeated values.

type GroupRow = [personKey: string, kind: DuplicateKind, ...records: string[]];

const GROUPS: GroupRow[] = [
  // Typos. One record carries a misspelling somebody really makes.
  [
    "ellery-vance",
    "typo",
    "Ellery Vance|Northwind Logistics|Operations Director|Portland, OR|ellery.vance@northwind.example|-|apple",
    "Ellery Vanse|Northwind Logistics|Operations Director|Portland, OR|-|-|csv",
  ],
  [
    "priyanka-raghunathan",
    "typo",
    "Priyanka Raghunathan|Kestrel Analytics|Data Scientist|Pune, IN|-|-|linkedin",
    "Priyanka Ragunathan|Kestrel Analytics|Data Scientist|Pune, IN|-|-|csv",
  ],
  [
    "siobhan-moriarty",
    "typo",
    "Siobhan Moriarty|Foxglove Press|Commissioning Editor|Dublin, IE|-|-|apple",
    "Siobhan Moriaty|Foxglove Press|Editor|Dublin, IE|-|-|csv",
  ],
  [
    "krzysztof-wisniewski",
    "typo",
    "Krzysztof Wisniewski|Ironwood Capital|Analyst|Warsaw, PL|-|-|linkedin",
    "Krzystof Wisniewski|Ironwood Capital|Analyst|Warsaw, PL|-|-|csv",
  ],
  [
    "annabelle-ferreira",
    "typo",
    "Annabelle Ferreira|Lighthouse Health|Nurse Practitioner|Lisbon, PT|-|-|apple",
    "Anabelle Ferreira|Lighthouse Health|Nurse Practitioner|Lisbon, PT|-|-|csv",
  ],
  [
    "dimitrios-papadopoulos",
    "typo",
    "Dimitrios Papadopoulos|Meridian Shipping|Port Agent|Piraeus, GR|-|-|apple",
    "Dimitrios Papadopulos|Meridian Shipping|Port Agent|Piraeus, GR|-|-|csv",
  ],
  [
    "jacqueline-beauchamp",
    "typo",
    "Jacqueline Beauchamp|Sable Studio|Art Director|Montreal, QC|-|-|linkedin",
    "Jacquline Beauchamp|Sable Studio|Art Director|Montreal, QC|-|-|csv",
  ],
  [
    "mohammed-al-rashid",
    "typo",
    "Mohammed Al-Rashid|Cobalt Energy|Project Lead|Doha, QA|-|-|apple",
    "Mohamed Al-Rashid|Cobalt Energy|Project Lead|Doha, QA|-|-|csv",
  ],

  // Nicknames. Formal name on one record, short name on the other.
  [
    "robert-lindqvist",
    "nickname",
    "Robert Lindqvist|Quarry Bank|Credit Officer|Stockholm, SE|-|-|linkedin",
    "Bob Lindqvist|Quarry Bank|Credit Officer|Stockholm, SE|-|-|apple",
  ],
  [
    "margaret-osei",
    "nickname",
    "Margaret Osei|Almanac Media|Producer|Accra, GH|-|-|linkedin",
    "Maggie Osei|Almanac Media|Producer|Accra, GH|-|-|apple",
  ],
  [
    "theodore-brennan",
    "nickname",
    "Theodore Brennan|Bellwether Legal|Associate|Boston, MA|-|-|linkedin",
    "Ted Brennan|Bellwether Legal|Associate|Boston, MA|-|-|apple",
  ],
  [
    "katherine-nakamura",
    "nickname",
    "Katherine Nakamura|Dovetail Design|Principal|Seattle, WA|-|-|linkedin",
    "Katie Nakamura|Dovetail Design|Principal|Seattle, WA|-|-|apple",
  ],
  [
    "william-oyelaran",
    "nickname",
    "William Oyelaran|Ember Foods|Buyer|Lagos, NG|-|-|linkedin",
    "Bill Oyelaran|Ember Foods|Buyer|Lagos, NG|-|-|apple",
  ],
  [
    "elizabeth-thorne",
    "nickname",
    "Elizabeth Thorne|Fathom Labs|Biologist|Bergen, NO|-|-|linkedin",
    "Beth Thorne|Fathom Labs|Biologist|Bergen, NO|-|-|apple",
  ],
  [
    "francisco-delacruz",
    "nickname",
    "Francisco Delacruz|Granite Build|Site Manager|Manila, PH|-|-|linkedin",
    "Paco Delacruz|Granite Build|Site Manager|Manila, PH|-|-|apple",
  ],
  [
    "abhishek-varadarajan",
    "nickname",
    "Abhishek Varadarajan|Halcyon Systems|Staff Engineer|Chennai, IN|-|-|linkedin",
    "Abhi Varadarajan|Halcyon Systems|Staff Engineer|Chennai, IN|-|-|apple",
  ],
  [
    "christopher-ashworth",
    "nickname",
    "Christopher Ashworth|Inkwell Books|Rights Manager|Edinburgh, UK|-|-|linkedin",
    "Chris Ashworth|Inkwell Books|Rights Manager|Edinburgh, UK|-|-|apple",
  ],
  [
    "deborah-steinberg",
    "nickname",
    "Deborah Steinberg|Juniper Care|Therapist|Tel Aviv, IL|-|-|linkedin",
    "Debbie Steinberg|Juniper Care|Therapist|Tel Aviv, IL|-|-|apple",
  ],

  // ── Moved company. Same person, the record was written twice, years apart.
  [
    "harriet-okonkwo",
    "moved-company",
    "Harriet Okonkwo|Keystone Partners|Consultant|London, UK|harriet.okonkwo@keystone.example|-|linkedin",
    "Harriet Okonkwo|Lantern Advisory|Principal|London, UK|harriet.okonkwo@keystone.example|-|csv",
  ],
  [
    "marcus-delgado",
    "moved-company",
    "Marcus Delgado|Mosaic Retail|Category Lead|Austin, TX|-|+1 512 555 0147|apple",
    "Marcus Delgado|Nimbus Grocery|Head of Category|Austin, TX|-|(512) 555-0147|csv",
  ],
  [
    "ingrid-solberg",
    "moved-company",
    "Ingrid Solberg|Orchard Ventures|Associate|Oslo, NO|ingrid@orchard.example|-|linkedin",
    "Ingrid Solberg|Pike Capital|Investor|Oslo, NO|ingrid@orchard.example|-|apple",
  ],
  [
    "yusuf-demirci",
    "moved-company",
    "Yusuf Demirci|Quill Software|Backend Engineer|Istanbul, TR|-|+90 532 555 0198|linkedin",
    "Yusuf Demirci|Rampart Security|Platform Engineer|Istanbul, TR|-|0532 555 0198|csv",
  ],

  // Shared email. Different spellings of the name, one address.
  [
    "rosalind-achebe",
    "shared-email",
    "Rosalind Achebe|Sextant Marine|Naval Architect|Rotterdam, NL|r.achebe@sextant.example|-|linkedin",
    "Roz Achebe|Sextant Marine|Architect|Rotterdam, NL|r.achebe@sextant.example|-|csv",
  ],
  [
    "gunnar-petersen",
    "shared-email",
    "Gunnar Petersen|Thicket Forestry|Surveyor|Aarhus, DK|gunnar.petersen@thicket.example|-|apple",
    "G. Petersen|Thicket Forestry|-|Aarhus, DK|GUNNAR.PETERSEN@thicket.example|-|csv",
  ],
  [
    "amara-nwachukwu",
    "shared-email",
    "Amara Nwachukwu|Umber Textiles|Designer|Abuja, NG|amara.n@umber.example|-|linkedin",
    "Amara Nwachukwu-Bello|Umber Textiles|Senior Designer|Abuja, NG|amara.n@umber.example|-|apple",
  ],

  // ── Shared phone, one person. The number is the same line, not a household.
  [
    "lucia-fontana",
    "shared-phone",
    "Lucia Fontana|Vantage Travel|Agent|Milan, IT|-|+39 02 5550 143|apple",
    "Lucia Fontana|Vantage Travel|Travel Agent|Milan, IT|-|02 5550 143|csv",
  ],
  [
    "oscar-ramirez",
    "shared-phone",
    "Oscar Ramirez|Windrow Farms|Agronomist|Fresno, CA|-|559-555-0172|apple",
    "Oscar Ramirez|Windrow Farms|-|Fresno, CA|-|(559) 555-0172|csv",
  ],

  // Cross-source. Identical name, two platforms, no other overlap.
  [
    "tobias-lindholm",
    "cross-source",
    "Tobias Lindholm|Yarrow Insurance|Underwriter|Helsinki, FI|-|-|linkedin",
    "Tobias Lindholm|-|-|-|-|-|apple",
  ],
  [
    "fatima-bensalem",
    "cross-source",
    "Fatima Bensalem|Zephyr Aviation|Dispatcher|Casablanca, MA|-|-|linkedin",
    "Fatima Bensalem|-|-|-|-|-|apple",
  ],
  [
    "nikolai-vasiliev",
    "cross-source",
    "Nikolai Vasiliev|Anvil Metals|Metallurgist|Tallinn, EE|-|-|linkedin",
    "Nikolai Vasiliev|-|-|-|-|-|google",
  ],

  // Initial for a first name.
  [
    "reginald-mbeki",
    "initial",
    "Reginald Mbeki|Basalt Mining|Geologist|Johannesburg, ZA|-|+27 11 555 0164|linkedin",
    "R. Mbeki|Basalt Mining|Geologist|Johannesburg, ZA|-|011 555 0164|csv",
  ],
  [
    "cassandra-whitfield",
    "initial",
    "Cassandra Whitfield|Cinder Gallery|Curator|Melbourne, AU|c.whitfield@cinder.example|-|linkedin",
    "C. Whitfield|Cinder Gallery|Curator|Melbourne, AU|c.whitfield@cinder.example|-|csv",
  ],

  // Diacritics dropped by an export.
  [
    "maria-garcia-lopez",
    "diacritic",
    "María García|Driftwood Hotels|General Manager|Seville, ES|maria.garcia@driftwood.example|-|apple",
    "Maria Garcia|Driftwood Hotels|General Manager|Seville, ES|maria.garcia@driftwood.example|-|csv",
  ],
  [
    "joao-goncalves",
    "diacritic",
    "João Gonçalves|Elmwood Wines|Export Manager|Porto, PT|-|+351 22 555 0119|apple",
    "Joao Goncalves|Elmwood Wines|Export Manager|Porto, PT|-|22 555 0119|csv",
  ],
  [
    "soren-kjaergaard",
    "diacritic",
    "Søren Kjærgaard|Flint Robotics|Controls Engineer|Odense, DK|soren.k@flint.example|-|linkedin",
    "Soren Kjaergaard|Flint Robotics|Controls Engineer|Odense, DK|soren.k@flint.example|-|csv",
  ],

  // Married name. Same person, the surname changed.
  [
    "helena-vasquez-reid",
    "married-name",
    "Helena Vasquez|Gable Architects|Associate|Denver, CO|helena.v@gable.example|-|linkedin",
    "Helena Reid|Gable Architects|Associate Principal|Denver, CO|helena.v@gable.example|-|apple",
  ],
  [
    "nadia-orlov-hartley",
    "married-name",
    "Nadia Orlov|Harbour Freight|Route Planner|Riga, LV|-|+371 2555 0186|apple",
    "Nadia Hartley|Harbour Freight|Route Planner|Riga, LV|-|2555 0186|csv",
  ],

  // A middle name on one record only.
  [
    "anton-kovacs",
    "middle-name",
    "Anton Kovacs|Iris Chemicals|Process Engineer|Budapest, HU|-|-|linkedin",
    "Anton Peter Kovacs|Iris Chemicals|Process Engineer|Budapest, HU|-|-|csv",
  ],
  [
    "leilani-kahananui",
    "middle-name",
    "Leilani Kahananui|Jetty Marine|Skipper|Honolulu, HI|-|-|apple",
    "Leilani Rose Kahananui|Jetty Marine|Skipper|Honolulu, HI|-|-|csv",
  ],

  // A title or suffix on one record only.
  [
    "evelyn-sandoval",
    "title-suffix",
    "Evelyn Sandoval|Kiln Ceramics|Founder|Oaxaca, MX|-|-|linkedin",
    "Dr. Evelyn Sandoval|Kiln Ceramics|Founder|Oaxaca, MX|-|-|apple",
  ],
  [
    "gregory-ntumba",
    "title-suffix",
    "Gregory Ntumba|Larkspur Media|Cinematographer|Kinshasa, CD|-|-|linkedin",
    "Gregory Ntumba Jr.|Larkspur Media|Cinematographer|Kinshasa, CD|-|-|csv",
  ],

  // Formatting only: casing and spacing.
  [
    "bridget-oshaughnessy",
    "formatting",
    "Bridget O'Shaughnessy|Marlow Brewing|Head Brewer|Cork, IE|-|-|apple",
    "bridget o'shaughnessy|Marlow Brewing|Head Brewer|Cork, IE|-|-|csv",
  ],
  [
    "tomasz-bielecki",
    "formatting",
    "Tomasz  Bielecki|Nettle Organics|Buyer|Krakow, PL|-|-|apple",
    "Tomasz Bielecki|Nettle Organics|Buyer|Krakow, PL|-|-|csv",
  ],

  // Three records of one person. Every pair inside counts.
  [
    "susanna-adeyemi",
    "nickname",
    "Susanna Adeyemi|Oakum Shipping|Broker|Southampton, UK|s.adeyemi@oakum.example|-|linkedin",
    "Sue Adeyemi|Oakum Shipping|Broker|Southampton, UK|-|+44 23 8555 0132|apple",
    "Susanna Adeyemi|Oakum Shipping|Chartering Broker|Southampton, UK|s.adeyemi@oakum.example|023 8555 0132|csv",
  ],
  [
    "patrick-donnelly",
    "typo",
    "Patrick Donnelly|Plover Insurance|Claims Adjuster|Galway, IE|p.donnelly@plover.example|-|linkedin",
    "Patrik Donnelly|Plover Insurance|Claims Adjuster|Galway, IE|-|-|csv",
    "Pat Donnelly|Plover Insurance|Adjuster|Galway, IE|p.donnelly@plover.example|-|apple",
  ],
  [
    "ximena-restrepo",
    "moved-company",
    "Ximena Restrepo|Quarry Bank|Risk Analyst|Bogota, CO|x.restrepo@quarry.example|-|linkedin",
    "Ximena Restrepo|Rowan Mutual|Senior Risk Analyst|Bogota, CO|x.restrepo@quarry.example|-|apple",
    "Ximena Restrepo|Rowan Mutual|-|Bogota, CO|-|+57 1 555 0177|csv",
  ],
];

// Hard negatives
// Two people who look like one. Each row builds both records and asserts the
// engine keeps them apart. Column order: kind, why, then the two records.

type NegativeRow = [kind: NegativeKind, why: string, a: string, b: string];

const NEGATIVE_ROWS: NegativeRow[] = [
  // A father and a son. `tokenizeName` strips Jr. and Sr., so these normalize
  // to the same string and D3 sees an exact name match at the same company.
  [
    "father-and-son",
    "Jr. and Sr. are stripped by the tokenizer, so the names normalize equal",
    "James Whitfield Sr.|Sable Studio|Managing Partner|Chicago, IL|james.whitfield@sable.example|-|linkedin",
    "James Whitfield Jr.|Sable Studio|Analyst|Chicago, IL|jw.jr@sable.example|-|linkedin",
  ],
  [
    "father-and-son",
    "same normalized name, same firm, different generation",
    "Olusegun Balogun Sr.|Tessellate Print|Owner|Ibadan, NG|-|-|apple",
    "Olusegun Balogun Jr.|Tessellate Print|Press Operator|Ibadan, NG|-|-|apple",
  ],
  [
    "father-and-son",
    "the third generation, with a numeral the tokenizer also strips",
    "Arthur Pemberton III|Vellum Law|Of Counsel|Charleston, SC|-|-|linkedin",
    "Arthur Pemberton|Vellum Law|Paralegal|Charleston, SC|-|-|linkedin",
  ],

  // A married couple on one landline. D2 returns 0.95 for a shared phone.
  [
    "shared-landline",
    "a couple sharing a home number, different names",
    "Miriam Halvorsen|-|-|Trondheim, NO|-|+47 73 555 0123|apple",
    "Anders Halvorsen|-|-|Trondheim, NO|-|+47 73 555 0123|apple",
  ],
  [
    "shared-landline",
    "siblings at the same address, one line between them",
    "Rafael Ibarra|-|Student|Valencia, ES|-|+34 96 555 0158|apple",
    "Beatriz Ibarra|-|Teacher|Valencia, ES|-|+34 96 555 0158|apple",
  ],
  [
    "shared-landline",
    "a parent and a child sharing the household number",
    "Grace Mutunga|Wicker Textiles|Weaver|Nairobi, KE|-|+254 20 555 0191|apple",
    "Daniel Mutunga|-|Student|Nairobi, KE|-|+254 20 555 0191|apple",
  ],

  // A shared inbox. D1 returns 0.98 for a shared email.
  [
    "shared-inbox",
    "two colleagues both listed against the team alias",
    "Petra Vogel|Xylem Water|Operations|Vienna, AT|team@xylem.example|-|csv",
    "Lukas Gruber|Xylem Water|Operations|Vienna, AT|team@xylem.example|-|csv",
  ],
  [
    "shared-inbox",
    "a family address on two people's records",
    "Noor Haddad|-|-|Amman, JO|haddad.family@example.net|-|apple",
    "Sami Haddad|-|-|Amman, JO|haddad.family@example.net|-|apple",
  ],

  // Two different people who happen to share a common name.
  [
    "same-common-name",
    "a very common name, two cities, two industries",
    "David Kim|Yarrow Insurance|Actuary|Toronto, ON|david.kim@yarrow.example|-|linkedin",
    "David Kim|Basalt Mining|Driller|Perth, AU|d.kim@basalt.example|-|apple",
  ],
  [
    "same-common-name",
    "same name, unrelated fields",
    "Maria Silva|Cinder Gallery|Registrar|Sao Paulo, BR|-|-|linkedin",
    "Maria Silva|Flint Robotics|QA Technician|Braga, PT|-|-|apple",
  ],
  [
    "same-common-name",
    "same name, same country, different trade",
    "Wei Chen|Driftwood Hotels|Concierge|Singapore, SG|-|-|apple",
    "Wei Chen|Elmwood Wines|Sommelier|Singapore, SG|-|-|linkedin",
  ],
  [
    "same-common-name",
    "same name, one a supplier and one a customer",
    "Ahmed Hassan|Gable Architects|Draughtsman|Cairo, EG|-|-|linkedin",
    "Ahmed Hassan|Harbour Freight|Customs Broker|Alexandria, EG|-|-|apple",
  ],

  // Siblings: same surname, same employer, similar first names.
  [
    "siblings",
    "brothers at the family firm, first names share a prefix",
    "Jonathan Okafor|Iris Chemicals|Plant Manager|Enugu, NG|-|-|linkedin",
    "Jonas Okafor|Iris Chemicals|Shift Supervisor|Enugu, NG|-|-|linkedin",
  ],
  [
    "siblings",
    "sisters at the same practice, names one letter apart",
    "Elena Marchetti|Jetty Marine|Vet|Naples, IT|-|-|apple",
    "Elera Marchetti|Jetty Marine|Vet Nurse|Naples, IT|-|-|apple",
  ],
  [
    "siblings",
    "twins, both at the family restaurant",
    "Kwame Asante|Kiln Ceramics|Chef|Kumasi, GH|-|-|apple",
    "Kwabena Asante|Kiln Ceramics|Pastry Chef|Kumasi, GH|-|-|apple",
  ],

  // Colleagues whose names collide on a blocking key.
  [
    "colleagues",
    "same company, same first initial, same surname length",
    "Sarah Lindqvist|Larkspur Media|Editor|Stockholm, SE|-|-|linkedin",
    "Sofia Lindqvist|Larkspur Media|Editor|Stockholm, SE|-|-|linkedin",
  ],
  [
    "colleagues",
    "one is a nickname of a different formal name",
    "Daniel Brennan|Marlow Brewing|Cellarman|Cork, IE|-|-|apple",
    "Dominic Brennan|Marlow Brewing|Cellarman|Cork, IE|-|-|apple",
  ],
  [
    "colleagues",
    "phonetically close surnames at one employer",
    "Ana Nowak|Nettle Organics|Agronomist|Lodz, PL|-|-|linkedin",
    "Ana Novak|Nettle Organics|Agronomist|Lodz, PL|-|-|linkedin",
  ],

  // A namesake: somebody named after somebody, no relation in the data.
  [
    "namesake",
    "an alumna and the scholarship named for her, both in the book",
    "Constance Mbeki|Oakum Shipping|Trustee|Durban, ZA|-|-|csv",
    "Constance Mbeki|Basalt Mining|Bursary Officer|Durban, ZA|-|-|csv",
  ],
  [
    "namesake",
    "a founder and a grandchild with the same full name",
    "Henrik Solberg|Plover Insurance|Founder|Bergen, NO|-|-|csv",
    "Henrik Solberg|Plover Insurance|Intern|Bergen, NO|-|-|linkedin",
  ],
];

// Recipes
// The hand-written groups above carry the shapes only a person can pick, but
// too few pairs to measure each kind. The rest is built by recipe: one named
// transformation from a base record to a second record of the same person, or
// of a different person who looks like them. The transformation is the label,
// and a recipe that stops producing a findable pair fails `validateCorpus`.

/** A base person the recipes build variants from. */
interface BasePerson {
  first: string;
  last: string;
  company: string;
  role: string;
  location: string;
  email: string;
  phone: string;
}

/** The two records a recipe produces, minus the keys. */
type RecipeOutput = [
  Omit<EvalContact, "key" | "personKey">,
  Omit<EvalContact, "key" | "personKey">,
];

function record(
  name: string,
  company: string | null,
  role: string | null,
  location: string | null,
  emails: string[],
  phones: string[],
  sources: string[],
): Omit<EvalContact, "key" | "personKey"> {
  return { name, company, role, location, emails, phones, sources };
}

/** Swap two adjacent consonants — the misspelling a keyboard produces. */
function transpose(word: string): string {
  for (let i = 1; i < word.length - 2; i++) {
    if (word[i] !== word[i + 1]) {
      return word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
    }
  }
  return word;
}

/**
 * A sibling's first name: the same opening as `first`, a different ending.
 *
 * Two siblings block together on the first-three-letters key, which is the
 * near miss the `siblings` negative measures.
 *
 * The guard matters: when the two names end alike, the parts can spell the
 * base name back ("Edw" and Gaspard's "ard" give "Edward"), and a `siblings`
 * pair with one name measures nothing.
 */
function siblingFirstName(first: string, other: string): string {
  const prefix = first.slice(0, 3);
  const tail = other.length > 3 ? other.slice(3) : other.slice(-3);
  const built = prefix + tail;
  return built === first ? `${built}a` : built;
}

/** Drop one letter of a doubled pair, or the third letter if there is none. */
function dropLetter(word: string): string {
  for (let i = 1; i < word.length - 1; i++) {
    if (word[i] === word[i + 1]) return word.slice(0, i) + word.slice(i + 1);
  }
  return word.slice(0, 2) + word.slice(3);
}

const ACCENTS: [string, string][] = [
  ["a", "á"],
  ["e", "é"],
  ["i", "í"],
  ["o", "ó"],
  ["u", "ú"],
  ["n", "ñ"],
  ["c", "ç"],
  ["s", "š"],
];

/** Put an accent on the first vowel that has one. The export dropped it. */
function accent(word: string): string {
  for (const [plain, marked] of ACCENTS) {
    const at = word.indexOf(plain, 1);
    if (at > 0) return word.slice(0, at) + marked + word.slice(at + 1);
  }
  return word;
}

const DUPLICATE_RECIPES: {
  kind: DuplicateKind;
  build: (p: BasePerson, nickname: string | null) => RecipeOutput | null;
}[] = [
  {
    kind: "typo",
    build: (p) => {
      const misspelt = transpose(p.last);
      if (misspelt === p.last) return null;
      return [
        record(
          `${p.first} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [p.email],
          [],
          ["linkedin"],
        ),
        record(
          `${p.first} ${misspelt}`,
          p.company,
          p.role,
          p.location,
          [],
          [],
          ["csv"],
        ),
      ];
    },
  },
  {
    kind: "typo",
    build: (p) => {
      const misspelt = dropLetter(p.first);
      if (misspelt === p.first || misspelt.length < 3) return null;
      return [
        record(
          `${p.first} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [],
          [p.phone],
          ["apple"],
        ),
        record(
          `${misspelt} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [],
          [],
          ["csv"],
        ),
      ];
    },
  },
  {
    kind: "nickname",
    build: (p, nickname) => {
      if (!nickname) return null;
      return [
        record(
          `${p.first} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [],
          [],
          ["linkedin"],
        ),
        record(
          `${nickname} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [],
          [],
          ["apple"],
        ),
      ];
    },
  },
  {
    kind: "moved-company",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} ${p.last}`,
        `${p.company} Group`,
        "Director",
        p.location,
        [p.email],
        [],
        ["csv"],
      ),
    ],
  },
  {
    kind: "shared-email",
    build: (p, nickname) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${nickname ?? p.first[0] + "."} ${p.last}`,
        p.company,
        null,
        p.location,
        [p.email.toUpperCase()],
        [],
        ["csv"],
      ),
    ],
  },
  {
    kind: "shared-phone",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [p.phone],
        ["apple"],
      ),
      record(
        `${p.first} ${p.last}`,
        p.company,
        null,
        p.location,
        [],
        [p.phone.replace(/[^0-9]/g, "")],
        ["csv"],
      ),
    ],
  },
  {
    kind: "cross-source",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["linkedin"],
      ),
      record(`${p.first} ${p.last}`, null, null, null, [], [], ["apple"]),
    ],
  },
  {
    kind: "initial",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [p.phone],
        ["linkedin"],
      ),
      record(
        `${p.first[0]}. ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [p.phone],
        ["csv"],
      ),
    ],
  },
  {
    kind: "diacritic",
    build: (p) => {
      const marked = accent(p.last);
      if (marked === p.last) return null;
      return [
        record(
          `${p.first} ${marked}`,
          p.company,
          p.role,
          p.location,
          [p.email],
          [],
          ["apple"],
        ),
        record(
          `${p.first} ${p.last}`,
          p.company,
          p.role,
          p.location,
          [p.email],
          [],
          ["csv"],
        ),
      ];
    },
  },
  {
    kind: "married-name",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} ${p.last}-Whitmore`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["apple"],
      ),
    ],
  },
  {
    kind: "middle-name",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} Alexander ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["csv"],
      ),
    ],
  },
  {
    kind: "title-suffix",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["linkedin"],
      ),
      record(
        `Dr. ${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["apple"],
      ),
    ],
  },
  {
    kind: "formatting",
    // Casing and whitespace at both ends, and one space in the middle of each.
    // The exact-name pass keys on the trimmed, lowercased name, so this pair
    // proves it trims and lowercases. A doubled middle space would break the
    // match on its own and hide the trim.
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["apple"],
      ),
      record(
        `  ${p.first.toLowerCase()} ${p.last.toUpperCase()}  `,
        p.company,
        p.role,
        p.location,
        [],
        [],
        ["csv"],
      ),
    ],
  },
];

/**
 * The negative kinds that give both people the same name on purpose.
 *
 * A namesake and two strangers who share a common name are duplicates to
 * every signal the engine has, and that is what makes them worth measuring:
 * they are the ceiling on precision, not a bug to fix. Every other kind must
 * name two different people, which `validateCorpus` enforces.
 */
const SAME_NAME_NEGATIVES: ReadonlySet<NegativeKind> = new Set([
  "namesake",
  "same-common-name",
  "father-and-son",
]);

const NEGATIVE_RECIPES: {
  kind: NegativeKind;
  why: string;
  build: (p: BasePerson, other: BasePerson) => RecipeOutput;
}[] = [
  {
    kind: "father-and-son",
    why: "the tokenizer strips Sr. and Jr., so both records normalize to one name",
    build: (p) => [
      record(
        `${p.first} ${p.last} Sr.`,
        p.company,
        "Partner",
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} ${p.last} Jr.`,
        p.company,
        "Associate",
        p.location,
        [],
        [],
        ["linkedin"],
      ),
    ],
  },
  {
    kind: "shared-landline",
    why: "two people on one household number",
    build: (p, other) => [
      record(
        `${p.first} ${p.last}`,
        null,
        null,
        p.location,
        [],
        [p.phone],
        ["apple"],
      ),
      record(
        `${other.first} ${p.last}`,
        null,
        null,
        p.location,
        [],
        [p.phone],
        ["apple"],
      ),
    ],
  },
  {
    kind: "shared-inbox",
    why: "two colleagues both recorded against a team alias",
    build: (p, other) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [`team.${p.company.split(" ")[0].toLowerCase()}@example.net`],
        [],
        ["csv"],
      ),
      record(
        `${other.first} ${other.last}`,
        p.company,
        p.role,
        p.location,
        [`team.${p.company.split(" ")[0].toLowerCase()}@example.net`],
        [],
        ["csv"],
      ),
    ],
  },
  {
    kind: "same-common-name",
    why: "one name, two unconnected lives",
    build: (p, other) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} ${p.last}`,
        other.company,
        other.role,
        other.location,
        [other.email],
        [],
        ["apple"],
      ),
    ],
  },
  {
    kind: "siblings",
    why: "one surname, one employer, first names that share a prefix",
    build: (p, other) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${siblingFirstName(p.first, other.first)} ${p.last}`,
        p.company,
        other.role,
        p.location,
        [other.email],
        [],
        ["linkedin"],
      ),
    ],
  },
  {
    kind: "colleagues",
    why: "same company, same first initial, phonetically close surnames",
    build: (p, other) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        p.role,
        p.location,
        [p.email],
        [],
        ["linkedin"],
      ),
      record(
        `${p.first} ${transpose(other.last)}`,
        p.company,
        other.role,
        p.location,
        [other.email],
        [],
        ["linkedin"],
      ),
    ],
  },
  {
    kind: "namesake",
    why: "the same full name at the same firm, a generation apart",
    build: (p) => [
      record(
        `${p.first} ${p.last}`,
        p.company,
        "Founder",
        p.location,
        [],
        [],
        ["csv"],
      ),
      record(
        `${p.first} ${p.last}`,
        p.company,
        "Intern",
        p.location,
        [],
        [],
        ["linkedin"],
      ),
    ],
  },
];

// Recipe base people
// Separate pools from the distractors, so a recipe pair can never collide
// with a singleton. The first names are taken from the engine's own nickname
// table, because a nickname recipe that invented its own short forms would be
// testing this file rather than the matcher.

/** Formal first names the nickname table knows a short form for. */
const FORMAL_FIRSTS: [formal: string, short: string][] = NICKNAME_GROUPS.filter(
  (group) => group.length >= 2 && group[0].length >= 6,
)
  .map((group) => [group[0], group[1]] as [string, string])
  .filter(
    ([formal, short]) => /^[a-z]+$/.test(formal) && /^[a-z]+$/.test(short),
  );

const BASE_LAST_POOL =
  "Attwater Brancaster Coldwell Dunmore Eastleigh Fenwicke Garrowby Hatherleigh Inglewood Jessamine Kelsingham Loxworth Mardenhall Netherby Oakhanger Pettigrew Quarrendon Ravelston Stanbridge Tarleton Uffington Vyvyan Wrenbury Yatesbury Zouchley Ashendon Bexwell Corstorphine Dalmahoy Ellersleigh Fordingbridge Granborough Hazelmere Ingoldsby Jerningham".split(
    " ",
  );
/**
 * First names for the second person in a hard negative.
 *
 * Disjoint from `FORMAL_FIRSTS` and the distractor pool, so `other.first`
 * beside a base surname cannot reproduce a base person. Longer than
 * `BASES_PER_RECIPE`, so the 13 indices of one recipe get 13 different people.
 */
const OTHER_FIRST_POOL =
  "Aurelio Bastienne Cressida Damaris Evander Fenella Gaspard Hesper Ilaria Jolyon Konstantin Leocadia Mirabel Nestor Orsolya Pelagia Rurik".split(
    " ",
  );
const OTHER_LAST_POOL =
  "Ardleigh Bettesworth Chafford Drummond-Hay Eskdaill Farthingale Glenholme Harkaway Inverleith Jocelyn Kingsmill Larchfield Monkswood Northiam Ormesby Pilkington Quenington Rushbrooke Swanbourne Thurlestone Ulcombe Verewood Wolverton Yealmpton Zennorby".split(
    " ",
  );
/**
 * Longer than `BASES_PER_RECIPE`, so the company is unique within a recipe.
 * The shared-inbox recipe builds its alias from the company name, and two of
 * its rows at one company would share an unlabeled email link.
 */
const BASE_COMPANY_POOL =
  "Saltmarsh Freight|Tanglewood Press|Undercliff Marine|Verity Assurance|Wainwright Steel|Yarnold Mills|Zebedee Optics|Applecross Foods|Briarcliff Care|Crosthwaite Legal|Dunleavy Motors|Embleton Glass|Fettercairn Paper|Glenbuchat Tiles".split(
    "|",
  );
const BASE_ROLE_POOL =
  "Operations Manager|Senior Analyst|Field Engineer|Client Director|Compliance Officer|Design Lead|Logistics Planner|Research Fellow".split(
    "|",
  );
const BASE_LOCATION_POOL =
  "Norwich, UK|Leuven, BE|Turku, FI|Mendoza, AR|Geelong, AU|Klaipeda, LT|Matsue, JP|Iquique, CL".split(
    "|",
  );

/** How many base people each recipe gets. Recipe count times this is the pair count. */
const BASES_PER_RECIPE = 13;

/**
 * One base person per index, with a name no other index produces.
 *
 * The surname cycles and the first name advances once per full cycle, so the
 * pair (first, last) is a base-`BASE_LAST_POOL.length` counter and every index
 * below `FORMAL_FIRSTS.length * BASE_LAST_POOL.length` gets its own name.
 * Pools that cycle on their own would repeat a name, an unlabeled duplicate.
 */
function baseFor(index: number): BasePerson {
  const first = firstNameFor(index);
  const last = BASE_LAST_POOL[index % BASE_LAST_POOL.length];
  return {
    first,
    last,
    company: BASE_COMPANY_POOL[index % BASE_COMPANY_POOL.length],
    role: BASE_ROLE_POOL[index % BASE_ROLE_POOL.length],
    location: BASE_LOCATION_POOL[index % BASE_LOCATION_POOL.length],
    email: `${first}.${last}${index}@example.com`.toLowerCase(),
    phone: `+1 206 555 ${String(3000 + index).slice(-4)}`,
  };
}

/**
 * The second person in a hard negative: the sibling, the flatmate, the
 * colleague. Its own surname pool, disjoint from every other pool here, so it
 * cannot collide with a primary base or with a distractor.
 *
 * The first name comes from `OTHER_FIRST_POOL`, not `firstNameFor(index + 1)`.
 * `firstNameFor` changes the name once per surname cycle of 35, so most pairs
 * would get one first name twice, and a sibling or shared-landline pair of
 * one name is something no engine can separate. A name from `FORMAL_FIRSTS`
 * would collide with a later base index.
 */
function otherFor(index: number): BasePerson {
  const first = OTHER_FIRST_POOL[index % OTHER_FIRST_POOL.length];
  const last = OTHER_LAST_POOL[index % OTHER_LAST_POOL.length];
  return {
    first,
    last,
    company: BASE_COMPANY_POOL[(index + 5) % BASE_COMPANY_POOL.length],
    role: BASE_ROLE_POOL[(index + 3) % BASE_ROLE_POOL.length],
    location: BASE_LOCATION_POOL[(index + 2) % BASE_LOCATION_POOL.length],
    email: `${first}.${last}${index}o@example.com`.toLowerCase(),
    phone: `+1 206 555 ${String(6000 + index).slice(-4)}`,
  };
}

/** Index into the formal-name table, advancing once per surname cycle. */
function formalIndex(index: number): number {
  return Math.floor(index / BASE_LAST_POOL.length) % FORMAL_FIRSTS.length;
}

/** `robert` → `Robert`. */
function firstNameFor(index: number): string {
  const [formal] = FORMAL_FIRSTS[formalIndex(index)];
  return formal[0].toUpperCase() + formal.slice(1);
}

/** The short form of a base person's first name, from the engine's own table. */
function nicknameFor(index: number): string | null {
  const [, short] = FORMAL_FIRSTS[formalIndex(index)];
  return short ? short[0].toUpperCase() + short.slice(1) : null;
}

// Distractors

const FIRST_POOL =
  "Adaeze Bartholomew Celestine Dashiell Eulalia Ferdinand Genevieve Horatio Isolde Jarrah Kalinda Lysander Marisol Nikolas Ottoline Peregrine Quillon Rosalba Sylvester Thandiwe Ulrich Verity Wendell Xiomara Yannick Zenobia Ambrose Bronwyn Caspian Delphine Emeric Fionnuala Gideon Hyacinth Ignatius Jocasta Kendrick Lavinia Montgomery Natania".split(
    " ",
  );
const LAST_POOL =
  "Abernathy Blackwood Castellanos Duquesne Eberhardt Fairweather Gallowglass Hollingsworth Ivanovic Jankowski Kirkpatrick Lindstrom Marchetti Nightingale Ostrowski Pennyworth Quintanilla Ravensworth Stavropoulos Thornbury Underhill Vandermeer Wetherby Yoshimura Zaragoza Ashcombe Braithwaite Cadwallader Delacourt Ellingham".split(
    " ",
  );
const COMPANY_POOL =
  "Sundial Freight|Tallow Candles|Ursine Outdoors|Verdigris Paint|Whetstone Tools|Xenon Lighting|Yewtree Nursery|Zinnia Florists|Alcove Interiors|Bramble Jam|Carrick Stone|Damson Preserves".split(
    "|",
  );
const ROLE_POOL =
  "Bookkeeper|Logistics Coordinator|Field Technician|Account Manager|Quality Inspector|Warehouse Lead|Copywriter|Systems Analyst".split(
    "|",
  );
const LOCATION_POOL =
  "Bristol, UK|Ghent, BE|Tartu, EE|Salta, AR|Hobart, AU|Kaunas, LT|Nagano, JP|Arica, CL".split(
    "|",
  );

const DISTRACTOR_COUNT = 90;

/**
 * Singletons that belong to nobody else in the corpus.
 *
 * The pools are disjoint from every name used above, so a distractor can only
 * collide with another distractor, and `validateCorpus` refuses the corpus if
 * one does.
 */
function buildDistractors(): EvalContact[] {
  const rand = createRng(0x9e3779b9);
  const out: EvalContact[] = [];
  const usedNames = new Set<string>();

  let attempts = 0;
  while (out.length < DISTRACTOR_COUNT && attempts < DISTRACTOR_COUNT * 50) {
    attempts++;
    const first = FIRST_POOL[Math.floor(rand() * FIRST_POOL.length)];
    const last = LAST_POOL[Math.floor(rand() * LAST_POOL.length)];
    const name = `${first} ${last}`;
    const norm = tokenizeName(name).join(" ");
    if (usedNames.has(norm)) continue;
    usedNames.add(norm);

    const index = out.length;
    out.push({
      key: `distractor-${index}`,
      personKey: `distractor-${index}`,
      name,
      company: COMPANY_POOL[Math.floor(rand() * COMPANY_POOL.length)],
      role: ROLE_POOL[Math.floor(rand() * ROLE_POOL.length)],
      location: LOCATION_POOL[Math.floor(rand() * LOCATION_POOL.length)],
      emails: [`${first}.${last}${index}@example.org`.toLowerCase()],
      phones: [`+1 415 555 ${String(2000 + index).slice(-4)}`],
      sources: [index % 2 === 0 ? "linkedin" : "apple"],
    });
  }
  return out;
}

// Assembly

/** `a;b` → `["a", "b"]`, and `-` → `[]`. */
function list(field: string): string[] {
  if (field === "-" || field.trim() === "") return [];
  return field
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/** `-` → null, anything else unchanged. */
function orNull(field: string): string | null {
  return field === "-" || field.trim() === "" ? null : field;
}

function parseRecord(
  key: string,
  personKey: string,
  record: string,
): EvalContact {
  const [name, company, role, location, emails, phones, sources] =
    record.split("|");
  if (sources === undefined) {
    throw new Error(`dedupe-eval: record for ${key} has too few fields`);
  }
  return {
    key,
    personKey,
    name,
    company: orNull(company),
    role: orNull(role),
    location: orNull(location),
    emails: list(emails),
    phones: list(phones),
    sources: list(sources),
  };
}

/**
 * Build the corpus.
 *
 * Throws on a corpus that has drifted, because its numbers would still come
 * out but measure a different thing.
 */
export function buildCorpus(): Corpus {
  const contacts: EvalContact[] = [];
  const duplicates: DuplicatePair[] = [];

  for (const [personKey, kind, ...records] of GROUPS) {
    if (records.length < 2) {
      throw new Error(`dedupe-eval: group ${personKey} has one record`);
    }
    const keys: string[] = [];
    records.forEach((record, index) => {
      const key = `${personKey}-${index + 1}`;
      keys.push(key);
      contacts.push(parseRecord(key, personKey, record));
    });
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        duplicates.push({ a: keys[i], b: keys[j], kind });
      }
    }
  }

  const negatives: NegativePair[] = [];
  NEGATIVE_ROWS.forEach(([kind, why, a, b], index) => {
    const keyA = `neg-${index + 1}-a`;
    const keyB = `neg-${index + 1}-b`;
    contacts.push(parseRecord(keyA, `neg-${index + 1}-a`, a));
    contacts.push(parseRecord(keyB, `neg-${index + 1}-b`, b));
    negatives.push({ a: keyA, b: keyB, kind, why });
  });

  // Recipe-built duplicates. Each recipe gets its own slice of base people, so
  // a recipe that returns null for a base (a transposition that changed
  // nothing, a first name with no short form) leaves a gap rather than
  // shifting every later pair onto a different person.
  let baseIndex = 0;
  DUPLICATE_RECIPES.forEach((recipe, recipeIndex) => {
    for (let i = 0; i < BASES_PER_RECIPE; i++) {
      const index = baseIndex++;
      const built = recipe.build(baseFor(index), nicknameFor(index));
      if (!built) continue;
      const personKey = `recipe-${recipe.kind}-${recipeIndex}-${i}`;
      const keys = built.map((fields, n) => {
        const key = `${personKey}-${n + 1}`;
        contacts.push({ ...fields, key, personKey });
        return key;
      });
      duplicates.push({ a: keys[0], b: keys[1], kind: recipe.kind });
    }
  });

  // Recipe-built hard negatives. The second base person supplies the other
  // half of the near miss: the sibling's first name, the colleague's surname.
  NEGATIVE_RECIPES.forEach((recipe, recipeIndex) => {
    for (let i = 0; i < BASES_PER_RECIPE; i++) {
      const index = baseIndex++;
      const built = recipe.build(baseFor(index), otherFor(index));
      const keyBase = `negrecipe-${recipe.kind}-${recipeIndex}-${i}`;
      const keys = built.map((fields, n) => {
        const key = `${keyBase}-${n + 1}`;
        contacts.push({ ...fields, key, personKey: key });
        return key;
      });
      negatives.push({
        a: keys[0],
        b: keys[1],
        kind: recipe.kind,
        why: recipe.why,
      });
    }
  });

  contacts.push(...buildDistractors());

  const corpus = { contacts, duplicates, negatives };
  validateCorpus(corpus);
  return corpus;
}

/** Canonical key for a pair, independent of the order the two keys arrive in. */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Refuse a corpus whose ground truth is not the truth.
 *
 * The gate counts every produced pair not in `duplicates` as a false
 * positive, which is fair only if the corpus holds no other duplicates. Each
 * check below catches a contact whose name, email or phone matches somebody
 * in another group.
 */
export function validateCorpus(corpus: Corpus): void {
  const { contacts, duplicates, negatives } = corpus;

  const byKey = new Map(contacts.map((c) => [c.key, c]));

  const keys = new Set<string>();
  for (const contact of contacts) {
    if (keys.has(contact.key)) {
      throw new Error(`dedupe-eval: duplicate contact key ${contact.key}`);
    }
    keys.add(contact.key);
    if (!contact.name.trim()) {
      throw new Error(`dedupe-eval: ${contact.key} has no name`);
    }
  }

  for (const pair of [...duplicates, ...negatives]) {
    for (const key of [pair.a, pair.b]) {
      if (!keys.has(key)) {
        throw new Error(`dedupe-eval: pair names unknown contact ${key}`);
      }
    }
  }

  const named = new Set<string>();
  for (const pair of duplicates) named.add(pairId(pair.a, pair.b));
  for (const pair of negatives) named.add(pairId(pair.a, pair.b));

  // An accidental identity overlap between two groups. Either it is a
  // duplicate nobody labeled, or it is a near miss nobody named.
  const byName = new Map<string, EvalContact[]>();
  const byEmail = new Map<string, EvalContact[]>();
  const byPhone = new Map<string, EvalContact[]>();
  for (const contact of contacts) {
    const nameKey = tokenizeName(contact.name).join(" ");
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey)!.push(contact);
    for (const email of contact.emails) {
      const norm = email.toLowerCase().trim();
      if (!byEmail.has(norm)) byEmail.set(norm, []);
      byEmail.get(norm)!.push(contact);
    }
    for (const phone of contact.phones) {
      const norm = normalizePhone(phone);
      if (norm.length < 7) continue;
      if (!byPhone.has(norm)) byPhone.set(norm, []);
      byPhone.get(norm)!.push(contact);
    }
  }

  for (const [label, index] of [
    ["name", byName],
    ["email", byEmail],
    ["phone", byPhone],
  ] as const) {
    for (const [value, group] of index) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          if (a.personKey === b.personKey) continue;
          if (named.has(pairId(a.key, b.key))) continue;
          throw new Error(
            `dedupe-eval: ${a.key} and ${b.key} share the ${label} "${value}" ` +
              `but are neither one person nor a named hard negative`,
          );
        }
      }
    }
  }

  // A hard negative that carries one name twice. The check above allows a
  // labeled negative to share a name, and two kinds are built to. For the
  // rest, two records that agree on every field measure nothing: the gate
  // would count an engine error that no engine change can remove.
  for (const pair of negatives) {
    if (SAME_NAME_NEGATIVES.has(pair.kind)) continue;
    const a = byKey.get(pair.a)!;
    const b = byKey.get(pair.b)!;
    if (tokenizeName(a.name).join(" ") !== tokenizeName(b.name).join(" ")) {
      continue;
    }
    throw new Error(
      `dedupe-eval: the ${pair.kind} negative ${pair.a}/${pair.b} gives both ` +
        `people the name "${a.name}". Only ${[...SAME_NAME_NEGATIVES].join(" and ")} ` +
        `are built that way, and a pair no signal can separate measures nothing`,
    );
  }
}
