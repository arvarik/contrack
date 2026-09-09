import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/ai/gateway.ts", () => ({
  generateFor: vi.fn(),
  isAnyProviderConfigured: vi.fn(() => true),
  providerIdFor: () => "gemini",
}));
vi.mock("../../server/ai/capabilities.ts", async (original) => ({
  ...(await original<typeof import("../../server/ai/capabilities.ts")>()),
  resolveCapability: vi.fn(() => ({
    providerId: "gemini",
    model: "mock-lite",
    modelClass: "lite",
    provider: {},
  })),
}));
import {
  generateFor,
  isAnyProviderConfigured,
} from "../../server/ai/gateway.ts";
import { sqlite } from "../../server/db.ts";
import { makeTestApp } from "./helpers.ts";
import { enrichmentContact } from "../../server/services/aiSearch/contactSnapshot.ts";
import { mergeSearchResult } from "../../server/services/aiSearch/mergeEngine.ts";
import { aiSearchOutputSchema } from "../../server/services/aiSearch/promptTemplate.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { TwoPassStrategy } from "../../server/services/aiSearch/strategies/twoPass.ts";
import { interactionService } from "../../server/services/interactionService.ts";
import { dashboardService } from "../../server/services/dashboardService.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import type { AIGenerateResult } from "../../server/ai/types.ts";

const app = makeTestApp();
const reply = (text: string): AIGenerateResult => ({
  text,
  model: "mock-lite",
  latencyMs: 1,
  tokenCount: 10,
  citations: [{ title: "Test source", uri: "https://example.com/profile" }],
});
let id: string;
beforeEach(async () => {
  jobQueue.__resetForTests();
  aiCache.invalidateAll();
  vi.mocked(generateFor).mockReset();
  vi.mocked(isAnyProviderConfigured).mockReturnValue(true);
  sqlite.prepare("DELETE FROM contacts").run();
  id = (
    await request(app)
      .post("/api/contacts")
      .send({ name: "Test Person", company: "Test Company" })
  ).body.id;
});
afterEach(() => {
  jobQueue.__resetForTests();
  vi.unstubAllEnvs();
});

describe("enrichment integrity", () => {
  it("rejects an outdated profile instead of replacing a concurrent edit", () => {
    const original = enrichmentContact(id);
    sqlite
      .prepare("UPDATE contacts SET role = 'User role' WHERE id = ?")
      .run(id);
    expect(() => mergeSearchResult(id, original, { role: "AI role" })).toThrow(
      "Contact changed",
    );
    expect(enrichmentContact(id).role).toBe("User role");
  });
  it.each(["isArchived = 1", "isGhost = 1", "deletedAt = CURRENT_TIMESTAMP"])(
    "rejects unavailable contacts after research: %s",
    (change) => {
      const original = enrichmentContact(id);
      sqlite.exec(`UPDATE contacts SET ${change}`);
      expect(() =>
        mergeSearchResult(id, original, { role: "AI role" }),
      ).toThrow("no longer available");
      expect(
        sqlite.prepare("SELECT role FROM contacts WHERE id = ?").get(id),
      ).toEqual({ role: null });
    },
  );
  it("deduplicates additions and preserves user interests and attributes", async () => {
    await request(app)
      .put(`/api/contacts/${id}`)
      .send({
        interests: [{ interest: "Cycling", isAiGenerated: false }],
        attributes: [{ name: "Preference", value: "User choice" }],
      });
    mergeSearchResult(id, enrichmentContact(id), {
      emails: [{ email: "test@example.com" }, { email: "TEST@example.com" }],
      interests: [
        { interest: "Cycling" },
        { interest: "Reading" },
        { interest: "Reading" },
      ],
      attributes: [
        { name: "Preference", value: "AI choice" },
        { name: "Language", value: "French" },
        { name: "Language", value: "French" },
      ],
    });
    const current = enrichmentContact(id);
    expect(current.emails).toHaveLength(1);
    expect(current.interests).toHaveLength(2);
    expect(
      Boolean(
        current.interests.find((interest) => interest.interest === "Cycling")
          ?.isAiGenerated,
      ),
    ).toBe(false);
    expect(current.attributes).toHaveLength(2);
    expect(
      current.attributes.find((attribute) => attribute.name === "Preference")
        ?.value,
    ).toBe("User choice");
  });
  it("rejects malformed output and unsafe URL schemes before writing", () => {
    expect(() =>
      mergeSearchResult(id, enrichmentContact(id), {
        website: "javascript:alert(1)",
      }),
    ).toThrow("schema validation");
    expect(() =>
      mergeSearchResult(id, enrichmentContact(id), {
        tags: Array.from({ length: 51 }, () => ({ tag: "repeated" })),
      }),
    ).toThrow("schema validation");
    expect(aiSearchOutputSchema.parse({ role: null, emails: null })).toEqual({
      role: undefined,
      emails: undefined,
    });
  });
  it("rejects overlapping requests for one contact before another generation starts", async () => {
    let finish!: (value: AIGenerateResult) => void;
    vi.mocked(generateFor)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(reply('{"role":"Researcher"}'));
    const first = request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send({})
      .then((response) => response);
    await vi.waitFor(() => expect(generateFor).toHaveBeenCalledTimes(1));
    const second = await request(app)
      .post(`/api/contacts/${id}/enrich`)
      .send({});
    expect(second.status).toBe(409);
    expect(generateFor).toHaveBeenCalledTimes(1);
    finish(reply("Test Person is a researcher."));
    expect((await first).status).toBe(200);
    expect(enrichmentContact(id).role).toBe("Researcher");
  });
});

