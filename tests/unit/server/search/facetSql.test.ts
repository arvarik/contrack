// =============================================================================
// Unit Tests — facets as SQL agree with the palette's matchesFacet
// =============================================================================
// The palette filters its cached contacts with `matchesFacet`, and the server
// now compiles the same facets into SQL. A person must see the same people
// either way, so every facet runs both ways on the same rows: lower and
// upper case, accents, quotes, blank and whitespace values, NULLs, the three
// date forms the columns hold, a date nothing can read, and coordinates on
// both sides of the 180th meridian.
// =============================================================================

import { describe, it, expect, beforeAll, vi } from "vitest";
import crypto from "crypto";

vi.unmock("../../../../server/db.ts");
const { sqlite } = await import("../../../../server/db.ts");
const { scopeForOwnerId } = await import("../../../../server/tenancy/scope.ts");
const { compileFacets, facetKey } =
  await import("../../../../server/services/search/facetSql.ts");
const { matchesFacet } = await import("../../../../shared/searchFacets.ts");
type FacetFilter = import("../../../../shared/searchFacets.ts").FacetFilter;
type FacetContact = import("../../../../shared/searchFacets.ts").FacetContact;

const owner = `user-${crypto.randomUUID()}`;
const other = `user-${crypto.randomUUID()}`;
const scope = scopeForOwnerId(owner);

const DAY = 86_400_000;
const iso = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * DAY).toISOString();
/** SQLite's own form: UTC, a space, no zone. */
const sqliteTime = (daysAgo: number) =>
  iso(daysAgo).replace("T", " ").slice(0, 19);
/** A calendar day, as an interaction date is stored. */
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

interface Row {
  name: string;
  role?: string | null;
  company?: string | null;
  location?: string | null;
  industry?: string | null;
  relationshipScore?: number | null;
  isTracked?: number | null;
  updatedAt?: string | null;
  lastContactedAt?: string | null;
  lat?: number | null;
  lng?: number | null;
  tags?: string[];
  emails?: string[];
  phones?: string[];
  lists?: string[];
}

const ROWS: Row[] = [
  {
    name: "Ada Engineer",
    role: "Staff Engineer",
    company: "Northwind Logistics",
    location: "Zürich, Switzerland",
    industry: "Logistics",
    relationshipScore: 95,
    isTracked: 1,
    updatedAt: iso(5),
    lastContactedAt: iso(3),
    lat: 47.37,
    lng: 8.54,
    tags: ["Investor", "friends"],
    emails: ["ada@example.com"],
    phones: ["+41 44 555 01 01"],
    lists: ["Core Team"],
  },
  {
    name: "Bea Founder",
    role: '"Founder"',
    company: "  ",
    location: "London, United Kingdom",
    industry: "Fintech",
    relationshipScore: 80,
    isTracked: 0,
    updatedAt: sqliteTime(200),
    lastContactedAt: sqliteTime(200),
    lat: 51.5,
    lng: -0.12,
    tags: ["angel investor"],
    emails: ["  "],
    phones: [],
    lists: ["Investors"],
  },
  {
    name: "Cem İnce",
    role: "İÇ Mimar",
    company: null,
    location: "\t",
    industry: null,
    relationshipScore: 30,
    isTracked: 0,
    updatedAt: day(40),
    lastContactedAt: day(10),
    lat: null,
    lng: null,
    tags: [],
    emails: [],
    phones: ["+90 212 555 0199"],
    lists: [],
  },
  {
    name: "Dana Nobody",
    role: null,
    company: "Acme",
    location: null,
    industry: "Media",
    relationshipScore: 45,
    isTracked: 1,
    updatedAt: null,
    lastContactedAt: null,
    lat: 200,
    lng: 10,
    tags: ["FRIENDS"],
    emails: ["dana@acme.test"],
    phones: [" "],
    lists: ["Core Team", "Investors"],
  },
  {
    name: "Eli Garbage",
    role: "engineer",
    company: "Stripe",
    location: "Fiji",
    industry: "Fintech",
    relationshipScore: 50,
    isTracked: 0,
    updatedAt: "not a date",
    lastContactedAt: "not a date",
    lat: -17.7,
    lng: 179.9,
    tags: ["investor"],
    emails: [],
    phones: [],
    lists: [],
  },
  {
    name: "Fay Dateline",
    role: "Engineer",
    company: "Stripe",
    location: "Samoa",
    industry: "fintech",
    relationshipScore: 81,
    isTracked: 1,
    updatedAt: iso(1),
    lastContactedAt: iso(100),
    lat: -13.8,
    lng: -179.9,
    tags: [],
    emails: ["fay@example.com"],
    phones: ["+685 555 0100"],
    lists: [],
  },
  {
    name: "Gus Arctic",
    role: "Researcher",
    company: "Polar Institute",
    location: "Svalbard",
    industry: "Research",
    relationshipScore: 60,
    isTracked: 0,
    updatedAt: iso(400),
    lastContactedAt: iso(400),
    lat: 89.9,
    lng: 45,
    tags: [],
    emails: [],
    phones: [],
    lists: [],
  },
];

