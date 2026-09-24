import type { QueryPlan } from "./types.ts";
import { extractQueryLocations } from "./searchLocations.ts";

/** Reviewed equivalences. Broader occupations never imply leadership or seniority. */
const roleFamilies = [
  {
    pattern:
      /\b(?:works?|working|people|contacts)\s+in\s+accounting\b|\baccountants?\b/i,
    aliases: ["Accountant", "Accounting"],
  },
  {
    pattern: /\bleaders?\b/i,
    aliases: [
      "Founder",
      "Co-Founder",
      "CEO",
      "CTO",
      "CFO",
      "Chief Executive Officer",
      "Chief Technology Officer",
      "Chief Financial Officer",
      "Director",
      "Vice President",
      "Head",
      "Engineering Manager",
      "Staff Software Engineer",
      "Principal Engineer",
      "Principal Software Engineer",
      "Technical Lead",
    ],
  },
  {
    pattern: /\bresearchers?\b/i,
    aliases: ["Researcher", "Research Fellow", "Research Scientist"],
  },
  {
    pattern: /\binvestors?\b/i,
    aliases: [
      "Investor",
      "Venture Capitalist",
      "Investment Partner",
      "Partner",
      "Venture Scout",
    ],
  },
  {
    pattern: /\bsoftware engineers?\b/i,
    aliases: ["Software Engineer", "Software Developer", "SWE"],
  },
  { pattern: /\bpartners?\b/i, aliases: ["Partner", "General Partner", "GP"] },
  {
    pattern: /\b(?:co[ -]?)?founders?\b/i,
    aliases: ["Founder", "Co-Founder", "Cofounder"],
  },
  {
    pattern: /\bbrain surgeons?\b/i,
    aliases: ["Brain Surgeon", "Neurosurgeon"],
  },
  {
    pattern: /\bchief legal officers?\b/i,
    aliases: ["Chief Legal Officer", "CLO", "General Counsel"],
  },
  {
    pattern: /\bpolicy advis[eo]rs?\b/i,
    aliases: ["Policy Adviser", "Policy Advisor"],
  },
  { pattern: /\bCEO\b/i, aliases: ["CEO", "Chief Executive Officer"] },
] as const;

const industryFamilies = [
  { pattern: /\bbiotech(?:nology)?\b/i, aliases: ["Biotech", "Biotechnology"] },
  { pattern: /\bfintech\b/i, aliases: ["Fintech", "Financial Technology"] },
  {
    pattern: /\bclimate(?:tech)?\b/i,
    aliases: ["Climate", "ClimateTech", "Cleantech"],
  },
  { pattern: /\bmaritime\b/i, aliases: ["Maritime"] },
] as const;

/**
 * The forms a role's last word takes in a job title, so the word a person
 * asks with finds the word a title uses.
 *
 * The planner keeps a role only when its words are in the question, and the
 * filters then matched them as whole words. So "engineer" never found a
 * contact whose role is Engineering, "designers" never found Design, and
 * "who works in marketing" never found a Marketer. Three pairs cover the
 * titles people write:
 *
 *   - a person and a field: engineer and engineering, designer and design,
 *     marketer and marketing, consultant and consulting;
 *   - the plural of each;
 *   - nothing for an acronym or a short word ("CEO", "GP", "VP").
 *
 * The first words of a phrase stay as they are: "Software Engineer" finds
 * Software Engineering, and not every engineer. A field never takes its bare
 * stem, so "accounting" does not find an Account Executive.
 *
 * @param matcher - A role matcher from the plan, such as "Designer".
 * @returns The matcher and its other forms, lowercased, the matcher first.
 */
