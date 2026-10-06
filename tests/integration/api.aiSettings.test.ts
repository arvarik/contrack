// Integration: capability-based AI settings API
// Runs against the real app + real SQLite. No AI keys are configured in the
// integration environment, so these exercise the configuration surface and its
// failure modes rather than live provider calls.

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { setProviderKey } from "../../server/services/aiSettingsService.ts";

const app = makeTestApp();

/** Settings persist in app_settings; reset between tests for isolation. */
afterEach(async () => {
  delete process.env.AI_DISABLED;
  sqlite.prepare("DELETE FROM app_settings").run();
  const { clearSettingsCache } =
    await import("../../server/services/settingsService.ts");
  clearSettingsCache();
  const { invalidateProviderCache } =
    await import("../../server/ai/providerRegistry.ts");
  invalidateProviderCache();
});

describe("GET /api/settings/ai", () => {
  it("reports no providers and offers all built-ins when unconfigured", async () => {
    const res = await request(app).get("/api/settings/ai");
    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual([]);
    expect(
      res.body.availableProviders.map((p: { id: string }) => p.id),
    ).toEqual(expect.arrayContaining(["gemini", "openai", "anthropic"]));
  });

  it("defaults every capability to auto", async () => {
    const res = await request(app).get("/api/settings/ai");
    expect(res.body.capabilities.quick.assignment.mode).toBe("auto");
    expect(res.body.capabilities.deep.assignment.mode).toBe("auto");
    expect(res.body.capabilities.research.assignment.mode).toBe("auto");
    // Embeddings uses the same vocabulary as the rest; auto means the
    // built-in local model.
    expect(res.body.capabilities.embeddings.assignment.mode).toBe("auto");
  });

  it("resolves nothing while no provider is connected", async () => {
    const res = await request(app).get("/api/settings/ai");
    expect(res.body.capabilities.quick.resolved).toBeNull();
  });

  it("reports embeddings as the built-in model, not as unavailable", async () => {
    // Embeddings resolves through resolveEmbeddings(), not resolveCapability(),
    // and its Auto target is the local model — which needs no provider and
    // works offline. Reporting null would show an amber "nothing available"
    // warning on a capability that works.
    const res = await request(app).get("/api/settings/ai");
    const embeddings = res.body.capabilities.embeddings;

    expect(embeddings.resolved).not.toBeNull();
    expect(embeddings.resolved.providerId).toBe("builtin");
    expect(embeddings.resolved.label).toMatch(/built-in/i);
    expect(embeddings.resolved.label).toContain("384");
    expect(embeddings.unavailableReason).toBeUndefined();
  });

  it("explains why a capability is unavailable", async () => {
    const res = await request(app).get("/api/settings/ai");
    // With nothing connected, every generation capability should say so in
    // terms of the next action rather than just reporting emptiness.
    expect(res.body.capabilities.quick.unavailableReason).toMatch(
      /no provider is connected/i,
    );
    expect(res.body.capabilities.research.unavailableReason).toMatch(
      /no provider is connected/i,
    );
  });

  it("tells the user research falls to SearXNG once one is configured", async () => {
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "local",
      label: "Local",
      baseUrl: "http://127.0.0.1:59999/v1",
    });
    await request(app)
      .put("/api/settings/ai/searxng")
      .send({ url: "http://searxng.local:8080" });

    const res = await request(app).get("/api/settings/ai");
    // A compat endpoint cannot ground, so research resolves to no provider —
    // but the feature still works through SearXNG, and saying "unavailable"
    // would be wrong.
    expect(res.body.capabilities.research.resolved).toBeNull();
    // Match text unique to the configured case — both messages mention
    // SearXNG, so /searxng/i alone would pass either way.
    expect(res.body.capabilities.research.unavailableReason).toMatch(
      /research searches with SearXNG/i,
    );
  });
});

