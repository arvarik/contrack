// =============================================================================
// Unit Tests — Tag vocabulary, rename, merge, and delete
// =============================================================================
// Tags are scoped through contacts.ownerId. When two owners use the same tag
// name, mutating operations by one owner must never affect the other.
// =============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";

vi.unmock("../../server/db.ts");
const { sqlite } = await import("../../server/db.ts");
const { tagService } = await import("../../server/services/tagService.ts");
const { scopeForOwnerId } = await import("../../server/tenancy/scope.ts");

describe("tagService", () => {
  const owner1 = `user-${crypto.randomUUID()}`;
  const owner2 = `user-${crypto.randomUUID()}`;
  const scope1 = scopeForOwnerId(owner1);
  const scope2 = scopeForOwnerId(owner2);

  beforeEach(() => {
    // Clean up any test rows
    sqlite
      .prepare(
        "DELETE FROM contact_tags WHERE contactId IN (SELECT id FROM contacts WHERE ownerId IN (?, ?))",
      )
      .run(owner1, owner2);
    sqlite
      .prepare("DELETE FROM contacts WHERE ownerId IN (?, ?)")
      .run(owner1, owner2);
    sqlite.prepare("DELETE FROM users WHERE id IN (?, ?)").run(owner1, owner2);

    // Insert owners
    sqlite
      .prepare(
        "INSERT INTO users (id, username, email, passwordHash, role) VALUES (?, ?, ?, 'hash', 'member')",
      )
      .run(owner1, `user1-${Date.now()}`, `user1-${Date.now()}@example.com`);
    sqlite
      .prepare(
        "INSERT INTO users (id, username, email, passwordHash, role) VALUES (?, ?, ?, 'hash', 'member')",
      )
      .run(owner2, `user2-${Date.now()}`, `user2-${Date.now()}@example.com`);
  });

  it("getSummary returns distinct tags with contact counts scoped to the owner", () => {
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();
    const c3 = crypto.randomUUID();

    // Owner 1 has two contacts
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c1, owner1, "Person A");
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c2, owner1, "Person B");

    // Owner 2 has one contact
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c3, owner2, "Person C");

    // Tags
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "friends");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "work");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c2, "friends");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c3, "friends");

    const summary1 = tagService.getSummary(scope1);
    expect(summary1).toEqual([
      { tag: "friends", count: 2 },
      { tag: "work", count: 1 },
    ]);

    const summary2 = tagService.getSummary(scope2);
    expect(summary2).toEqual([{ tag: "friends", count: 1 }]);
  });

  it("getSummary excludes tags from archived and deleted contacts", () => {
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();

    sqlite
      .prepare(
        "INSERT INTO contacts (id, ownerId, name, isArchived) VALUES (?, ?, ?, 1)",
      )
      .run(c1, owner1, "Archived Person");
    sqlite
      .prepare(
        "INSERT INTO contacts (id, ownerId, name, deletedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
      )
      .run(c2, owner1, "Deleted Person");

    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "archived-tag");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c2, "deleted-tag");

    const summary = tagService.getSummary(scope1);
    expect(summary).toEqual([]);
  });

  it("renameTag renames across owner contacts and does not touch another owner's tags", () => {
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();

    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c1, owner1, "Person 1");
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c2, owner2, "Person 2");

    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "developer");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c2, "developer");

    const result = tagService.renameTag(scope1, "developer", "engineer");
    expect(result.affected).toBe(1);

    // Owner 1 tag was renamed
    const tags1 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c1) as { tag: string }[];
    expect(tags1.map((t) => t.tag)).toEqual(["engineer"]);

    // Owner 2 tag was unchanged
    const tags2 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c2) as { tag: string }[];
    expect(tags2.map((t) => t.tag)).toEqual(["developer"]);
  });

  it("renameTag merges when destination tag already exists on contact", () => {
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();

    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c1, owner1, "Person 1");
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c2, owner1, "Person 2");

    // c1 has both "alpha" and "beta"
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "alpha");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "beta");
    // c2 only has "alpha"
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c2, "alpha");

    const result = tagService.renameTag(scope1, "alpha", "beta");
    expect(result.affected).toBe(2);

    // c1 now has "beta" exactly once
    const tags1 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c1) as { tag: string }[];
    expect(tags1.map((t) => t.tag)).toEqual(["beta"]);

    // c2 now has "beta"
    const tags2 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c2) as { tag: string }[];
    expect(tags2.map((t) => t.tag)).toEqual(["beta"]);
  });

  it("deleteTag deletes from owner contacts and does not touch another owner", () => {
    const c1 = crypto.randomUUID();
    const c2 = crypto.randomUUID();

    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c1, owner1, "Person 1");
    sqlite
      .prepare("INSERT INTO contacts (id, ownerId, name) VALUES (?, ?, ?)")
      .run(c2, owner2, "Person 2");

    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c1, "temporary");
    sqlite
      .prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)")
      .run(crypto.randomUUID(), c2, "temporary");

    const result = tagService.deleteTag(scope1, "temporary");
    expect(result.affected).toBe(1);

    // Owner 1 has no tag
    const tags1 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c1);
    expect(tags1).toEqual([]);

    // Owner 2 still has tag
    const tags2 = sqlite
      .prepare("SELECT tag FROM contact_tags WHERE contactId = ?")
      .all(c2) as { tag: string }[];
    expect(tags2.map((t) => t.tag)).toEqual(["temporary"]);
  });
});
