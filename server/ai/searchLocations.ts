import type { QueryLocationConstraint } from "./types.ts";

const normalize = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const contains = (text: string, phrase: string): boolean =>
  phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
const countries: Record<string, string[]> = {
  us: [
    "united states",
    "united states of america",
    "usa",
    "u.s.",
    "u.s.a.",
    "america",
    "us",
  ],
  uk: ["united kingdom", "uk", "u.k.", "great britain", "britain"],
  canada: ["canada"],
  germany: ["germany", "deutschland"],
  france: ["france"],
  india: ["india"],
  australia: ["australia"],
  japan: ["japan"],
  singapore: ["singapore"],
  netherlands: ["netherlands"],
  ireland: ["ireland"],
  spain: ["spain"],
  switzerland: ["switzerland"],
  brazil: ["brazil"],
};
for (const aliases of Object.values(countries)) {
  aliases.splice(0, aliases.length, ...aliases.map(normalize));
}

const states =
  "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming|DC:District of Columbia";
const regions = states.split("|").map((entry) => {
  const [code, name] = entry.split(":");
  return { code, name: normalize(name), country: "us" };
});
regions.push(
  { code: "ON", name: "ontario", country: "canada" },
  { code: "BC", name: "british columbia", country: "canada" },
  { code: "QC", name: "quebec", country: "canada" },
  { code: "ENG", name: "england", country: "uk" },
  { code: "SCT", name: "scotland", country: "uk" },
  { code: "WLS", name: "wales", country: "uk" },
  { code: "NIR", name: "northern ireland", country: "uk" },
);
const regionNamesByLength = [...regions].sort(
  (a, b) => b.name.length - a.name.length,
);
const regionCodePatterns = regions.map((region) => ({
  region,
  pattern: new RegExp(`\\b${region.code.split("").join("\\.?")}\\b`),
}));

const placeQualifiers = [
  ...Object.values(countries).flat(),
  ...regions.flatMap(({ name, code }) => [
    name,
    normalize(code),
    normalize(code.split("").join(".")),
  ]),
].sort((a, b) => b.length - a.length);
// A reviewed dictionary provides parent places only when the input has no conflicting qualifier.
const cities: [string, string | undefined, string][] = [
  ["san francisco", "california", "us"],
  ["sf", "california", "us"],
  ["bay area", "california", "us"],
  ["new york city", "new york", "us"],
  ["nyc", "new york", "us"],
  ["boston", "massachusetts", "us"],
  ["cambridge", "massachusetts", "us"],
  ["cambridge", "england", "uk"],
  ["london", "england", "uk"],
  ["london", "ontario", "canada"],
  ["seattle", "washington", "us"],
  ["austin", "texas", "us"],
  ["los angeles", "california", "us"],
  ["chicago", "illinois", "us"],
  ["denver", "colorado", "us"],
  ["portland", "oregon", "us"],
  ["portland", "maine", "us"],
  ["toronto", "ontario", "canada"],
  ["vancouver", "british columbia", "canada"],
  ["montreal", "quebec", "canada"],
  ["berlin", undefined, "germany"],
  ["munich", undefined, "germany"],
  ["paris", undefined, "france"],
  ["bangalore", undefined, "india"],
  ["bengaluru", undefined, "india"],
  ["mumbai", undefined, "india"],
  ["sydney", undefined, "australia"],
  ["melbourne", undefined, "australia"],
  ["tokyo", undefined, "japan"],
  ["amsterdam", undefined, "netherlands"],
  ["dublin", undefined, "ireland"],
  ["madrid", undefined, "spain"],
  ["zurich", undefined, "switzerland"],
  ["sao paulo", undefined, "brazil"],
  ["oxford", "england", "uk"],
  ["edinburgh", "scotland", "uk"],
  ["belfast", "northern ireland", "uk"],
];
const canonicalCity = (name: string): string =>
  ({ sf: "san francisco", nyc: "new york city", bengaluru: "bangalore" })[
    name
  ] ?? name;

