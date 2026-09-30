// =============================================================================
// Integration: addresses in the keyword index, at a low rank
// =============================================================================
// A street, a postcode or a city written only in an address finds the contact.
// The address is the last text to count: a name, a company, a role, a
// location and an about text all outrank it, so a query that means a person
// does not bury them under every neighbour of one street.
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import { sqlite } from "../../server/db.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { lexicalSearch } from "../../server/services/search/lexical.ts";
import { installSearchIndex } from "../../server/services/search/ftsIndex.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const scope = () => scopeForOwnerId(localOwnerId());
const ids = (query: string) =>
  lexicalSearch(scope(), query, 20).map((match) => match.contactId);

function insert(id: string, over: Record<string, string | null> = {}) {
  const row = { id, name: `Person ${id}`, ownerId: localOwnerId(), ...over };
  const columns = Object.keys(row);
  sqlite
    .prepare(
      `INSERT INTO contacts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(row));
}

function address(id: string, contactId: string, text: string) {
  sqlite
    .prepare(
      "INSERT INTO contact_addresses (id, contactId, address, label, isPrimary) VALUES (?, ?, ?, 'home', 1)",
    )
    .run(id, contactId, text);
}

beforeEach(() => sqlite.prepare("DELETE FROM contacts").run());

describe("addresses in the keyword index", () => {
  it("finds a contact by a street, a postcode, or a city that only its address names", () => {
    insert("kreuzberg");
    address("a1", "kreuzberg", "Oranienstraße 12, 10999 Berlin");
    insert("nobody");

    expect(ids("Oranienstraße")).toEqual(["kreuzberg"]);
    expect(ids("10999")).toEqual(["kreuzberg"]);
    // The contact's location says nothing, and the address does.
    expect(ids("Berlin")).toEqual(["kreuzberg"]);
    // A prefix works as it does for every other column.
    expect(ids("Oranien")).toEqual(["kreuzberg"]);
  });

  it("finds a contact by any of its addresses", () => {
    insert("two");
    address("home", "two", "1 Home Road, Leeds");
    address("work", "two", "9 Office Lane, Bristol");
    expect(ids("Leeds")).toEqual(["two"]);
    expect(ids("Bristol")).toEqual(["two"]);
  });

  it("follows an address that is changed, moved or deleted", () => {
    insert("one");
    insert("two");
    address("a1", "one", "5 Elm Street, Lisbon");
    expect(ids("Lisbon")).toEqual(["one"]);

    sqlite
      .prepare(
        "UPDATE contact_addresses SET address = '7 Oak Avenue, Porto' WHERE id = 'a1'",
      )
      .run();
    expect(ids("Lisbon")).toEqual([]);
    expect(ids("Porto")).toEqual(["one"]);

    sqlite
      .prepare("UPDATE contact_addresses SET contactId = 'two' WHERE id = 'a1'")
      .run();
    expect(ids("Porto")).toEqual(["two"]);

    sqlite.prepare("DELETE FROM contact_addresses WHERE id = 'a1'").run();
    expect(ids("Porto")).toEqual([]);
    expect(
      sqlite.prepare("SELECT count(*) AS n FROM contacts_fts").get(),
    ).toEqual({ n: 2 });
  });

  it("ranks an address below a name, a company, a role, a location and an about text", () => {
    insert("address");
    address("a1", "address", "3 Needle Street, Town");
    insert("about", { about: "Loves a needle and thread" });
    insert("location", { location: "Needle, Somewhere" });
    insert("role", { role: "Needle Specialist" });
    insert("company", { company: "Needle Works" });
    insert("name", { name: "Needle" });

    const ranked = ids("Needle");
    expect(ranked).toHaveLength(6);
    expect(ranked[0]).toBe("name");
    // Every other field beats the address, which comes last.
    expect(ranked[ranked.length - 1]).toBe("address");
  });

  it("does not find an archived, merged, ghost or trashed contact by its address", () => {
    insert("active");
    address("a0", "active", "1 Shared Lane, Nowhere");
    for (const [id, update] of [
      ["archived", "isArchived = 1"],
      ["ghost", "isGhost = 1"],
      ["merged", "canonicalId = 'active'"],
      ["trash", "deletedAt = datetime('now')"],
    ]) {
      insert(id);
      address(`a-${id}`, id, "1 Shared Lane, Nowhere");
      sqlite.prepare(`UPDATE contacts SET ${update} WHERE id = ?`).run(id);
    }
    expect(ids("Shared")).toEqual(["active"]);
  });

  it("indexes the addresses of contacts already in a database that was on the old index", () => {
    insert("old");
    address("a1", "old", "4 Legacy Way, Dublin");
    // A database from before addresses were indexed carries user_version 5.
    sqlite.pragma("user_version = 5");
    installSearchIndex(sqlite);
    expect(ids("Legacy")).toEqual(["old"]);
    expect(sqlite.pragma("user_version", { simple: true })).toBeGreaterThan(5);
  });
});