const ids = new Map<string, string>();
const listIds = new Map<string, string>();
let facetContacts: (FacetContact & { id: string })[] = [];

function readContacts(): (FacetContact & { id: string })[] {
  const rows = sqlite
    .prepare(
      `SELECT id, role, company, location, industry, relationshipScore, isTracked,
              updatedAt, lastContactedAt, lat, lng
       FROM contacts WHERE ownerId = ?`,
    )
    .all(owner) as {
    id: string;
    role: string | null;
    company: string | null;
    location: string | null;
    industry: string | null;
    relationshipScore: number | null;
    isTracked: number | null;
    updatedAt: string | null;
    lastContactedAt: string | null;
    lat: number | null;
    lng: number | null;
  }[];
  const many = <T>(sql: string, id: string) =>
    sqlite.prepare(sql).all(id) as T[];
  return rows.map((row) => ({
    ...row,
    isTracked: !!row.isTracked,
    tags: many<{ tag: string }>(
      "SELECT tag FROM contact_tags WHERE contactId = ?",
      row.id,
    ),
    emails: many<{ email: string }>(
      "SELECT email FROM contact_emails WHERE contactId = ?",
      row.id,
    ),
    phones: many<{ phone: string }>(
      "SELECT phone FROM contact_phones WHERE contactId = ?",
      row.id,
    ),
    lists: many<{ id: string; name: string }>(
      `SELECT l.id, l.name FROM list_members lm JOIN lists l ON l.id = lm.listId
       WHERE lm.contactId = ?`,
      row.id,
    ),
  }));
}

