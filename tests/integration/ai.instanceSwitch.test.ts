// =============================================================================
// Integration: the instance AI switch
// =============================================================================
// An admin can turn AI off for every account, in Settings → AI or with
// AI_DISABLED in the environment. The switch is checked in one place, the
// provider lookup (getProvider), so every generation, provider embedding,
// model discovery and model test stops there. These tests prove the lookup
// and the paths that lean on it: capability resolution, the gateway,
// embeddings, the daily model refresh, auto-enrichment and the per-account
// rule that joins both switches.
//
// No real provider is reached. Keys are saved through the service, and the
// one endpoint is a loopback port that refuses at once.
// =============================================================================

import crypto from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import {
  clearSettingsCache,
  getSetting,
  setSetting,
  SETTING_KEYS,
} from "../../server/services/settingsService.ts";
import {
  getProvider,
  getProviderConfigs,
  invalidateProviderCache,
} from "../../server/ai/providerRegistry.ts";
import { resolveCapability } from "../../server/ai/capabilities.ts";
import {
  generateFor,
  isAnyProviderConfigured,
} from "../../server/ai/gateway.ts";
import {
  BUILTIN_MODEL_ID,
  embedWithProvider,
  resolveEmbeddings,
} from "../../server/ai/embeddings.ts";
import {
  refreshStaleModelCaches,
  setProviderKey,
  upsertCustomEndpoint,
} from "../../server/services/aiSettingsService.ts";
import { setPreferences } from "../../server/services/userPreferencesService.ts";
import {
  aiAllowedForUser,
  aiOffLockedByEnv,
  isAiOffForInstance,
  setAiOffForInstance,
} from "../../server/ai/instanceSwitch.ts";

const app = makeTestApp();

/** Refused at once, so a model refresh reaches no network. */
const UNREACHABLE = "http://127.0.0.1:59999/v1";

afterEach(() => {
  delete process.env.AI_DISABLED;
  sqlite.prepare("DELETE FROM app_settings").run();
  clearSettingsCache();
  invalidateProviderCache();
  vi.restoreAllMocks();
});

/** A real account row, because user_settings refers to users. */
function createUser(): string {
  const id = `switch-${crypto.randomUUID().slice(0, 8)}`;
  sqlite
    .prepare(
      `INSERT INTO users (id, email, username, passwordHash) VALUES (?, ?, ?, 'hash')`,
    )
    .run(id, `${id}@example.com`, id);
  return id;
}

describe("reading the switch", () => {
  it("reads AI_DISABLED as true or 1, in any case", () => {
    for (const value of ["true", "TRUE", " True ", "1"]) {
      process.env.AI_DISABLED = value;
      expect(aiOffLockedByEnv(), value).toBe(true);
      expect(isAiOffForInstance(), value).toBe(true);
    }
    for (const value of ["false", "0", "yes", ""]) {
      process.env.AI_DISABLED = value;
      expect(aiOffLockedByEnv(), value).toBe(false);
      expect(isAiOffForInstance(), value).toBe(false);
    }
  });
});

