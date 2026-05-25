import { describe, it, expect } from "vitest";
import { RELATION_REGISTRY } from "../../server/repositories/contactRepository.ts";

describe("Central Child Relation Registry (OCP)", () => {
  it("defines mapping configuration for all expected child tables", () => {
    const keys = Object.keys(RELATION_REGISTRY) as Array<
      keyof typeof RELATION_REGISTRY
    >;

    // Core child properties we expect to be registered
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

    for (const key of expectedKeys) {
      expect(keys).toContain(key);
      const config = RELATION_REGISTRY[key as keyof typeof RELATION_REGISTRY];
      expect(config).toBeDefined();
      expect(config.dbName).toBeTypeOf("string");
      expect(config.dbName.length).toBeGreaterThan(0);
      expect(config.table).toBeDefined();
    }
  });

  it("does not have duplicate database names", () => {
    const dbNames = Object.values(RELATION_REGISTRY).map((cfg) => cfg.dbName);
    const uniqueDbNames = new Set(dbNames);
    expect(dbNames.length).toBe(uniqueDbNames.size);
  });
});
