// =============================================================================
// Integration: a self-hosted OpenAI-compatible endpoint, end to end
// =============================================================================
// The Ollama story has one shape that matters and no test covered it: an
// install whose ONLY provider is a custom endpoint, with every capability left
// on Automatic — which is what a user gets by adding an endpoint and touching
// nothing else. Resolution named the provider but no model, and the compat
// adapter refuses to be called without one, so every AI request failed on a
// correctly connected server.
//
// A stub speaking the OpenAI wire format stands in for Ollama. It is a real
// HTTP server, so the OpenAI SDK, the base-URL handling, model discovery, and
// the JSON-mode ladder all execute for real; only the model is fake.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "http";
import request from "supertest";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";

const app = makeTestApp();

/** Requests the stub received, so tests can assert what was actually called. */
interface StubCall {
  path: string;
  body: Record<string, unknown>;
}

let stub: http.Server;
let stubUrl: string;
let calls: StubCall[] = [];
/** Models the stub advertises; a test can narrow this to reshape discovery. */
let advertisedModels = ["llama3.2", "qwen3:8b", "nomic-embed-text"];

/** The contact the stub "extracts", echoed back as the model's answer. */
const PARSED = {
  name: "Ada Lovelace",
  company: "Analytical Engines",
  role: "Mathematician",
};

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw));
  });
}