describe("the provider lookup while AI is off", () => {
  it("resolves no provider, and still lists the stored keys", () => {
    setProviderKey("openai", "sk-switch-test-1234");
    expect(getProvider("openai")).not.toBeNull();
    expect(resolveCapability("quick")?.providerId).toBe("openai");
    expect(isAnyProviderConfigured()).toBe(true);

    setAiOffForInstance(true);
    expect(getProvider("openai")).toBeNull();
    expect(resolveCapability("quick")).toBeNull();
    expect(resolveCapability("deep")).toBeNull();
    expect(resolveCapability("research")).toBeNull();
    expect(isAnyProviderConfigured()).toBe(false);
    // Settings → AI still shows the key, so turning AI back on needs nothing
    // entered again.
    expect(getProviderConfigs().map((config) => config.id)).toEqual(["openai"]);

    setAiOffForInstance(false);
    expect(getProvider("openai")).not.toBeNull();
  });

  it("refuses a generation and a provider embedding by name", async () => {
    setProviderKey("openai", "sk-switch-test-1234");
    setAiOffForInstance(true);

    await expect(
      generateFor("quick", { prompt: "Say OK", responseFormat: "text" }),
    ).rejects.toMatchObject({ code: "AI_OFF_FOR_INSTANCE" });
    await expect(
      embedWithProvider("openai", "text-embedding-3-small", ["hello"]),
    ).rejects.toMatchObject({ code: "AI_OFF_FOR_INSTANCE" });
  });

  it("embeds with the built-in model, whatever is pinned", () => {
    setProviderKey("openai", "sk-switch-test-1234");
    setSetting(SETTING_KEYS.aiCapabilities, {
      embeddings: {
        mode: "pinned",
        providerId: "openai",
        model: "text-embedding-3-small",
      },
    });
    expect(resolveEmbeddings()).toMatchObject({
      kind: "provider",
      signature: "openai/text-embedding-3-small",
    });

    setAiOffForInstance(true);
    expect(resolveEmbeddings()).toEqual({
      kind: "builtin",
      model: BUILTIN_MODEL_ID,
      dimension: 384,
      signature: `builtin/${BUILTIN_MODEL_ID}`,
    });
  });

  it("sends no model-list request from the daily refresh", async () => {
    upsertCustomEndpoint({ id: "local", label: "Local", baseUrl: UNREACHABLE });

    setAiOffForInstance(true);
    await refreshStaleModelCaches();
    // Nothing was asked, so nothing was recorded, not even a failure.
    expect(getSetting(SETTING_KEYS.aiModelCache)).toBeNull();

    // The same refresh with AI on does ask, and records the refused port.
    setAiOffForInstance(false);
    await refreshStaleModelCaches();
    const cache = getSetting<Record<string, { error?: string }>>(
      SETTING_KEYS.aiModelCache,
    );
    expect(cache?.["custom:local"]?.error).toBeTruthy();
  });
});

describe("the rule for one account", () => {
  it("needs both the instance and the account to allow AI", () => {
    const userId = createUser();
    expect(aiAllowedForUser(userId)).toBe(true);

    setAiOffForInstance(true);
    expect(aiAllowedForUser(userId)).toBe(false);

    setAiOffForInstance(false);
    setPreferences(userId, { aiAssist: false });
    expect(aiAllowedForUser(userId)).toBe(false);
  });
});

describe("auto-enrichment", () => {
  it("starts research for a new contact while AI is on, and none while it is off", async () => {
    const { jobQueue } =
      await import("../../server/services/aiSearch/jobQueue.ts");
    const strat =
      await import("../../server/services/aiSearch/strategies/index.ts");
    vi.spyOn(strat, "validateEnrichmentStrategy").mockReturnValue("two-pass");
    const batchSpy = vi.spyOn(jobQueue, "createBatch");
    const appendSpy = vi.spyOn(jobQueue, "appendToBatch");
    vi.spyOn(jobQueue, "processBatch").mockResolvedValue(
      undefined as unknown as void,
    );

    await request(app)
      .patch("/api/auth/preferences")
      .send({ autoEnrich: true });
    try {
      // With AI on the same setup starts a batch, so the silence below is
      // the switch's and not a preference that never took.
      const on = await request(app)
        .post("/api/contacts")
        .send({ name: "Switch On Person" });
      expect(on.status).toBe(201);
      expect(batchSpy).toHaveBeenCalledTimes(1);

      setAiOffForInstance(true);
      const off = await request(app)
        .post("/api/contacts")
        .send({ name: "Switch Off Person" });
      expect(off.status).toBe(201);
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(appendSpy).not.toHaveBeenCalled();
    } finally {
      jobQueue.__resetForTests();
      await request(app)
        .patch("/api/auth/preferences")
        .send({ autoEnrich: false });
    }
  });
});