export function roleVariants(matcher: string): string[] {
  const words = matcher.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const last = words.pop();
  if (!last) return [];
  const prefix = words.length ? `${words.join(" ")} ` : "";
  const forms = new Set<string>([last]);
  const isAcronym = matcher.trim().split(/\s+/).pop() === last.toUpperCase();
  if (last.length > 3 && !isAcronym) {
    const base = /[^s]s$/.test(last) ? last.slice(0, -1) : last;
    forms.add(base);
    if (base.endsWith("eer")) {
      // engineer: engineering
      forms.add(`${base}ing`);
    } else if (base.endsWith("er")) {
      // designer: design, designing
      const root = base.slice(0, -2);
      forms.add(root);
      forms.add(`${root}ing`);
    } else if (base.endsWith("ant")) {
      // consultant: consulting
      forms.add(`${base.slice(0, -3)}ing`);
    } else if (base.endsWith("ing")) {
      // engineering: engineer. marketing: marketer. consulting: consultant.
      const root = base.slice(0, -3);
      if (root.endsWith("eer")) forms.add(root);
      forms.add(`${root}er`);
      forms.add(`${root}ant`);
    } else {
      // design: designer
      forms.add(`${base}er`);
    }
  }
  const all = [...forms].flatMap((form) =>
    /(?:s|ing)$/.test(form) ? [form] : [form, `${form}s`],
  );
  return [...new Set(all)].map((form) => `${prefix}${form}`);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Return the actual phrase, including a simple plural, from the user's query. */
function literalEvidence(query: string, value: string): string | undefined {
  const words = normalize(value).split(" ").filter(Boolean);
  if (!words.length) return undefined;
  const phrase = words
    .map((word, index) => (index === words.length - 1 ? `${word}s?` : word))
    .join("[\\s'-]+");
  return query.match(
    new RegExp(`(?<![\\p{L}\\p{N}])${phrase}(?![\\p{L}\\p{N}])`, "iu"),
  )?.[0];
}

function isNegated(query: string, phrase: string): boolean {
  const index = normalize(query).indexOf(normalize(phrase));
  const prefix = normalize(query).slice(Math.max(0, index - 75), index);
  return /\b(?:not|except|excluding|without|former|previous|ex|used to|no longer)\b(?:\s+\w+){0,5}\s*$/.test(
    prefix,
  );
}

function groundedMatchers(
  query: string,
  matchers: readonly string[] | undefined,
  preferSpecific = false,
): { values: string[]; source?: string } {
  const values: string[] = [];
  let source: string | undefined;
  let remaining = query;
  const ordered = preferSpecific
    ? [...(matchers ?? [])].sort((a, b) => b.length - a.length)
    : (matchers ?? []);
  for (const matcher of ordered) {
    const phrase = literalEvidence(remaining, matcher);
    if (phrase && !isNegated(query, phrase)) {
      values.push(matcher);
      source ??= phrase;
      if (preferSpecific) {
        // Consume this qualified phrase. A separate OR alternative stays visible.
        let occurrence: string | undefined = phrase;
        while (occurrence) {
          remaining = remaining.replace(
            occurrence,
            " ".repeat(occurrence.length),
          );
          occurrence = literalEvidence(remaining, matcher);
        }
      }
    }
  }
  return { values: [...new Set(values)], source };
}

function familyMatchers(
  query: string,
  families: readonly { pattern: RegExp; aliases: readonly string[] }[],
) {
  const values: string[] = [];
  const sources: string[] = [];
  for (const family of families) {
    const match = query.match(family.pattern);
    const phrase = match?.[0];
    if (!phrase || isNegated(query, phrase)) continue;
    const before = query.slice(0, match.index);
    const qualifier = before.match(
      /\b(senior|staff|principal|lead|junior|associate|assistant|managing)\s*$/i,
    )?.[1];
    const aliases = qualifier
      ? family.aliases.map((alias) => `${qualifier} ${alias}`)
      : [...family.aliases];
    values.push(...aliases);
    sources.push(qualifier ? `${qualifier} ${phrase}` : phrase);
  }
  return values.length
    ? {
        values: [...new Set(values)],
        sources,
        source: sources.length === 1 ? sources[0] : query,
      }
    : undefined;
}

/** Keep explicit alternatives that the reviewed dictionary does not contain. */
function combinedMatchers(
  query: string,
  families: readonly { pattern: RegExp; aliases: readonly string[] }[],
  rawMatchers: readonly string[] | undefined,
  preferSpecific = false,
) {
  const family = familyMatchers(query, families);
  let remainder = query;
  for (const phrase of family?.sources ?? []) {
    remainder = remainder.replace(phrase, " ".repeat(phrase.length));
  }
  const grounded = groundedMatchers(remainder, rawMatchers, preferSpecific);
  const sources = [
    ...(family?.sources ?? []),
    ...(grounded.source ? [grounded.source] : []),
  ];
  return {
    values: [...new Set([...(family?.values ?? []), ...grounded.values])],
    sources,
    source: sources.length === 1 ? sources[0] : query,
  };
}

/** Employer phrases do not provide evidence about where a contact lives. */
function maskEmployerClauses(query: string): string {
  return query.replace(
    /\b(?:works? at|working at|at|works? for|working for|employed by)\s+[^,?]+?(?=\s+(?:in|who|that|with|and|or)\b|[?,]|$)/gi,
    (phrase) => " ".repeat(phrase.length),
  );
}

/**
 * Compile model output into constraints with query evidence. The original query
 * remains authoritative. Model-generated source text cannot authorize a filter.
 */
export function compileQueryPlan(query: string, raw: QueryPlan): QueryPlan {
  const plan: QueryPlan = {
    ...raw,
    must: {},
    should: {
      ...raw.should,
      ...(raw.should.traits ? { traits: [...raw.should.traits] } : {}),
    },
    evidence: {},
  };
  const locations = extractQueryLocations(
    maskEmployerClauses(query),
    raw.must.locationMatchers,
  );
  if (locations.length) {
    plan.must.locations = locations;
    // Legacy display and evaluation channels retain only the exact place parts.
    plan.must.locationMatchers = [
      ...new Set(
        locations.flatMap((location) =>
          [
            location.city,
            location.region,
            location.country,
            location.literal,
          ].filter((value): value is string => Boolean(value)),
        ),
      ),
    ];
    plan.evidence!.location = locations
      .map((location) => location.sourcePhrase)
      .join("; ");
    if (plan.should.traits) {
      const placeParts = new Set(plan.must.locationMatchers.map(normalize));
      plan.should.traits = plan.should.traits.filter(
        (trait) => !placeParts.has(normalize(trait)),
      );
      if (!plan.should.traits.length) delete plan.should.traits;
    }
  }

  const placeParts = new Set(plan.must.locationMatchers?.map(normalize));
  const outsideLocations = (values: string[] | undefined) =>
    values?.filter((value) => !placeParts.has(normalize(value)));
  const company = groundedMatchers(
    query,
    outsideLocations(raw.must.companyMatchers),
    true,
  );
  if (company.values.length) {
    plan.must.companyMatchers = company.values;
    plan.evidence!.company = company.source;
  }
  // Company and place names can contain occupation or industry words.
  // Those occurrences do not authorize a second constraint on another field.
  let intentQuery = query;
  for (const value of [
    ...company.values,
    ...locations.map((location) => location.sourcePhrase),
  ]) {
    const phrase = literalEvidence(intentQuery, value);
    if (phrase)
      intentQuery = intentQuery.replace(phrase, " ".repeat(phrase.length));
  }
  intentQuery = maskEmployerClauses(intentQuery);
  const industryQuery = intentQuery.replace(
    /\b(?:interested in|interests? in|love|loves|enjoy|enjoys|invest in|invests in|investing in)\s+[^,?]+?(?=\s+(?:and|but)\s+(?:work|works|working|serve|serves|are|is|lead|leads)\b|[?,]|$)/gi,
    (phrase) => " ".repeat(phrase.length),
  );
  const role = combinedMatchers(
    industryQuery,
    roleFamilies,
    outsideLocations(raw.must.roleMatchers)?.filter(
      (value) =>
        !company.values.some((companyName) =>
          literalEvidence(companyName, value),
        ) &&
        !["person", "people", "contact", "contacts", "network"].includes(
          normalize(value),
        ) &&
        !industryFamilies.some((family) =>
          family.aliases.some((alias) => normalize(alias) === normalize(value)),
        ),
    ),
    true,
  );
  if (role.values.length) {
    plan.must.roleMatchers = role.values;
    plan.evidence!.role =
      role.source && query.includes(role.source) ? role.source : query;
  }
  const industry = combinedMatchers(
    industryQuery,
    industryFamilies,
    outsideLocations(raw.must.industryMatchers)?.filter(
      (value) =>
        ![company.source, ...role.sources].some(
          (source) => source && literalEvidence(source, value),
        ),
    ),
  );
  if (industry.values.length) {
    plan.must.industryMatchers = industry.values;
    plan.evidence!.industry =
      industry.source && query.includes(industry.source)
        ? industry.source
        : query;
  }

  // The executor supports only "older than N days" and "never contacted".
  // Recent/within requests must not invert into an older-than restriction.
  const never = query.match(
    /\bnever\s+(?:contacted|spoken\s+to|talked\s+to|met)\b/i,
  );
  const older = query.match(
    /\b(?:haven['’]?t|have not|not)\s+(?:contacted|spoken\s+to|talked\s+to|met|seen|reached\s+out\s+to)(?:\s+\w+){0,4}?\s+(?:in|for|over)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(days?|weeks?|months?|years?)\b/i,
  );
  if (never) {
    plan.must.temporal = { type: "neverContacted" };
    plan.evidence!.temporal = never[0];
  } else if (older) {
    const multiplier = older[2].toLowerCase().startsWith("week")
      ? 7
      : older[2].toLowerCase().startsWith("month")
        ? 30
        : older[2].toLowerCase().startsWith("year")
          ? 365
          : 1;
    const writtenNumbers: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
    };
    const amount = writtenNumbers[older[1].toLowerCase()] ?? Number(older[1]);
    const daysAgo = amount * multiplier;
    if (daysAgo <= 36_500) {
      plan.must.temporal = { type: "lastContact", daysAgo };
      plan.evidence!.temporal = older[0];
    }
  }
  return plan;
}