describe("capability assignment", () => {
  it("persists a pinned assignment and echoes the updated view", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/deep")
      .send({
        mode: "pinned",
        providerId: "anthropic",
        model: "claude-opus-5",
      });

    expect(res.status).toBe(200);
    expect(res.body.view.capabilities.deep.assignment).toEqual({
      mode: "pinned",
      providerId: "anthropic",
      model: "claude-opus-5",
    });

    const after = await request(app).get("/api/settings/ai");
    expect(after.body.capabilities.deep.assignment.model).toBe("claude-opus-5");
  });

  it("rejects an unknown mode", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/quick")
      .send({ mode: "telepathy" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a pinned assignment with no provider", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/quick")
      .send({ mode: "pinned", model: "some-model" });
    expect(res.status).toBe(400);
  });

  it("keeps both vector stores at the same width", async () => {
    // Search and dedupe share one embeddings model, so a change must rebuild
    // both. Reconciling only search would strand contact_embeddings at the
    // previous width, and every later insert would fail with "Expected 384
    // dimensions but received 1536" until a restart.
    const widthOf = (table: string) => {
      const row = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
        .get(table) as { sql?: string } | undefined;
      return row?.sql?.match(/(?:FLOAT|INT8)\[(\d+)\]/)?.[1];
    };

    const res = await request(app)
      .put("/api/settings/ai/capabilities/embeddings")
      .send({ mode: "auto" });
    expect(res.status).toBe(200);

    // Let the background reconciliation settle.
    await new Promise((r) => setTimeout(r, 500));
    expect(widthOf("search_embeddings")).toBe(widthOf("contact_embeddings"));
  });

  it("refuses an embeddings pin the provider cannot actually serve", async () => {
    // Compat servers return bare model ids, so "embeddings" capability is a
    // guess from the name. A server that does not implement /v1/embeddings
    // must fail loudly here rather than leaving a pin that silently keeps the
    // vector store on the previous model.
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "noembed",
      label: "No Embeddings",
      baseUrl: "http://127.0.0.1:59999/v1",
    });

    const res = await request(app)
      .put("/api/settings/ai/capabilities/embeddings")
      .send({
        mode: "pinned",
        providerId: "custom:noembed",
        model: "some-embed-model",
      });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("EMBEDDINGS_PROBE_FAILED");

    // The rejected pin must not have been stored.
    const view = await request(app).get("/api/settings/ai");
    expect(view.body.capabilities.embeddings.assignment.mode).toBe("auto");
  }, 30_000);

  it("rejects an unknown capability", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/telepathy")
      .send({ mode: "auto" });
    expect(res.status).toBe(400);
  });
});

