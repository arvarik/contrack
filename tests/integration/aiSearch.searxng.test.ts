// =============================================================================
// Integration: research through SearXNG, from the queries to the fields
// =============================================================================
// SearXNG research runs its own searches, so the name and the employer it
// quotes are the ones the provider research uses: no credentials, no
// placeholder employer. Its extraction is read one field at a time, so one
// bad value no longer costs the rest.
// =============================================================================

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/ai/gateway.ts", () => ({
  generateFor: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
  providerIdFor: () => null,
}));
import { generateFor } from "../../server/ai/gateway.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import {
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { SearxngStrategy } from "../../server/services/aiSearch/strategies/searxng.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** The queries the strategy sent to SearXNG, in order. */
const queries = (search: ReturnType<typeof vi.fn>) =>
  search.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("q"));

let search: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  setSetting(SETTING_KEYS.aiSearxng, { url: "http://searxng.test" });
  vi.mocked(generateFor).mockReset();
  // One result, at an address the page fetch refuses, so the strategy reads
  // the result's snippet.
  search = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Greg Whitlock",
              url: "http://127.0.0.1/greg-whitlock",
              content: "Greg Whitlock co-founded a company in Austin.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", search);
});
afterEach(() => vi.unstubAllGlobals());

describe("SearXNG research", () => {
  it("quotes the clean name, leaves a placeholder employer out, and reads the city from the addresses", async () => {
    const id = (
      await request(app)
        .post("/api/contacts")
        .send({
          name: "Greg Whitlock, CPA",
          company: "Stealth Startup",
          role: "Co-Founder",
          addresses: [
            { address: "12 Harbor Street, Springfield", label: "home" },
            { address: "Austin, TX", label: "work" },
          ],
        })
    ).body.id;
    vi.mocked(generateFor).mockResolvedValue({
      text: JSON.stringify({ location: "Austin, TX, USA" }),
      model: "mock-deep",
      latencyMs: 1,
    });
    await new SearxngStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(queries(search)).toEqual([
      '"Greg Whitlock" Co-Founder',
      '"Greg Whitlock" Austin, TX',
    ]);
  });

  it("keeps the good fields of an extraction with one bad value", async () => {
    const id = (
      await request(app)
        .post("/api/contacts")
        .send({ name: "Greg Whitlock", company: "Northwind Partners" })
    ).body.id;
    vi.mocked(generateFor).mockResolvedValue({
      text: JSON.stringify({
        website: "javascript:alert(1)",
        location: "Austin, TX, USA",
        tags: [{ tag: "startups" }],
        experience: [{ company: "Kestrel", role: "Analyst", isCurrent: true }],
      }),
      model: "mock-deep",
      latencyMs: 1,
    });
    const result = await new SearxngStrategy().execute(
      enrichmentContact(scope(), id),
      "research prompt",
    );
    expect(result.data).toMatchObject({
      location: "Austin, TX, USA",
      tags: [{ tag: "startups" }],
    });
    expect(result.data).not.toHaveProperty("website");
    // The job rules apply too: only a job at the records' company is current.
    expect(result.data.experience).toEqual([
      { company: "Kestrel", role: "Analyst", isCurrent: false },
    ]);
    expect(result.citations).toEqual([
      { title: "Greg Whitlock", uri: "http://127.0.0.1/greg-whitlock" },
    ]);
  });
});
