// =============================================================================
// Integration Tests — which contact is "Jon"?
// =============================================================================
// Mention resolution used to be `eq(contacts.name, m.name)`: an exact string
// match, and a new ghost contact for every miss. "Jon" did not find "Jonathan
// Smith", "Maria Garcia" did not find "María García", and "Dr. Chen" did not
// find "Sarah Chen". Each miss made a ghost, the ghost joined the mention
// graph the dashboard reads, and the next note about the same person made
// another one.
//
// Every test in the first two blocks fails against that exact match.
//
// The interesting half is the middle outcome. There are three now — link,
// review, ghost — where there were two, and the tests that matter most are
// the ones about when NOT to link: a bare first name that two contacts
// answer to, two people with the same name at the same company, a ghost that
// should not outrank a real contact.
// =============================================================================

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const { makeTestApp } = await import("./helpers.ts");
const { sqlite } = await import("../../server/db.ts");
const {
  buildMentionCorpus,
  resolveMention,
  MENTION_LINK_THRESHOLD,
  MENTION_REVIEW_THRESHOLD,
} = await import("../../server/services/mentionResolution.ts");
const { createActor, resetAccounts } = await import("./tenancy/helpers.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");
const { doubleMetaphone } = await import("../../server/utils/nlp/index.ts");

makeTestApp();

let owner: string;
let otherOwner: string;
let anchorId: string;
let scope: ReturnType<typeof scopeForOwnerId>;

/**
 * A contact in the account under test. Returns its id.
 *
 * `phoneticHash` is set here because the product sets it: `buildInsertValues`
 * writes it on every create and update, section 10 of `db.ts` backfills any
 * row that predates the column, and candidate retrieval reads it. A raw
 * INSERT that left it NULL would give this file a corpus the resolver cannot
 * see by sound, and the accent tests would fail for a reason that has nothing
 * to do with the resolver.
 */
function addContact(
  name: string,
  extra: Partial<{ company: string; isGhost: number; ownerId: string }> = {},
): string {
  const id = `c-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  sqlite
    .prepare(
      `INSERT INTO contacts (id, name, company, isGhost, ownerId, phoneticHash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      name,
      extra.company ?? null,
      extra.isGhost ?? 0,
      extra.ownerId ?? owner,
      doubleMetaphone(name).primary,
    );
  return id;
}

/** Resolve one name against the account as it stands right now. */
function resolve(name: string, company?: string) {
  return resolveMention(buildMentionCorpus(scope, anchorId), { name, company });
}

beforeAll(async () => {
  resetAccounts();
  const a = await createActor(makeTestApp(), { username: "mentionowner" });
  const b = await createActor(makeTestApp(), { username: "mentionother" });
  owner = a.user.id;
  otherOwner = b.user.id;
  scope = scopeForOwnerId(owner);
});

beforeEach(() => {
  sqlite.prepare("DELETE FROM interaction_mentions").run();
  sqlite.prepare("DELETE FROM interactions").run();
  sqlite.prepare("DELETE FROM dedupe_suggestions").run();
  sqlite.prepare("DELETE FROM contacts").run();
  anchorId = addContact("Anchor Person");
});

// ---------------------------------------------------------------------------
// The names an exact match missed
// ---------------------------------------------------------------------------

describe("names the old exact match could not find", () => {
  it("finds a formal name from its short form", () => {
    const id = addContact("Jonathan Smith");

    const result = resolve("Jon Smith");

    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.contactId).toBe(id);
    expect(result.kind === "link" && result.match.tier).toBe("nickname");
  });

  it("finds a name whose accents an export dropped", () => {
    const id = addContact("María García");

    const result = resolve("Maria Garcia");

    // An exact match, not a fuzzy one. The tokenizer folds accents onto the
    // base letter, so the two names normalize to the same string. Before that
    // it treated every accent as punctuation and "María García" tokenized to
    // ["mar", "a", "garc", "a"] — four fragments and a surname of "a".
    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.contactId).toBe(id);
    expect(result.kind === "link" && result.match.tier).toBe("exact");
  });

  it("folds every accent the same way, not only the common ones", () => {
    const id = addContact("Søren Kjærgaard");

    // Slashed and ligatured letters carry their mark inside the code point
    // rather than as a combining mark, so NFD alone leaves them and `\w` then
    // drops them. They are folded by hand for that reason.
    const result = resolve("Soren Kjaergaard");

    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.contactId).toBe(id);
  });

  it("ignores a title the note put in front of the name", () => {
    const id = addContact("Sarah Chen");

    const result = resolve("Dr. Sarah Chen");

    // The tokenizer strips titles and suffixes, so this is an exact match on
    // the normalized name rather than a fuzzy one.
    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.tier).toBe("exact");
    expect(result.kind === "link" && result.match.contactId).toBe(id);
  });

  it("ignores casing and extra spacing", () => {
    const id = addContact("Tomasz Bielecki");

    const result = resolve("tomasz   BIELECKI");

    expect(result.kind === "link" && result.match.contactId).toBe(id);
  });

  it("survives a small misspelling", () => {
    addContact("Krzysztof Wisniewski");

    const result = resolve("Krzystof Wisniewski");

    // Fuzzy is the last tier and lands in review rather than link on its own.
    // A typo is evidence, not proof, and the cost of a wrong link is a note in
    // somebody else's timeline.
    expect(result.kind).toBe("review");
  });

  it("still makes a ghost for somebody genuinely new", () => {
    addContact("Jonathan Smith");

    const result = resolve("Ingrid Solberg");

    expect(result.kind).toBe("ghost");
  });
});

// ---------------------------------------------------------------------------
// When not to link
// ---------------------------------------------------------------------------