describe("provider credentials", () => {
  // Credential handling is exercised through a custom endpoint pointed at a
  // closed port: connection-refused is immediate and deterministic. Storing a
  // key for a *built-in* provider would reach out to the real vendor, which
  // made these the only network-dependent — and only flaky — tests in the
  // suite. Real provider behavior is covered by `npm run test:contract`.
  const UNREACHABLE = "http://127.0.0.1:59999/v1";

  it("never returns a raw API key — only a redacted preview", async () => {
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "secretive",
      label: "Secretive",
      baseUrl: UNREACHABLE,
      apiKey: "sk-SUPERSECRETVALUE1234",
    });

    const res = await request(app).get("/api/settings/ai");
    expect(JSON.stringify(res.body)).not.toContain("sk-SUPERSECRETVALUE1234");

    const endpoint = res.body.customEndpoints.find(
      (e: { id: string }) => e.id === "secretive",
    );
    expect(endpoint).toBeTruthy();
    expect(endpoint.keyPreview).toBe("••••1234");
    expect(endpoint.apiKey).toBeUndefined();
  });

  it("rejects an unknown provider id", async () => {
    const res = await request(app)
      .put("/api/settings/ai/providers/skynet/key")
      .send({ apiKey: "x" });
    expect(res.status).toBe(400);
  });

  it("requires a non-empty key", async () => {
    const res = await request(app)
      .put("/api/settings/ai/providers/gemini/key")
      .send({ apiKey: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("removes a stored key", async () => {
    // Saved through the service, because the route checks a built-in key
    // against the real vendor.
    setProviderKey("openai", "sk-remove-me-1234");
    const providerIds = async () =>
      (await request(app).get("/api/settings/ai")).body.providers.map(
        (p: { id: string }) => p.id,
      );
    expect(await providerIds()).toContain("openai");

    const removed = await request(app).delete(
      "/api/settings/ai/providers/openai/key",
    );
    expect(removed.status).toBe(200);
    expect(await providerIds()).not.toContain("openai");
  });

  it("refuses model refresh for an unconfigured provider with 400", async () => {
    const res = await request(app).post(
      "/api/settings/ai/providers/anthropic/refresh-models",
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROVIDER_NOT_CONFIGURED");
  });
});

describe("custom OpenAI-compatible endpoints", () => {
  it("validates the base URL", async () => {
    const res = await request(app)
      .put("/api/settings/ai/endpoints")
      .send({ id: "homelab", label: "Homelab", baseUrl: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects ids that aren't slug-safe", async () => {
    const res = await request(app).put("/api/settings/ai/endpoints").send({
      id: "bad id!",
      label: "Bad",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(res.status).toBe(400);
  });

  it("stores the endpoint and its key even when connectivity validation fails", async () => {
    // Nothing is listening on this port — discovery fails, config persists.
    const res = await request(app).put("/api/settings/ai/endpoints").send({
      id: "homelab",
      label: "Homelab Ollama",
      baseUrl: "http://127.0.0.1:59999/v1",
      apiKey: "sk-still-stored-9999",
    });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("DISCOVERY_FAILED");

    // A typo'd URL must not cost the user the key they just typed.
    const view = await request(app).get("/api/settings/ai");
    const endpoint = view.body.customEndpoints.find(
      (e: { id: string }) => e.id === "homelab",
    );
    expect(endpoint.keyPreview).toBe("••••9999");
    // …and it becomes a selectable provider for chat capabilities.
    expect(
      view.body.providers.find(
        (p: { id: string }) => p.id === "custom:homelab",
      ),
    ).toBeTruthy();
  });

  it("deletes an endpoint", async () => {
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "temp",
      label: "Temp",
      baseUrl: "http://127.0.0.1:59999/v1",
    });
    const res = await request(app).delete("/api/settings/ai/endpoints/temp");
    expect(res.status).toBe(200);

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.customEndpoints).toEqual([]);
  });

  it("returns a capability pinned to a deleted endpoint to auto", async () => {
    // A pin outliving its provider is not harmless. Generation capabilities
    // warn and fall back, but embeddings resolves straight to the dead
    // provider and every embed throws — semantic search and duplicate
    // detection stop working with nothing in the UI to explain why.
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "doomed",
      label: "Doomed",
      baseUrl: "http://127.0.0.1:59999/v1",
    });
    await request(app).put("/api/settings/ai/capabilities/deep").send({
      mode: "pinned",
      providerId: "custom:doomed",
      model: "llama3.2",
    });

    await request(app).delete("/api/settings/ai/endpoints/doomed");

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.capabilities.deep.assignment).toEqual({ mode: "auto" });
  });

  it("explains an endpoint that produced no chat models", async () => {
    // The endpoint saved but discovery failed, so there is no model to call.
    // "No connected provider can serve this" would send the user hunting for a
    // second provider when the one they have just needs a refresh.
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "silent",
      label: "Silent Server",
      baseUrl: "http://127.0.0.1:59999/v1",
    });

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.capabilities.quick.resolved).toBeNull();
    expect(view.body.capabilities.quick.unavailableReason).toMatch(
      /no chat models found on Silent Server/i,
    );
  });
});

describe("model catalog", () => {
  it("returns empty groups before any discovery has run", async () => {
    const res = await request(app).get("/api/settings/ai/models/deep");
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });
});

describe("SearXNG configuration", () => {
  it("stores a SearXNG URL and reports it back", async () => {
    const res = await request(app)
      .put("/api/settings/ai/searxng")
      .send({ url: "http://searxng.local:8080" });
    expect(res.status).toBe(200);

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.webSearch.searxng).toEqual({
      configured: true,
      source: "setting",
      url: "http://searxng.local:8080",
    });
  });

  it("refuses a cloud metadata or a link-local address", async () => {
    for (const url of ["http://169.254.169.254", "http://[fe80::1]:8080"]) {
      const res = await request(app)
        .put("/api/settings/ai/searxng")
        .send({ url });
      expect(res.status, url).toBe(400);
    }
  });

  it("lets SEARXNG_URL win over a saved address, and lock the field", async () => {
    await request(app)
      .put("/api/settings/ai/searxng")
      .send({ url: "http://saved.local:8080" });
    process.env.SEARXNG_URL = "http://env.local:8888/";
    try {
      const view = await request(app).get("/api/settings/ai");
      expect(view.body.webSearch.searxng).toEqual({
        configured: true,
        source: "env",
        url: "http://env.local:8888",
      });
      const save = await request(app)
        .put("/api/settings/ai/searxng")
        .send({ url: "http://other.local:8080" });
      expect(save.status).toBe(409);
      expect(save.body.error.code).toBe("SET_BY_ENVIRONMENT");
    } finally {
      delete process.env.SEARXNG_URL;
    }
  });

  it("rejects a non-URL value", async () => {
    const res = await request(app)
      .put("/api/settings/ai/searxng")
      .send({ url: "nope" });
    expect(res.status).toBe(400);
  });

  it("accepts an empty string to clear the setting", async () => {
    const res = await request(app)
      .put("/api/settings/ai/searxng")
      .send({ url: "" });
    expect(res.status).toBe(200);
  });
});