beforeAll(async () => {
  stub = http.createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    const raw = await readBody(req);
    calls.push({ path, body: raw ? JSON.parse(raw) : {} });
    res.setHeader("content-type", "application/json");

    if (path === "/v1/models") {
      // Ollama's shape: bare ids, no capability metadata.
      res.end(
        JSON.stringify({
          object: "list",
          data: advertisedModels.map((id) => ({
            id,
            object: "model",
            owned_by: "library",
          })),
        }),
      );
      return;
    }
    if (path === "/v1/chat/completions") {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: JSON.stringify(PARSED) },
              finish_reason: "stop",
            },
          ],
          usage: { total_tokens: 123 },
        }),
      );
      return;
    }
    if (path === "/v1/embeddings") {
      const inputs = (calls.at(-1)!.body.input ?? []) as string[];
      res.end(
        JSON.stringify({
          data: inputs.map(() => ({
            embedding: Array.from({ length: 8 }, () => 0.1),
          })),
        }),
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });

  await new Promise<void>((resolve) =>
    stub.listen(0, "127.0.0.1", () => resolve()),
  );
  stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}/v1`;
});

afterAll(() => {
  stub.close();
});

afterEach(async () => {
  calls = [];
  advertisedModels = ["llama3.2", "qwen3:8b", "nomic-embed-text"];
  sqlite.prepare("DELETE FROM app_settings").run();
  const { clearSettingsCache } =
    await import("../../server/services/settingsService.ts");
  clearSettingsCache();
  const { invalidateProviderCache } =
    await import("../../server/ai/providerRegistry.ts");
  invalidateProviderCache();
});

/** Connect the stub the way the settings UI does. */
async function connectEndpoint() {
  return request(app)
    .put("/api/settings/ai/endpoints")
    .send({ id: "homelab", label: "Homelab Ollama", baseUrl: stubUrl });
}

describe("connecting a compat endpoint", () => {
  it("discovers the models the server advertises", async () => {
    const res = await connectEndpoint();
    expect(res.status).toBe(200);
    expect(res.body.modelCount).toBe(3);
    expect(calls.map((c) => c.path)).toContain("/v1/models");
  });

  it("splits chat models from embedding models by name", async () => {
    await connectEndpoint();

    const chat = await request(app).get("/api/settings/ai/models/quick");
    expect(chat.body.groups[0].models.map((m: { id: string }) => m.id)).toEqual(
      ["llama3.2", "qwen3:8b"],
    );

    const embed = await request(app).get("/api/settings/ai/models/embeddings");
    expect(
      embed.body.groups[0].models.map((m: { id: string }) => m.id),
    ).toEqual(["nomic-embed-text"]);
  });

  it("offers nothing for web research — the compat API cannot ground", async () => {
    await connectEndpoint();
    const res = await request(app).get("/api/settings/ai/models/research");
    expect(res.body.groups).toEqual([]);
  });
});

describe("Automatic capabilities on a compat endpoint", () => {
  it("runs a real generation with nothing configured beyond the endpoint", async () => {
    // The reported bug, as a test: connect an endpoint, change nothing else,
    // use the app. This failed with "a model must be selected".
    await connectEndpoint();

    const res = await request(app)
      .post("/api/parse-contact")
      .send({ text: "Ada Lovelace, Mathematician at Analytical Engines" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Ada Lovelace");

    const chat = calls.find((c) => c.path === "/v1/chat/completions");
    expect(chat, "the endpoint should have been called").toBeTruthy();
    // Auto mode has to name a model; the first discovered chat model is it.
    expect(chat!.body.model).toBe("llama3.2");
  });

  it("reports the endpoint and its model in the settings view", async () => {
    await connectEndpoint();
    const res = await request(app).get("/api/settings/ai");

    expect(res.body.capabilities.quick.resolved).toMatchObject({
      providerId: "custom:homelab",
      providerLabel: "Homelab Ollama",
      model: "llama3.2",
    });
    expect(res.body.capabilities.quick.unavailableReason).toBeUndefined();
  });

  it("uses a pinned model in preference to the automatic one", async () => {
    await connectEndpoint();
    await request(app).put("/api/settings/ai/capabilities/quick").send({
      mode: "pinned",
      providerId: "custom:homelab",
      model: "qwen3:8b",
    });

    await request(app)
      .post("/api/parse-contact")
      .send({ text: "Ada Lovelace, Mathematician" });

    const chat = calls.find((c) => c.path === "/v1/chat/completions");
    expect(chat!.body.model).toBe("qwen3:8b");
  });

  it("fills in the model for a pin that names only the endpoint", async () => {
    // The API accepts `{mode:"pinned", providerId}` with no model, which means
    // "use this endpoint, you choose". Native adapters choose for themselves;
    // a compat endpoint would otherwise be called with nothing.
    await connectEndpoint();
    await request(app)
      .put("/api/settings/ai/capabilities/quick")
      .send({ mode: "pinned", providerId: "custom:homelab" });

    const res = await request(app)
      .post("/api/parse-contact")
      .send({ text: "Ada Lovelace" });

    expect(res.status).toBe(200);
    expect(
      calls.find((c) => c.path === "/v1/chat/completions")!.body.model,
    ).toBe("llama3.2");
  });

  it("refuses to guess when the server advertises no chat model", async () => {
    // An embeddings-only server. Calling it would fail inside the adapter with
    // a message about model ids; the capability should report itself
    // unavailable instead, and say what to do.
    advertisedModels = ["nomic-embed-text"];
    await connectEndpoint();

    const view = await request(app).get("/api/settings/ai");
    expect(view.body.capabilities.quick.resolved).toBeNull();
    expect(view.body.capabilities.quick.unavailableReason).toMatch(
      /no chat models discovered/i,
    );

    const res = await request(app)
      .post("/api/parse-contact")
      .send({ text: "Ada Lovelace" });
    expect(res.status).toBe(503);
    expect(calls.some((c) => c.path === "/v1/chat/completions")).toBe(false);
  });
});

describe("embeddings on a compat endpoint", () => {
  it("probes the model's dimension before accepting the pin", async () => {
    await connectEndpoint();

    const res = await request(app)
      .put("/api/settings/ai/capabilities/embeddings")
      .send({
        mode: "pinned",
        providerId: "custom:homelab",
        model: "nomic-embed-text",
      });

    expect(res.status).toBe(200);
    // The stub returns 8-dim vectors, and the probe has to measure rather than
    // assume — vec0 tables are fixed-width, so a wrong guess is unusable.
    const probe = calls.find((c) => c.path === "/v1/embeddings");
    expect(probe).toBeTruthy();
    expect(res.body.view.capabilities.embeddings.resolved.model).toBe(
      "nomic-embed-text",
    );
  }, 30_000);
});
