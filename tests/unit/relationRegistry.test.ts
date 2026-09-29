import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import { RELATION_REGISTRY } from "../../server/repositories/contactRepository.ts";

describe("Central Child Relation Registry (OCP)", () => {
  it("defines mapping configuration for all expected child tables", () => {
    // Core child properties we expect to be registered. A PUT updates only
    // the relations in the registry, so one left out is silently dropped.
    const expectedKeys = [
      "emails",
      "phones",
      "socialLinks",
      "tags",
      "interests",
      "addresses",
      "attributes",
      "education",
      "experience",
      "sources",
    ];
    expect(Object.keys(RELATION_REGISTRY).sort()).toEqual(expectedKeys.sort());

    // A PUT deletes a relation's rows by `dbName` in raw SQL, so the name
    // must be the table's own.
    for (const [key, config] of Object.entries(RELATION_REGISTRY)) {
      expect(config.dbName, key).toBe(getTableName(config.table));
    }
  });

  it("does not have duplicate database names", () => {
    const dbNames = Object.values(RELATION_REGISTRY).map((cfg) => cfg.dbName);
    const uniqueDbNames = new Set(dbNames);
    expect(dbNames.length).toBe(uniqueDbNames.size);
  });
});
