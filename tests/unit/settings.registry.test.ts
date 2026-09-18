import { describe, expect, it } from "vitest";
import {
  SETTINGS_PAGES,
  REDIRECTS,
  findRows,
} from "../../src/views/settings/registry";
import { NAMES } from "../../src/lib/names";

describe("settings registry", () => {
  it("has unique paths across all pages", () => {
    const paths = SETTINGS_PAGES.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("all redirect targets exist in SETTINGS_PAGES", () => {
    const validPaths = new Set(SETTINGS_PAGES.map((p) => p.path));

    for (const [from, target] of Object.entries(REDIRECTS)) {
      if (typeof target === "string") {
        expect(
          validPaths.has(target),
          `Redirect from ${from} targets non-existent path ${target}`,
        ).toBe(true);
      } else {
        const adminTarget = target({ isAdmin: true });
        const memberTarget = target({ isAdmin: false });
        expect(
          validPaths.has(adminTarget),
          `Admin redirect from ${from} targets non-existent path ${adminTarget}`,
        ).toBe(true);
        expect(
          validPaths.has(memberTarget),
          `Member redirect from ${from} targets non-existent path ${memberTarget}`,
        ).toBe(true);
      }
    }
  });

  it("admin pages carry admin: true", () => {
    const adminPages = SETTINGS_PAGES.filter((p) => p.group === "admin");
    expect(adminPages.length).toBeGreaterThan(0);
    for (const page of adminPages) {
      expect(page.admin).toBe(true);
    }
  });

  it("all keywords are lowercase", () => {
    for (const page of SETTINGS_PAGES) {
      for (const kw of page.keywords) {
        expect(kw).toBe(kw.toLowerCase());
      }
      if (page.rows) {
        for (const row of page.rows) {
          for (const kw of row.keywords) {
            expect(kw).toBe(kw.toLowerCase());
          }
        }
      }
    }
  });

  it('findRows("celsius") returns the temperature row', () => {
    const hits = findRows("celsius");
    expect(hits.length).toBeGreaterThan(0);
    const tempHit = hits.find(
      (h) => h.id === "temp-unit" || h.row?.id === "temp-unit",
    );
    expect(tempHit).toBeDefined();
    expect(tempHit?.page.path).toBe("/settings/network");
    expect(tempHit?.path).toBe("/settings/network#temp-unit");
    expect(tempHit?.label).toBe("Temperature unit");
  });

  it("every NAMES-backed page uses its NAMES title", () => {
    const duplicates = SETTINGS_PAGES.find((p) => p.id === "duplicates");
    expect(duplicates?.title).toBe(NAMES.duplicates.title);

    const enrichment = SETTINGS_PAGES.find((p) => p.id === "enrichment");
    expect(enrichment?.title).toBe(NAMES.enrichment.title);

    const mail = SETTINGS_PAGES.find((p) => p.id === "admin-mail");
    expect(mail?.title).toBe(NAMES.outgoingMail.title);
  });

  it("registers Keyboard and Privacy pages with their rows", () => {
    const keyboard = SETTINGS_PAGES.find((p) => p.id === "keyboard");
    expect(keyboard).toBeDefined();
    expect(keyboard?.path).toBe("/settings/keyboard");
    expect(keyboard?.rows?.some((r) => r.id === "single-key-shortcuts")).toBe(
      true,
    );

    const privacy = SETTINGS_PAGES.find((p) => p.id === "privacy");
    expect(privacy).toBeDefined();
    expect(privacy?.path).toBe("/settings/privacy");
    expect(privacy?.rows?.some((r) => r.id === "ai-assist")).toBe(true);
    expect(privacy?.rows?.some((r) => r.id === "search-history")).toBe(true);
  });

  it("findRows returns hits for personal preference rows", () => {
    const cadenceHit = findRows("cadence").find((h) => h.id === "cadence");
    expect(cadenceHit?.path).toBe("/settings/network#cadence");

    const textScaleHit = findRows("font size").find(
      (h) => h.id === "text-scale",
    );
    expect(textScaleHit?.path).toBe("/settings/appearance#text-scale");

    const aiHit = findRows("ai assist").find((h) => h.id === "ai-assist");
    expect(aiHit?.path).toBe("/settings/privacy#ai-assist");

    const historyHit = findRows("history").find(
      (h) => h.id === "search-history",
    );
    expect(historyHit?.path).toBe("/settings/privacy#search-history");

    const shortcutHit = findRows("single-key").find(
      (h) => h.id === "single-key-shortcuts",
    );
    expect(shortcutHit?.path).toBe("/settings/keyboard#single-key-shortcuts");
  });

  it("registers tools and data pages with their rows", () => {
    const importPage = SETTINGS_PAGES.find((p) => p.id === "import");
    expect(importPage).toBeDefined();
    expect(importPage?.path).toBe("/settings/import");
    expect(importPage?.group).toBe("tools");

    const tagsPage = SETTINGS_PAGES.find((p) => p.id === "tags");
    expect(tagsPage).toBeDefined();
    expect(tagsPage?.path).toBe("/settings/tags");
    expect(tagsPage?.group).toBe("data");

    const duplicates = SETTINGS_PAGES.find((p) => p.id === "duplicates");
    expect(duplicates?.rows?.some((r) => r.id === "dedupe-on-create")).toBe(
      true,
    );
    expect(duplicates?.rows?.some((r) => r.id === "dedupe-on-import")).toBe(
      true,
    );

    const enrichment = SETTINGS_PAGES.find((p) => p.id === "enrichment");
    expect(enrichment?.rows?.some((r) => r.id === "auto-enrich")).toBe(true);
    expect(enrichment?.rows?.some((r) => r.id === "grounding")).toBe(true);
  });

  it("findRows returns hits for tools and data keywords", () => {
    const vcardHit = findRows("vcard");
    expect(vcardHit.some((h) => h.page.id === "import")).toBe(true);

    const tagHit = findRows("rename tag");
    expect(tagHit.some((h) => h.page.id === "tags")).toBe(true);

    const dedupeImportHit = findRows("dedupe on import");
    expect(
      dedupeImportHit.some(
        (h) => h.id === "dedupe-on-import" || h.row?.id === "dedupe-on-import",
      ),
    ).toBe(true);

    const autoEnrichHit = findRows("auto enrich");
    expect(
      autoEnrichHit.some(
        (h) => h.id === "auto-enrich" || h.row?.id === "auto-enrich",
      ),
    ).toBe(true);
  });
});
