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

const app = makeTestApp();

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

    const batch = jobQueue.getBatch(res.body.batchId);
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
    expect(jobQueue.getActiveBatches()).toEqual([]);
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
    invalidateProviderCache();

    const res = await request(app)
      .post("/api/ai-search")
      .send({ contactIds: [contactId], strategy: "searxng" });

    expect(res.status).toBe(200);
    const batch = jobQueue.getBatch(res.body.batchId);
    expect(batch?.strategy).toBe("searxng");
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
