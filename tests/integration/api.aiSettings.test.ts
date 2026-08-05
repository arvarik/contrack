// =============================================================================
// Integration: capability-based AI settings API
// =============================================================================
// Runs against the real app + real SQLite. No AI keys are configured in the
// integration environment, so these exercise the configuration surface and its
// failure modes rather than live provider calls.
// =============================================================================

import { describe, it, expect, afterEach } from "vitest";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";

const app = makeTestApp();

/** Settings persist in app_settings; reset between tests for isolation. */
afterEach(async () => {
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

  it("supports disabling online research", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/research")
      .send({ mode: "disabled" });
    expect(res.status).toBe(200);
    expect(res.body.view.capabilities.research.assignment.mode).toBe(
      "disabled",
    );
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

  it("rejects an unknown capability", async () => {
    const res = await request(app)
      .put("/api/settings/ai/capabilities/telepathy")
      .send({ mode: "auto" });
    expect(res.status).toBe(400);
  });
});

describe("provider credentials", () => {
  // NOTE: the two tests below make a real outbound call — storing a key
  // triggers discovery against the provider. They assert only that the key is
  // stored/redacted and that *any* failure maps to DISCOVERY_FAILED, so they
  // pass whether the provider rejects the key or the network is unavailable.
  // The generous timeout absorbs the adapter's retry backoff.
  it("never returns a raw API key — only a redacted preview", async () => {
    // Discovery fails (fake key) but the key is still stored.
    await request(app)
      .put("/api/settings/ai/providers/gemini/key")
      .send({ apiKey: "AIzaSyFAKEKEYFORTESTS1234" });

    const res = await request(app).get("/api/settings/ai");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("AIzaSyFAKEKEYFORTESTS1234");

    const gemini = res.body.providers.find(
      (p: { id: string }) => p.id === "gemini",
    );
    expect(gemini).toBeTruthy();
    expect(gemini.keyPreview).toBe("••••1234");
    expect(gemini.source).toBe("settings");
  }, 30_000);

  it("surfaces a discovery failure for an invalid key", async () => {
    const res = await request(app)
      .put("/api/settings/ai/providers/gemini/key")
      .send({ apiKey: "definitely-not-a-valid-key" });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("DISCOVERY_FAILED");
  }, 30_000);

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
    await request(app)
      .put("/api/settings/ai/providers/openai/key")
      .send({ apiKey: "sk-fake-key-for-tests" });
    const removed = await request(app).delete(
      "/api/settings/ai/providers/openai/key",
    );
    expect(removed.status).toBe(200);

    const res = await request(app).get("/api/settings/ai");
    expect(
      res.body.providers.find((p: { id: string }) => p.id === "openai"),
    ).toBeUndefined();
  }, 30_000);

  it("404s model refresh for an unconfigured provider", async () => {
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

  it("stores the endpoint even when connectivity validation fails", async () => {
    // Nothing is listening on this port — discovery fails, config persists.
    const res = await request(app).put("/api/settings/ai/endpoints").send({
      id: "homelab",
      label: "Homelab Ollama",
      baseUrl: "http://127.0.0.1:59999/v1",
    });
    expect(res.status).toBe(502);

    const view = await request(app).get("/api/settings/ai");
    expect(
      view.body.customEndpoints.find((e: { id: string }) => e.id === "homelab"),
    ).toBeTruthy();
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
    expect(view.body.searxngUrl).toBe("http://searxng.local:8080");
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