beforeAll(() => {
  for (const [id, name] of [
    [owner, "facet-owner"],
    [other, "facet-other"],
  ])
    sqlite
      .prepare(
        "INSERT INTO users (id, username, email, passwordHash, role) VALUES (?, ?, ?, 'hash', 'member')",
      )
      .run(id, `${name}-${id}`, `${id}@example.com`);

  for (const list of ["Core Team", "Investors"]) {
    const id = crypto.randomUUID();
    listIds.set(list, id);
    sqlite
      .prepare("INSERT INTO lists (id, name, ownerId) VALUES (?, ?, ?)")
      .run(id, list, owner);
  }
  // Another owner's list with the same name must not count.
  sqlite
    .prepare("INSERT INTO lists (id, name, ownerId) VALUES (?, ?, ?)")
    .run(crypto.randomUUID(), "Core Team", other);

  for (const row of ROWS) {
    const id = crypto.randomUUID();
    ids.set(row.name, id);
    sqlite
      .prepare(
        `INSERT INTO contacts (id, ownerId, name, role, company, location, industry,
           relationshipScore, isTracked, updatedAt, lastContactedAt, lat, lng)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        owner,
        row.name,
        row.role ?? null,
        row.company ?? null,
        row.location ?? null,
        row.industry ?? null,
        row.relationshipScore ?? null,
        row.isTracked ?? null,
        row.updatedAt ?? null,
        row.lastContactedAt ?? null,
        row.lat ?? null,
        row.lng ?? null,
      );
    for (const tag of row.tags ?? [])
      sqlite
        .prepare(
          "INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)",
        )
        .run(crypto.randomUUID(), id, tag);
    for (const email of row.emails ?? [])
      sqlite
        .prepare(
          "INSERT INTO contact_emails (id, contactId, email) VALUES (?, ?, ?)",
        )
        .run(crypto.randomUUID(), id, email);
    for (const phone of row.phones ?? [])
      sqlite
        .prepare(
          "INSERT INTO contact_phones (id, contactId, phone) VALUES (?, ?, ?)",
        )
        .run(crypto.randomUUID(), id, phone);
    for (const list of row.lists ?? [])
      sqlite
        .prepare("INSERT INTO list_members (listId, contactId) VALUES (?, ?)")
        .run(listIds.get(list), id);
  }
  facetContacts = readContacts();
});

/** The ids the SQL keeps, sorted. */
function bySql(filters: FacetFilter[]): string[] {
  const facets = compileFacets(scope, filters);
  return (
    sqlite
      .prepare(
        `SELECT c.id FROM contacts c WHERE c.ownerId = ? AND ${facets.sql}`,
      )
      .all(owner, ...facets.params) as { id: string }[]
  )
    .map((row) => row.id)
    .sort();
}

/** The ids `matchesFacet` keeps, sorted. */
function byPalette(filters: FacetFilter[]): string[] {
  return facetContacts
    .filter((contact) => filters.every((f) => matchesFacet(contact, f)))
    .map((contact) => contact.id)
    .sort();
}

const london = { lat: 51.5074, lng: -0.1278 };

/** Every facet, and the values that test its edges. */
const CASES: [string, FacetFilter][] = [
  ["role, lower case", { field: "role", value: "engineer" }],
  ["role, upper case", { field: "role", value: "ENGINEER" }],
  ["role, quoted", { field: "role", value: '"founder"' }],
  ["role, Turkish dotted capital", { field: "role", value: "i̇ç" }],
  ["company", { field: "company", value: "stripe" }],
  ["company, no match", { field: "company", value: "nobody inc" }],
  ["location, accent", { field: "location", value: "zürich" }],
  ["location, part", { field: "location", value: "united" }],
  ["industry", { field: "industry", value: "FINTECH" }],
  ["tag, substring", { field: "tag", value: "invest" }],
  ["tag, case", { field: "tag", value: "friends" }],
  ["score above", { field: "score", value: "80", operator: ">" }],
  ["score below", { field: "score", value: "50", operator: "<" }],
  ["score, default operator", { field: "score", value: "81" }],
  ["score, not a number", { field: "score", value: "abc" }],
  ["tracked yes", { field: "tracked", value: "yes" }],
  ["tracked no", { field: "tracked", value: "no" }],
  ["tracked true", { field: "tracked", value: "TRUE" }],
  ["tracked 0", { field: "tracked", value: "0" }],
  ["tracked, unknown value", { field: "tracked", value: "maybe" }],
  [
    "updated older than 3 months",
    { field: "updated", value: "3m", operator: ">" },
  ],
  ["updated within a month", { field: "updated", value: "1m", operator: "<" }],
  ["updated older than 1 year", { field: "updated", value: "1y" }],
  ["updated within 2 weeks", { field: "updated", value: "2w", operator: "<" }],
  ["updated, not a duration", { field: "updated", value: "soon" }],
  [
    "contacted over 90 days ago",
    { field: "contacted", value: "90d", operator: ">" },
  ],
  [
    "contacted within 30 days",
    { field: "contacted", value: "30d", operator: "<" },
  ],
  ["contacted never", { field: "contacted", value: "never" }],
  ["contacted, default operator", { field: "contacted", value: "6m" }],
  ["contacted, not a duration", { field: "contacted", value: "lately" }],
  ["missing company", { field: "missing", value: "company" }],
  ["missing location", { field: "missing", value: "location" }],
  ["missing email", { field: "missing", value: "email" }],
  ["missing phone", { field: "missing", value: "phone" }],
  ["missing, unknown field", { field: "missing", value: "name" }],
  ["list by name", { field: "list", value: "core team" }],
  ["list by dashed name", { field: "list", value: "core-team" }],
  ["list, unknown", { field: "list", value: "nobody" }],
  ["near without a point", { field: "near", value: "London", km: 25 }],
  [
    "near London, 50 km",
    { field: "near", value: "London", point: { ...london, km: 50 } },
  ],
  [
    "near London, 1,000 km",
    { field: "near", value: "London", point: { ...london, km: 1_000 } },
  ],
  [
    "near the 180th meridian",
    {
      field: "near",
      value: "Fiji",
      point: { lat: -15, lng: 180, km: 1_500 },
    },
  ],
  [
    "near the north pole",
    { field: "near", value: "Pole", point: { lat: 90, lng: 0, km: 200 } },
  ],
];

describe("compileFacets", () => {
  it.each(CASES)("%s: the SQL keeps whom matchesFacet keeps", (_label, f) => {
    expect(bySql([f])).toEqual(byPalette([f]));
  });

  it("selects real people at the edges, so agreement is not two empty lists", () => {
    const names = (filter: FacetFilter) => {
      const kept = new Set(bySql([filter]));
      return ROWS.filter((row) => kept.has(ids.get(row.name)!)).map(
        (row) => row.name,
      );
    };
    expect(
      names({
        field: "near",
        value: "Fiji",
        point: { lat: -15, lng: 180, km: 1_500 },
      }),
    ).toEqual(["Eli Garbage", "Fay Dateline"]);
    expect(
      names({
        field: "near",
        value: "Pole",
        point: { lat: 90, lng: 0, km: 200 },
      }),
    ).toEqual(["Gus Arctic"]);
    expect(names({ field: "role", value: "i̇ç" })).toEqual(["Cem İnce"]);
    // Only a score a card shows: Bea is untracked, Dana never contacted.
    expect(names({ field: "score", value: "40", operator: ">" })).toEqual([
      "Ada Engineer",
      "Fay Dateline",
    ]);
    // An unreadable date counts as never, as the palette reads it.
    expect(names({ field: "contacted", value: "never" })).toEqual([
      "Dana Nobody",
      "Eli Garbage",
    ]);
    expect(names({ field: "contacted", value: "30d", operator: "<" })).toEqual([
      "Ada Engineer",
      "Cem İnce",
    ]);
    // Whitespace is blank, by JavaScript's trim, not SQLite's.
    expect(names({ field: "missing", value: "location" })).toEqual([
      "Cem İnce",
      "Dana Nobody",
    ]);
  });

  it("finds a list by its id", () => {
    const filter: FacetFilter = {
      field: "list",
      value: listIds.get("Investors")!,
    };
    expect(bySql([filter])).toEqual(byPalette([filter]));
    expect(bySql([filter])).toHaveLength(2);
  });

  it("requires every facet, as the palette does", () => {
    const pairs: FacetFilter[][] = [
      [
        { field: "company", value: "stripe" },
        { field: "score", value: "80", operator: ">" },
      ],
      [
        { field: "tag", value: "friends" },
        { field: "list", value: "investors" },
      ],
      [
        { field: "contacted", value: "90d", operator: ">" },
        { field: "missing", value: "email" },
      ],
    ];
    for (const pair of pairs) expect(bySql(pair)).toEqual(byPalette(pair));
  });

  it("holds for no row when a facet can match nobody, and for all with none", () => {
    expect(compileFacets(scope, [{ field: "list", value: "nobody" }]).sql).toBe(
      "(0)",
    );
    expect(compileFacets(scope, []).sql).toBe("1");
    expect(bySql([])).toHaveLength(ROWS.length);
  });

  it("reads the lists of the owner only", () => {
    // The other owner also has a "Core Team". Its id must not be used.
    const facets = compileFacets(scope, [
      { field: "list", value: "core team" },
    ]);
    const listed = JSON.parse(facets.params[0] as string) as string[];
    expect(listed).toEqual([listIds.get("Core Team")]);
  });
});

describe("facetKey", () => {
  it("is the same for the same facets in another order or twice", () => {
    const a: FacetFilter = { field: "tag", value: "Investor" };
    const b: FacetFilter = { field: "contacted", value: "90d", operator: ">" };
    expect(facetKey([a, b])).toBe(
      facetKey([b, a, { ...a, value: "investor" }]),
    );
    expect(facetKey([a])).not.toBe(facetKey([b]));
    expect(facetKey([])).toBe("");
  });
});
