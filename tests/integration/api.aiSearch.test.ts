// =============================================================================
// Integration: AI Search API routes and strategy resolution
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import {
  setSetting,
  clearSettingsCache,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import { invalidateProviderCache } from "../../server/ai/providerRegistry.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { contactRepo } from "../../server/repositories/contactRepository.ts";
import { SearxngStrategy } from "../../server/services/aiSearch/strategies/searxng.ts";

const app = makeTestApp();

/**
 * The queue reads are per owner since 2f. Auth is off in this file, so every
 * row belongs to the local owner account, which is the same owner the route
 * supplied through `scopeOf(req)`.
 */
const scope = () => scopeForOwnerId(localOwnerId());

describe("POST /api/ai-search", () => {
  let contactId: string;

  beforeEach(async () => {
    jobQueue.__resetForTests();
    sqlite.prepare("DELETE FROM app_settings").run();
    clearSettingsCache();
    invalidateProviderCache();

    // Prevent background queue execution during endpoint tests
    vi.spyOn(jobQueue, "processBatch").mockResolvedValue();

    // Create a test contact
    const res = await request(app)
      .post("/api/contacts")
      .send({ name: "Ada Lovelace", emails: ["ada@example.com"] });
    contactId = res.body.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    jobQueue.__resetForTests();
    sqlite.prepare("DELETE FROM app_settings").run();
    clearSettingsCache();
    invalidateProviderCache();
  });

  it("returns 503 when no AI provider is configured", async () => {
    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId] });

    expect(res.status).toBe(503);
    expect(res.body.error.message).toContain("AI provider is not configured");
  });

  it("dynamically resolves to 'searxng' on self-hosted setups with SearXNG configured", async () => {
    // Configure a self-hosted custom endpoint (e.g. Ollama/LM Studio)
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    setSetting(SETTING_KEYS.aiCapabilities, {
      deep: {
        mode: "pinned",
        providerId: "custom:local-ollama",
        model: "local-test",
      },
    });
    // Configure SearXNG for research
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    invalidateProviderCache();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId] });

    expect(res.status).toBe(200);
    expect(res.body.batchId).toBeDefined();
    expect(res.body.jobCount).toBe(1);

    const batch = jobQueue.getBatch(scope(), res.body.batchId);
    expect(batch).not.toBeNull();
    // Must resolve dynamically to searxng instead of baking 'two-pass'
    expect(batch?.strategy).toBe("searxng");
  });

  it("rejects a batch when research has no usable provider or SearXNG", async () => {
    // Configure custom endpoint without SearXNG
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    invalidateProviderCache();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId] });

    expect(res.status).toBe(503);
    expect(jobQueue.getActiveBatches(scope())).toEqual([]);
  });

  it("honors explicit valid strategy requested in payload", async () => {
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    setSetting(SETTING_KEYS.aiCapabilities, {
      deep: {
        mode: "pinned",
        providerId: "custom:local-ollama",
        model: "local-test",
      },
    });
    // A provider that can ground makes the default two-pass. Without one the
    // default is already searxng, and an ignored request would still pass.
    setSetting(SETTING_KEYS.aiProviderKeys, { gemini: "test-gemini-key" });
    invalidateProviderCache();

    const byDefault = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId] });
    expect(byDefault.status).toBe(200);
    expect(jobQueue.getBatch(scope(), byDefault.body.batchId)?.strategy).toBe(
      "two-pass",
    );
    jobQueue.__resetForTests();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId], strategy: "searxng" });

    expect(res.status).toBe(200);
    const batch = jobQueue.getBatch(scope(), res.body.batchId);
    expect(batch?.strategy).toBe("searxng");
  });

  it("runs no research, SearXNG included, while research is Off — never research online", async () => {
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    // The setup of the SearXNG test above, plus the admin's choice of Off.
    setSetting(SETTING_KEYS.aiCapabilities, {
      deep: {
        mode: "pinned",
        providerId: "custom:local-ollama",
        model: "local-test",
      },
      research: { mode: "disabled" },
    });
    invalidateProviderCache();

    for (const body of [
      { contactIds: [contactId] },
      { contactIds: [contactId], strategy: "searxng" },
    ]) {
      const res = await request(app).post("/api/ai-search").send(body);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe("RESEARCH_OFF");
    }
    expect(jobQueue.getActiveBatches(scope())).toEqual([]);

    const single = await request(app)
      .post(`/api/contacts/${contactId}/enrich`)
      .send({});
    expect(single.status).toBe(503);
    expect(single.body.error.code).toBe("RESEARCH_OFF");

    const capacity = await request(app).get("/api/ai/grounding-capacity");
    expect(capacity.body).toMatchObject({ hasCapacity: false, provider: null });
  });

  it("stops a SearXNG batch that started before research was turned off", async () => {
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    setSetting(SETTING_KEYS.aiCapabilities, {
      research: { mode: "disabled" },
    });
    const contact = contactRepo.hydrate(
      contactRepo.findOwned(scope(), contactId),
    )!;

    // Without the check, the strategy searches the unreachable address and
    // fails with SEARXNG_NO_RESULTS instead.
    await expect(
      new SearxngStrategy().execute(contact, "prompt"),
    ).rejects.toMatchObject({ code: "RESEARCH_OFF" });
  });

  it("rejects unknown strategy with 400 Bad Request", async () => {
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    invalidateProviderCache();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId], strategy: "invalid-strat" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects empty contactIds array with 400 Validation Error", async () => {
    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when selected contacts no longer exist", async () => {
    setSetting(SETTING_KEYS.aiCustomEndpoints, [
      {
        id: "local-ollama",
        label: "Local Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      },
    ]);
    setSetting(SETTING_KEYS.aiCapabilities, {
      deep: {
        mode: "pinned",
        providerId: "custom:local-ollama",
        model: "local-test",
      },
    });
    setSetting(SETTING_KEYS.aiSearxng, { url: "http://127.0.0.1:8888" });
    invalidateProviderCache();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: ["00000000-0000-0000-0000-000000000000"] });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("no longer available");
  });
});