describe("the instance switch", () => {
  const UNREACHABLE = "http://127.0.0.1:59999/v1";

  /** Switch AI off (true) or on for every account, as the admin. */
  const setAiOff = (aiOff: unknown) =>
    request(app).put("/api/settings/ai/instance").send({ aiOff });

  it("reports AI on, and not locked, by default", async () => {
    const res = await request(app).get("/api/settings/ai");
    expect(res.body.instance).toEqual({ aiOff: false, lockedByEnv: false });

    const instance = await request(app).get("/api/ai/instance");
    expect(instance.status).toBe(200);
    expect(instance.body).toEqual({ aiOff: false, lockedByEnv: false });
  });

  it("turns AI off for the instance, and back on", async () => {
    const off = await setAiOff(true);
    expect(off.status).toBe(200);
    expect(off.body).toEqual({
      success: true,
      instance: { aiOff: true, lockedByEnv: false },
    });

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.instance).toEqual({ aiOff: true, lockedByEnv: false });
    // Every generation capability says why it resolves to nothing, and
    // embeddings stay on the built-in model.
    expect(view.body.capabilities.quick.unavailableReason).toBe(
      "AI is off on this instance.",
    );
    expect(view.body.capabilities.embeddings.resolved.providerId).toBe(
      "builtin",
    );
    expect((await request(app).get("/api/ai/instance")).body.aiOff).toBe(true);

    const on = await setAiOff(false);
    expect(on.status).toBe(200);
    expect(on.body.instance).toEqual({ aiOff: false, lockedByEnv: false });
  });

  it("writes an audit row naming the setting and the direction", async () => {
    await setAiOff(true);
    const row = sqlite
      .prepare(
        `SELECT action, details FROM audit_log
          WHERE targetId = 'ai.instanceOff' ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
      )
      .get() as { action: string; details: string } | undefined;
    expect(row?.action).toBe("settings.changed");
    expect(JSON.parse(row?.details ?? "{}")).toEqual({ aiOff: true });
  });

  it("rejects a body that is not a boolean", async () => {
    for (const body of [{}, { aiOff: "yes" }, { aiOff: 1 }]) {
      const res = await request(app)
        .put("/api/settings/ai/instance")
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses to turn AI on while AI_DISABLED holds it off", async () => {
    process.env.AI_DISABLED = "true";

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.instance).toEqual({ aiOff: true, lockedByEnv: true });

    const on = await setAiOff(false);
    expect(on.status).toBe(409);
    expect(on.body.error.code).toBe("AI_LOCKED_BY_ENV");

    // Off is already true, and saying so again is harmless.
    const off = await setAiOff(true);
    expect(off.status).toBe(200);
    expect(off.body.instance).toEqual({ aiOff: true, lockedByEnv: true });
  });

  it("names the switch when a model refresh or a model test is asked for", async () => {
    await request(app).put("/api/settings/ai/endpoints").send({
      id: "local",
      label: "Local",
      baseUrl: UNREACHABLE,
    });
    await setAiOff(true);

    const refresh = await request(app).post(
      "/api/settings/ai/providers/custom:local/refresh-models",
    );
    expect(refresh.status).toBe(409);
    expect(refresh.body.error.code).toBe("AI_OFF_FOR_INSTANCE");

    for (const capability of ["deep", "embeddings"]) {
      const pin = await request(app)
        .put(`/api/settings/ai/capabilities/${capability}`)
        .send({ mode: "pinned", providerId: "custom:local", model: "m" });
      expect(pin.status, capability).toBe(409);
      expect(pin.body.error.code, capability).toBe("AI_OFF_FOR_INSTANCE");
    }

    // Automatic and the web search switch need no provider, so they can
    // still be chosen.
    const auto = await request(app)
      .put("/api/settings/ai/capabilities/research")
      .send({ mode: "auto" });
    expect(auto.status).toBe(200);
    const off = await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: false });
    expect(off.status).toBe(200);
  });

  it("keeps a new endpoint, and says its models were not checked", async () => {
    await setAiOff(true);
    const res = await request(app).put("/api/settings/ai/endpoints").send({
      id: "later",
      label: "Later",
      baseUrl: UNREACHABLE,
      apiKey: "sk-later-4321",
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AI_OFF_FOR_INSTANCE");

    const view = await request(app).get("/api/settings/ai");
    const endpoint = view.body.customEndpoints.find(
      (e: { id: string }) => e.id === "later",
    );
    expect(endpoint.keyPreview).toBe("••••4321");
    // The row keeps what the endpoint can do, though no adapter is made
    // while AI is off.
    const row = view.body.providers.find(
      (p: { id: string }) => p.id === "custom:later",
    );
    expect(row).toMatchObject({
      supportsDiscovery: true,
      supportsGrounding: false,
    });
  });
});

describe("web search", () => {
  const webSearch = async () =>
    (await request(app).get("/api/settings/ai")).body.webSearch;

  it("is allowed by default, with the web search model's own engine", async () => {
    const view = await webSearch();
    expect(view.allowed).toBe(true);
    expect(view.engine).toBe("provider");
    // With no provider and no SearXNG, each engine names what it lacks, in
    // the order a start is checked.
    expect(view.engines).toEqual({
      provider: { available: false, missing: ["research", "quick"] },
      searxng: { available: false, missing: ["web-search", "deep"] },
      combined: {
        available: false,
        missing: ["web-search", "research", "deep", "quick"],
      },
    });
  });

  it("turns off, says so first for every engine, and turns back on", async () => {
    const off = await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: false });
    expect(off.status).toBe(200);
    expect(off.body.view.webSearch.allowed).toBe(false);
    expect(off.body.view.webSearch.engines.searxng.missing[0]).toBe("off");

    const on = await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: true });
    expect(on.body.view.webSearch.allowed).toBe(true);
    expect(on.body.view.webSearch.engines.searxng.missing).not.toContain("off");
  });

  it("keeps a pinned web search model while it is off", async () => {
    // Off is its own setting, not a mode of the research model, so the pin
    // stays.
    sqlite
      .prepare(
        "INSERT INTO app_settings (key, value) VALUES ('ai.capabilities', ?)",
      )
      .run(
        JSON.stringify({
          research: { mode: "pinned", providerId: "gemini", model: "m" },
        }),
      );
    const { clearSettingsCache } =
      await import("../../server/services/settingsService.ts");
    clearSettingsCache();
    await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: false });
    await request(app)
      .put("/api/settings/ai/web-search")
      .send({ allowed: true });
    const view = await request(app).get("/api/settings/ai");
    expect(view.body.capabilities.research.assignment).toEqual({
      mode: "pinned",
      providerId: "gemini",
      model: "m",
    });
  });

  it("sets the instance's engine, and refuses an unknown one or an empty body", async () => {
    const set = await request(app)
      .put("/api/settings/ai/web-search")
      .send({ engine: "combined" });
    expect(set.status).toBe(200);
    expect((await webSearch()).engine).toBe("combined");
    for (const body of [{ engine: "google" }, {}]) {
      const res = await request(app)
        .put("/api/settings/ai/web-search")
        .send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("says where each model came from, and the variable that stands in for Automatic", async () => {
    process.env.AI_QUICK_MODEL = "gemini:some-model";
    try {
      const view = await request(app).get("/api/settings/ai");
      expect(view.body.capabilities.quick.envDefault).toBe("AI_QUICK_MODEL");
      expect(view.body.capabilities.deep.envDefault).toBeUndefined();
      expect(view.body.capabilities.embeddings.resolved.source).toBe("auto");
    } finally {
      delete process.env.AI_QUICK_MODEL;
    }
  });

  it("names the reranker, the variable that sets it, and whether there is more than one account", async () => {
    const view = await request(app).get("/api/settings/ai");
    expect(view.body.reranker).toEqual({
      model: "Xenova/ms-marco-TinyBERT-L-2-v2",
      source: "default",
    });
    expect(typeof view.body.multipleAccounts).toBe("boolean");
    process.env.SEARCH_RERANK_MODEL = "off";
    try {
      const off = await request(app).get("/api/settings/ai");
      expect(off.body.reranker).toEqual({ model: null, source: "env" });
    } finally {
      delete process.env.SEARCH_RERANK_MODEL;
    }
  });
});