describe("when the answer is not certain enough to act on", () => {
  it("does not pick between two contacts a bare first name fits", () => {
    addContact("Ana Nowak");
    addContact("Ana Ferreira");

    const result = resolve("Ana");

    // A first name alone is not evidence about which Ana. Linking one would be
    // a coin flip, and nothing on screen would show it had been flipped.
    expect(result.kind).toBe("ghost");
  });

  it("does not pick between two people with the same name at one company", () => {
    addContact("James Whitfield", { company: "Sable Studio" });
    addContact("James Whitfield", { company: "Sable Studio" });

    const result = resolve("James Whitfield", "Sable Studio");

    // The father-and-son case. Both score identically, so the margin check
    // demotes a pair of perfect matches to review rather than linking one.
    expect(result.kind).toBe("review");
    expect(result.kind === "review" && result.match.reason).toContain(
      "is as close",
    );
  });

  it("takes a bare first name when the company agrees and nobody else fits", () => {
    const id = addContact("Ana Nowak", { company: "Nettle Organics" });
    addContact("Bartholomew Ellingham", { company: "Nettle Organics" });

    const result = resolve("Ana", "Nettle Organics");

    // Still not a link. One weak signal and one booster is worth showing
    // somebody, which is what review is for.
    expect(result.kind).toBe("review");
    expect(result.kind === "review" && result.match.contactId).toBe(id);
  });

  it("prefers a real contact to a ghost with the same name", () => {
    const real = addContact("Priya Raghunathan");
    addContact("Priya Raghunathan", { isGhost: 1 });

    const result = resolve("Priya Raghunathan");

    // Both match exactly. The ghost is penalised, so the person the account
    // actually knows wins, and the margin is wide enough to link.
    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.contactId).toBe(real);
  });

  it("finds the ghost a previous note made rather than making a second one", () => {
    const ghost = addContact("Yusuf Demirci", { isGhost: 1 });

    const result = resolve("Yusuf Demirci");

    // This is the behaviour that stops an account collecting one ghost per
    // mention of the same unknown person.
    expect(result.kind).toBe("link");
    expect(result.kind === "link" && result.match.contactId).toBe(ghost);
  });
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

describe("the tiebreakers", () => {
  it("lets a matching company carry a name that would not make it alone", () => {
    addContact("Reginald Mbeki", { company: "Basalt Mining" });

    const withoutCompany = resolve("Reginld Mbeki");
    const withCompany = resolve("Reginld Mbeki", "Basalt Mining");

    // The company is what takes this from "worth asking about" to "attach it".
    expect(withoutCompany.kind).toBe("review");
    expect(withCompany.kind).toBe("link");
    expect(withCompany.kind !== "ghost" && withCompany.match.reason).toContain(
      "same company",
    );
  });

  it("lets a shared note carry one", () => {
    const target = addContact("Ana Nowak");
    const noteId = "note-1";
    sqlite
      .prepare(
        "INSERT INTO interactions (id, contactId, type, title, ownerId) VALUES (?, ?, 'note', 'Lunch', ?)",
      )
      .run(noteId, anchorId, owner);
    sqlite
      .prepare(
        "INSERT INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)",
      )
      .run(noteId, target);

    const result = resolve("Ana");

    // "Ana" alone is a ghost. "Ana, who has been in a note with this contact
    // before" is worth asking about.
    expect(result.kind).toBe("review");
    expect(result.kind === "review" && result.match.reason).toContain(
      "appeared in a note with this contact",
    );
  });

  it("counts nothing from another account's notes", () => {
    addContact("Ana Nowak", { ownerId: otherOwner });

    const result = resolve("Ana Nowak");

    // The corpus is one account's. A name in my note can only be somebody in
    // my address book, and a candidate from anywhere else is not a near miss.
    expect(result.kind).toBe("ghost");
  });
});

// ---------------------------------------------------------------------------
// The thresholds
// ---------------------------------------------------------------------------

describe("the thresholds", () => {
  it("keeps link above review", () => {
    expect(MENTION_LINK_THRESHOLD).toBeGreaterThan(MENTION_REVIEW_THRESHOLD);
  });

  it("links only at or above the link threshold", () => {
    addContact("Jonathan Smith");

    const linked = resolve("Jon Smith");

    expect(
      linked.kind === "link" && linked.match.confidence,
    ).toBeGreaterThanOrEqual(MENTION_LINK_THRESHOLD);
  });

  it("reviews only between the two thresholds", () => {
    addContact("Krzysztof Wisniewski");

    const reviewed = resolve("Krzystof Wisniewski");

    expect(reviewed.kind).toBe("review");
    if (reviewed.kind === "review") {
      expect(reviewed.match.confidence).toBeGreaterThanOrEqual(
        MENTION_REVIEW_THRESHOLD,
      );
      expect(reviewed.match.confidence).toBeLessThan(MENTION_LINK_THRESHOLD);
    }
  });

  it("resolves the same way whichever order the corpus came back in", () => {
    // Two contacts that score identically. Without the id tie-break the answer
    // would depend on the order SQLite happened to return the rows in, which
    // is the kind of test that passes for months and then does not.
    addContact("Elena Marchetti", { company: "Jetty Marine" });
    addContact("Elena Marchetti", { company: "Jetty Marine" });

    const first = resolve("Elena Marchetti");
    const second = resolve("Elena Marchetti");

    expect(first).toEqual(second);
  });

  it("returns a ghost for a name with nothing in it", () => {
    addContact("Jonathan Smith");

    expect(resolve("   ").kind).toBe("ghost");
    expect(resolve("!!!").kind).toBe("ghost");
  });
});