function parsePlace(
  sourcePhrase: string,
  inferParents: boolean,
): QueryLocationConstraint {
  const text = normalize(sourcePhrase);
  const result: QueryLocationConstraint = { sourcePhrase };
  const explicitCountries = Object.entries(countries).filter(([, aliases]) =>
    aliases.some(
      (alias) =>
        contains(text, alias) &&
        !(alias === "ireland" && contains(text, "northern ireland")),
    ),
  );
  if (explicitCountries.length === 1) result.country = explicitCountries[0][0];
  // Codes require uppercase in source text. This prevents "in" and "or" becoming states.
  const region =
    regionCodePatterns.find(({ pattern }) => pattern.test(sourcePhrase))
      ?.region ?? regionNamesByLength.find(({ name }) => contains(text, name));
  if (region) {
    result.region = region.name;
    result.country ??= region.country;
  }
  const hits = cities.filter(([name]) => {
    if (!contains(text, name)) return false;
    // A named city must start a place component. New London is not London.
    return sourcePhrase.split(",").some((component) => {
      const normalized = normalize(component);
      const index = ` ${normalized} `.indexOf(` ${name} `);
      if (index < 0) return false;
      return /^(?:the|greater|city of)?$/.test(
        normalized.slice(0, index).trim(),
      );
    });
  });
  const longest = hits.reduce(
    (length, [name]) => Math.max(length, name.length),
    0,
  );
  const candidates = hits.filter(([name]) => name.length === longest);
  if (candidates.length) {
    result.city = canonicalCity(candidates[0][0]);
    const compatible = candidates.filter(
      ([, r, c]) =>
        (!result.country || c === result.country) &&
        (!result.region || r === result.region),
    );
    if (inferParents && compatible.length === 1) {
      result.region ??= compatible[0][1];
      result.country ??= compatible[0][2];
    }
  }
  if (
    inferParents &&
    !result.city &&
    result.region === "new york" &&
    /^new york(?:,|$)/i.test(sourcePhrase.trim())
  )
    result.city = "new york city";
  if (explicitCountries.length > 1) result.literal = text; // Preserve contradictory qualifiers instead of widening the match.
  if (!result.city && !result.region && !result.country) result.literal = text;
  if (!result.city && (result.region || result.country)) {
    let remainder = ` ${text} `;
    for (const qualifier of placeQualifiers)
      remainder = remainder.replace(` ${qualifier} `, " ");
    remainder = remainder.replace(/\bthe\b/g, "").trim();
    if (result.region) remainder = remainder.replace(/\bstate\b/g, "").trim();
    if (remainder) result.literal = remainder;
  }
  return result;
}

/** Extract only locations grounded in a location phrase or an exact planner suggestion. */
export function extractQueryLocations(
  query: string,
  legacyMatchers: string[] = [],
): QueryLocationConstraint[] {
  const phrases: string[] = [];
  let excludedPhrase = false;
  const pattern =
    /\b(?:in|near|around|from|based in|located in)\s+(.+?)(?=\s+\b(?:who|with|working|works|interested|at|that|which|and who|except|excluding|outside|not|but)\b|[?!;]|$)/gi;
  for (const match of query.matchAll(pattern)) {
    const prefix = query.slice(0, match.index).trim();
    if (
      /\b(?:not|except|excluding|outside|anywhere but|don['’]t|doesn['’]t|aren['’]t|no longer)\b(?:\s+(?!(?:who|that|and|but)\b)\w+){0,5}\s*$/i.test(
        prefix,
      )
    ) {
      excludedPhrase = true;
      continue;
    }
    if (
      /\b(?:interested|interest|interests|experience|experienced|expertise|specialize|specializes|specializing|invest|invests|investing|work|works|working)\s*$/i.test(
        prefix,
      )
    ) {
      excludedPhrase = true;
      continue;
    }
    const phrase = match[1].trim();
    if (/^from\b/i.test(match[0])) {
      const parsed = parsePlace(phrase, false);
      if (
        parsed.literal &&
        !legacyMatchers.some((matcher) =>
          contains(normalize(phrase), normalize(matcher)),
        )
      )
        continue;
    }
    // "or" and "and" join alternative places. A comma joins city and qualifiers.
    for (const part of phrase.split(/\s+(?:or|and)\s+/i)) {
      const parsed = parsePlace(part, false);
      const grounded = legacyMatchers.some(
        (matcher) =>
          matcher.trim() && contains(normalize(part), normalize(matcher)),
      );
      if (
        part.trim() &&
        (!parsed.literal ||
          parsed.city ||
          parsed.region ||
          parsed.country ||
          grounded ||
          /^(?:based|located) in\b/i.test(match[0]))
      )
        phrases.push(part.trim());
    }
  }
  if (
    !phrases.length &&
    !excludedPhrase &&
    !/\b(?:not|outside|except|excluding|anywhere but)\b/i.test(query)
  ) {
    for (const alternative of query.split(/\s+(?:or|and)\s+/i)) {
      const spans = legacyMatchers.flatMap((matcher) => {
        const tokens = normalize(matcher).split(" ").filter(Boolean);
        if (!tokens.length) return [];
        const pattern = new RegExp(
          `(?<![\\p{L}\\p{N}])${tokens.join("[\\s.,-]+")}(?![\\p{L}\\p{N}])`,
          "iu",
        );
        const match = pattern.exec(alternative);
        return match
          ? [{ start: match.index, end: match.index + match[0].length }]
          : [];
      });
      if (spans.length)
        phrases.push(
          alternative.slice(
            Math.min(...spans.map((span) => span.start)),
            Math.max(...spans.map((span) => span.end)),
          ),
        );
    }
  }
  return phrases
    .filter((phrase) => normalize(phrase).length > 0)
    .map((phrase) => parsePlace(phrase, false));
}

/** Every field in one constraint must match. Separate constraints are alternatives. */
export function matchesQueryLocations(
  contactLocation: string,
  constraints: QueryLocationConstraint[],
): boolean {
  if (!constraints.length) return true;
  const contact = parsePlace(contactLocation, true);
  const text = normalize(contactLocation);
  return constraints.some(
    (constraint) =>
      Boolean(
        constraint.city ||
        constraint.region ||
        constraint.country ||
        constraint.literal,
      ) &&
      (!constraint.city || constraint.city === contact.city) &&
      (!constraint.region || constraint.region === contact.region) &&
      (!constraint.country || constraint.country === contact.country) &&
      (!constraint.literal || contains(text, constraint.literal)),
  );
}