describe("batch research lifecycle", () => {
  it("does not repeat paid research for an empty grounding result", async () => {
    vi.mocked(generateFor).mockResolvedValue(reply(""));
    await expect(
      new TwoPassStrategy().execute(enrichmentContact(id), "test"),
    ).rejects.toThrow("No public information");
    expect(generateFor).toHaveBeenCalledTimes(1);
  });
  it("stops before extraction when the provider omits source links", async () => {
    vi.mocked(generateFor).mockResolvedValue({
      ...reply("An unsupported biography"),
      citations: [],
    });
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("AI_GROUNDING_MISSING");
    expect(generateFor).toHaveBeenCalledTimes(1);
    expect(enrichmentContact(id).aiHydratedAt).toBeNull();
    expect(enrichmentContact(id).role).toBeNull();
  });
  it("persists safe provider source links with the validated research", async () => {
    vi.mocked(generateFor)
      .mockResolvedValueOnce(reply("A source-backed biography"))
      .mockResolvedValueOnce(reply('{"about":"Researcher in test software"}'));
    const response = await request(app).post(`/api/contacts/${id}/enrich`);
    expect(response.status).toBe(200);
    expect(enrichmentContact(id).aiBackground).toContain(
      "https://example.com/profile",
    );
    expect(generateFor).toHaveBeenCalledTimes(2);
  });
  it("does not retry the complete workflow after a failed provider stage", async () => {
    vi.mocked(generateFor).mockRejectedValue(new Error("Network 500"));
    const batch = jobQueue.createBatch(
      [{ id, name: "Test Person" }],
      "two-pass",
    );
    await jobQueue.processBatch(batch.id);
    expect(batch.status).toBe("complete");
    expect(batch.jobs[0].status).toBe("error");
    expect(generateFor).toHaveBeenCalledTimes(1);
  });
  it("cancels active work and queued contacts without late writes", async () => {
    const nextId = (
      await request(app).post("/api/contacts").send({ name: "Second Person" })
    ).body.id;
    let finish!: (value: AIGenerateResult) => void;
    vi.mocked(generateFor).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const batch = jobQueue.createBatch(
      [
        { id, name: "Test Person" },
        { id: nextId, name: "Second Person" },
      ],
      "two-pass",
    );
    const running = jobQueue.processBatch(batch.id);
    await vi.waitFor(() => expect(generateFor).toHaveBeenCalledTimes(1));
    const cancelled = await request(app).post(
      `/api/ai-search/${batch.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    await running;
    finish(reply("Late result"));
    await Promise.resolve();
    expect(batch.status).toBe("cancelled");
    expect(batch.jobs.every((job) => job.status === "cancelled")).toBe(true);
    expect(enrichmentContact(id).aiHydratedAt).toBeNull();
    expect(generateFor).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed and missing status IDs before starting SSE", async () => {
    const malformed = await request(app).get(
      "/api/ai-search/stream?batchId[]=one",
    );
    expect(malformed.status).toBe(400);
    const missing = await request(app).get(
      "/api/ai-search/stream?batchId=missing",
    );
    expect(missing.status).toBe(404);
    expect(missing.headers["content-type"]).toContain("application/json");
  });
});

describe("AI cache freshness", () => {
  it("reuses unchanged briefings and refreshes them after same-count interaction edits", async () => {
    const interaction = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({ type: "note", title: "Topic", content: "Old context" });
    vi.mocked(generateFor).mockResolvedValue(reply('["First grounded point"]'));
    await interactionService.generateBriefing(id);
    await interactionService.generateBriefing(id);
    expect(generateFor).toHaveBeenCalledTimes(1);
    sqlite
      .prepare("UPDATE interactions SET content = 'New context' WHERE id = ?")
      .run(interaction.body.id);
    vi.mocked(generateFor).mockResolvedValue(
      reply('["Updated grounded point"]'),
    );
    expect(await interactionService.generateBriefing(id)).toEqual([
      "Updated grounded point",
    ]);
    expect(generateFor).toHaveBeenCalledTimes(2);
  });
  it("does not publish briefing text after a concurrent contact edit", async () => {
    let finish!: (value: AIGenerateResult) => void;
    vi.mocked(generateFor).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = interactionService
      .generateBriefing(id)
      .catch((error) => error);
    await vi.waitFor(() => expect(generateFor).toHaveBeenCalledTimes(1));
    sqlite
      .prepare("UPDATE contacts SET company = 'New company' WHERE id = ?")
      .run(id);
    finish(reply('["Old context"]'));
    expect(await pending).toMatchObject({ statusCode: 409 });
    expect(enrichmentContact(id).aiBriefing).toBeNull();
  });
  it("returns a configuration error instead of invented briefing content", async () => {
    vi.mocked(isAnyProviderConfigured).mockReturnValue(false);
    await expect(interactionService.generateBriefing(id)).rejects.toMatchObject(
      { statusCode: 503 },
    );
    expect(generateFor).not.toHaveBeenCalled();
  });
  it("does not create ghost contacts after the source interaction disappears", async () => {
    let finish!: (value: AIGenerateResult) => void;
    vi.mocked(generateFor).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubEnv("DISABLE_BACKGROUND_JOBS", "false");
    const created = await request(app)
      .post(`/api/contacts/${id}/interactions`)
      .send({
        type: "note",
        title: "Meeting",
        content: "Met Future Person today",
      });
    await vi.waitFor(() => expect(generateFor).toHaveBeenCalledTimes(1));
    sqlite
      .prepare("DELETE FROM interactions WHERE id = ?")
      .run(created.body.id);
    finish(reply('[{"name":"Future Person","context":"Met at meeting"}]'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      sqlite
        .prepare("SELECT id FROM contacts WHERE name = 'Future Person'")
        .get(),
    ).toBeUndefined();
  });
  it("excludes trashed contacts from dashboard metrics and AI source data", async () => {
    const removed = (
      await request(app)
        .post("/api/contacts")
        .send({ name: "Removed Person", industry: "Removed industry" })
    ).body.id;
    sqlite
      .prepare("UPDATE contacts SET deletedAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(removed);
    const dashboard = dashboardService.getDashboardPayload();
    expect(dashboard.metrics.totalActive).toBe(1);
    expect(dashboard.recentlyAdded.map((contact) => contact.id)).toEqual([id]);
    expect(dashboard.industryComposition).toEqual([]);
  });
});
