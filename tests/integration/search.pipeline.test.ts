import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
vi.mock("../../server/ai/aiService.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/ai/aiService.ts")>();
  return { ...original, parseSearchQuery: vi.fn(), rerankCandidates: vi.fn() };
});
import {
  parseSearchQuery,
  rerankCandidates,
} from "../../server/ai/aiService.ts";
import { makeTestApp } from "./helpers.ts";
import { sqlite } from "../../server/db.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
const app = makeTestApp();
beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  aiCache.invalidateAll();
  vi.mocked(parseSearchQuery).mockReset().mockResolvedValue(null);
  vi.mocked(rerankCandidates).mockReset().mockResolvedValue([]);
  sqlite
    .prepare(
      "INSERT INTO contacts(id,name,role,company) VALUES ('a','Alice','Engineer','Acme')",
    )
    .run();
});
const chunks = (body: string) =>
  body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("Ask Contrack final results", () => {
  it("uses no AI calls for a name lookup and caches its result", async () => {
    const first = await request(app)
      .post("/api/search/semantic")
      .send({ query: "Alice" });
    expect(first.body.matches[0].id).toBe("a");
    expect(parseSearchQuery).not.toHaveBeenCalled();
    expect(rerankCandidates).not.toHaveBeenCalled();
    const second = await request(app)
      .post("/api/search/semantic")
      .send({ query: "Alice" });
    expect(second.body.cached).toBe(true);
  });
  it("finishes with an empty result when verification rejects every candidate", async () => {
    const response = await request(app)
      .post("/api/search/semantic")
      .set("Accept", "application/x-ndjson")
      .send({ query: "engineer" });
    const stream = chunks(response.text);
    expect(stream[0]).toMatchObject({ phase: "instant", fallback: true });
    expect(stream.at(-1)).toMatchObject({
      phase: "complete",
      matches: [],
      fallback: false,
    });
    const json = await request(app)
      .post("/api/search/semantic")
      .send({ query: "engineer" });
    expect(json.body.matches).toEqual([]);
  });
  it("sends a terminal keyword fallback after a provider failure", async () => {
    vi.mocked(rerankCandidates).mockRejectedValue(
      new Error("Provider unavailable"),
    );
    const response = await request(app)
      .post("/api/search/semantic")
      .set("Accept", "application/x-ndjson")
      .send({ query: "engineer" });
    expect(chunks(response.text).at(-1)).toMatchObject({
      phase: "complete",
      fallback: true,
      matches: [{ id: "a", aiReason: null }],
    });
  });
  it("rejects evidence from before a contact edit and never caches it", async () => {
    vi.mocked(rerankCandidates).mockImplementation(async () => {
      sqlite.prepare("UPDATE contacts SET role='Designer' WHERE id='a'").run();
      return [{ contact_id: "a", reason: "Engineer" }];
    });
    const response = await request(app)
      .post("/api/search/semantic")
      .send({ query: "engineer" });
    expect(response.body).toMatchObject({ matches: [], fallback: true });
  });
  it("streams local candidates before the planner resolves", async () => {
    let finish!: (value: null) => void;
    vi.mocked(parseSearchQuery).mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    if (!app.listening)
      await new Promise((resolve) => app.once("listening", resolve));
    const address = app.address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/search/semantic`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ query: "engineer" }),
      },
    );
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(
      '"phase":"instant"',
    );
    expect(rerankCandidates).not.toHaveBeenCalled();
    finish(null);
    while (!(await reader.read()).done) {
      /* Drain the terminal result. */
    }
    expect(rerankCandidates).toHaveBeenCalledOnce();
    reader.releaseLock();
  });
  it("does not rerank after the client disconnects", async () => {
    let signal: AbortSignal | undefined;
    vi.mocked(parseSearchQuery).mockImplementation((_query, current) => {
      signal = current;
      return new Promise((_resolve, reject) =>
        current?.addEventListener("abort", () => reject(current.reason), {
          once: true,
        }),
      );
    });
    const controller = new AbortController();
    const address = app.address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/search/semantic`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({ query: "engineer" }),
        signal: controller.signal,
      },
    );
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    expect(rerankCandidates).not.toHaveBeenCalled();
    await reader.cancel().catch(() => undefined);
  });
  it("validates synthesis IDs before starting a generation", async () => {
    expect(
      (
        await request(app)
          .post("/api/search/synthesize")
          .send({ query: "engineers", contactIds: ["missing"] })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post("/api/search/synthesize")
          .send({ query: "q", contacts: [{}] })
      ).status,
    ).toBe(400);
  });
});
