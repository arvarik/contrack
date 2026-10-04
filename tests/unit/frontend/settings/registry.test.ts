import { describe, expect, it } from "vitest";
import {
  SETTINGS_PAGES,
  findRows,
} from "../../../../src/views/settings/registry";
import { NAMES } from "../../../../src/lib/names";

describe("settings registry", () => {
  it("has unique paths across all pages", () => {
    const paths = SETTINGS_PAGES.map((p) => p.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(paths.length);
  });

  it("admin pages carry admin: true", () => {
    const adminPages = SETTINGS_PAGES.filter((p) => p.group === "admin");
    expect(adminPages.length).toBeGreaterThan(0);
    for (const page of adminPages) {
      expect(page.admin).toBe(true);
    }
  });

  it.each([
    ["duplicates", "duplicates"],
    ["enrichment", "enrichment"],
    ["tracked", "tracked"],
    ["connectors", "connectors"],
    ["correspondents", "correspondents"],
    ["mcp", "mcp"],
    ["admin-mail", "outgoingMail"],
  ] as const)("every NAMES-backed page uses its NAMES title: %s", (id, key) => {
    const page = SETTINGS_PAGES.find((p) => p.id === id);
    expect(page?.title).toBe(NAMES[key].title);
  });

  it.each([
    ["embedding", "/settings/admin/ai#embedding-model"],
    ["quick tasks", "/settings/admin/ai#fast-model"],
    ["deep tasks", "/settings/admin/ai#strong-model"],
    ["rerank", "/settings/admin/ai#reranker"],
    ["research model", "/settings/admin/ai#web-search-model"],
    ["never research online", "/settings/admin/ai#allow-web-search"],
    ["ollama", "/settings/admin/ai#openai-compatible"],
    ["searxng", "/settings/admin/ai#searxng"],
    ["search with", "/settings/enrichment#web-search-engine"],
    ["which model", "/settings/privacy#ai-features"],
  ])("finds every AI control by its name or its old one: %s", (query, path) => {
    const hits = findRows(query, { isAdmin: true }).map((hit) => hit.path);
    expect(hits).toContain(path);
  });

  it("keeps SearXNG off the General page, its old home", () => {
    const hits = findRows("searxng", { isAdmin: true }).map((hit) => hit.path);
    expect(
      hits.some((path) => path.startsWith("/settings/admin/general")),
    ).toBe(false);
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

  it.each([
    ["vcard", "/settings/import", "import", "tools"],
    ["rename tag", "/settings/tags", "tags", "data"],
    [
      "dedupe on create",
      "/settings/duplicates#dedupe-on-create",
      "duplicates",
      "tools",
    ],
    [
      "dedupe on import",
      "/settings/duplicates#dedupe-on-import",
      "duplicates",
      "tools",
    ],
    ["auto enrich", "/settings/enrichment#auto-enrich", "enrichment", "tools"],
    ["grounding", "/settings/enrichment#grounding", "enrichment", "tools"],
  ])(
    "findRows returns hits for tools and data keywords: %s",
    (query, path, pageId, group) => {
      const hit = findRows(query).find((h) => h.path === path);
      expect(hit?.page.id).toBe(pageId);
      expect(hit?.page.group).toBe(group);
    },
  );
});
