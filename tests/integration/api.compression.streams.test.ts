// =============================================================================
// Integration Tests — streams reach the browser a piece at a time
// =============================================================================
// A compressor holds what it is given until it has enough to compress well,
// so a compressed stream would arrive in lumps, the last one at the end. The
// server therefore leaves its streams alone (server/middleware/compression.ts)
// and every test here asks the way a browser does, with
// `Accept-Encoding: gzip, deflate, br, zstd`.
//
// Each test reads its stream while the server still holds it open: Ask while
// the planner has not answered, the brief while the model has not, the
// research and duplicate streams while their job runs. A piece that arrives
// in that window is a piece no compressor kept back. The client decodes
// whatever encoding comes back, as a browser would, so a server that did
// compress a stream fails here on time, with "nothing arrived", rather than
// on unreadable bytes.
// =============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import http from "http";
import zlib from "zlib";
import type { AddressInfo } from "net";
import type { Readable } from "stream";

vi.mock("../../server/ai/aiService.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../server/ai/aiService.ts")>();
  return { ...original, parseSearchQuery: vi.fn(), rerankCandidates: vi.fn() };
});
// A provider is configured, as far as the pipeline can tell. With none, the
// local list is the whole answer and Ask writes a single line.
vi.mock("../../server/ai/services/shared.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../server/ai/services/shared.ts")
  >()),
  isMockMode: () => false,
}));
// The brief streams through the gateway. Its pieces are scripted here.
vi.mock("../../server/ai/gateway.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/ai/gateway.ts")>()),
  streamFor: vi.fn(),
}));

import {
  parseSearchQuery,
  rerankCandidates,
} from "../../server/ai/aiService.ts";
import { streamFor } from "../../server/ai/gateway.ts";
import { makeTestApp } from "./helpers.ts";
import { localOwnerId } from "./tenancy/helpers.ts";
import { sqlite } from "../../server/db.ts";
import { aiCache } from "../../server/utils/aiCache.ts";
import { scopeForOwnerId } from "../../server/tenancy/scope.ts";
import { jobQueue } from "../../server/services/aiSearch/jobQueue.ts";
import { dedupeQueue } from "../../server/services/dedupe/jobQueue.ts";

const app = makeTestApp();
const scope = () => scopeForOwnerId(localOwnerId());

/** What Chrome and Firefox send over HTTPS. */
const BROWSER = "gzip, deflate, br, zstd";

/**
 * How long a piece may take to arrive. A piece the server has written
 * arrives in milliseconds. One that a compressor holds does not arrive until
 * the stream ends, and every stream here stays open until the test ends it.
 */
const ARRIVAL_MS = 5_000;

interface OpenStream {
  status: number;
  headers: http.IncomingHttpHeaders;
  /** Waits until the text read so far holds `marker`, and returns it. */
  until(marker: string): Promise<string>;
  /** Waits for the server to end the response, and returns what is left. */
  rest(): Promise<string>;
  close(): void;
}

/** Start a request and return as soon as the response headers arrive. */
async function open(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<OpenStream> {
  if (!app.listening) await new Promise((r) => app.once("listening", r));
  const { port } = app.address() as AddressInfo;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: url,
        headers: {
          "Accept-Encoding": BROWSER,
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": String(Buffer.byteLength(payload)),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const encoding = res.headers["content-encoding"];
        const text: Readable =
          encoding === "br"
            ? res.pipe(zlib.createBrotliDecompress())
            : encoding === "gzip"
              ? res.pipe(zlib.createGunzip())
              : res;
        let buffer = "";
        let ended = false;
        let wake: (() => void) | null = null;
        text.setEncoding("utf8");
        text.on("data", (piece: string) => {
          buffer += piece;
          wake?.();
        });
        text.on("end", () => {
          ended = true;
          wake?.();
        });
        const nextEvent = (ms: number) =>
          new Promise<void>((done) => {
            const timer = setTimeout(done, ms);
            wake = () => {
              clearTimeout(timer);
              wake = null;
              done();
            };
          });

        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          async until(marker) {
            const deadline = Date.now() + ARRIVAL_MS;
            while (!buffer.includes(marker)) {
              if (ended) throw new Error(`The stream ended before ${marker}`);
              const left = deadline - Date.now();
              if (left <= 0)
                throw new Error(`Nothing arrived within ${ARRIVAL_MS} ms`);
              await nextEvent(left);
            }
            const end = buffer.indexOf(marker) + marker.length;
            const out = buffer.slice(0, end);
            buffer = buffer.slice(end);
            return out;
          },
          async rest() {
            while (!ended) await nextEvent(60_000);
            const out = buffer;
            buffer = "";
            return out;
          },
          close: () => req.destroy(),
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const ndjson = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

/** The JSON in each `data:` line of an event stream. */
const events = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));

beforeEach(() => {
  sqlite.prepare("DELETE FROM contacts").run();
  aiCache.invalidateAll();
  jobQueue.__resetForTests();
  dedupeQueue.__resetForTests();
  vi.mocked(parseSearchQuery).mockReset().mockResolvedValue(null);
  vi.mocked(rerankCandidates).mockReset().mockResolvedValue([]);
  vi.mocked(streamFor).mockReset();
  sqlite
    .prepare(
      "INSERT INTO contacts(id,name,role,company,ownerId) VALUES ('a','Alice','Engineer','Acme',?)",
    )
    .run(localOwnerId());
});

describe("NDJSON", () => {
  it("sends Ask's instant line while AI still works, then the final answer", async () => {
    let finish!: (value: null) => void;
    vi.mocked(parseSearchQuery).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const stream = await open(
      "POST",
      "/api/search/semantic",
      { Accept: "application/x-ndjson" },
      { query: "engineer" },
    );

    // The planner has not answered, so the instant line is all the server
    // can have written. It must be here before the final answer exists.
    const instant = await stream.until("\n");
    expect(JSON.parse(instant)).toMatchObject({
      phase: "instant",
      fallback: true,
    });
    expect(rerankCandidates).not.toHaveBeenCalled();
    expect(stream.headers["content-type"]).toMatch(/^application\/x-ndjson/);
    expect(stream.headers["content-encoding"]).toBeUndefined();

    await vi.waitFor(() => expect(parseSearchQuery).toHaveBeenCalled());
    finish(null);
    expect(ndjson(await stream.rest()).at(-1)).toMatchObject({
      phase: "complete",
    });
  });

  it("sends the brief's first line before the model answers", async () => {
    let release!: () => void;
    vi.mocked(streamFor).mockImplementation(async (_c, _o, onDelta) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      onDelta("Alice is an engineer.");
      return { text: "Alice is an engineer.", model: "m", latencyMs: 1 };
    });

    const stream = await open(
      "POST",
      "/api/search/synthesize",
      {},
      { query: "engineers", contactIds: ["a"] },
    );

    expect(JSON.parse(await stream.until("\n"))).toEqual({ phase: "start" });
    expect(stream.headers["content-encoding"]).toBeUndefined();

    await vi.waitFor(() => expect(streamFor).toHaveBeenCalled());
    release();
    expect(ndjson(await stream.rest())).toEqual([
      { phase: "delta", text: "Alice is an engineer." },
      { phase: "complete", text: "Alice is an engineer." },
    ]);
  });
});

describe("event streams", () => {
  it("sends the research batch at once, and its end when it ends", async () => {
    // A batch that is created and never run stays `processing`, so the
    // server holds the stream open after the first event.
    const batch = jobQueue.createBatch(
      scope(),
      [{ id: "a", name: "Alice" }],
      "two-pass",
    );

    const stream = await open(
      "GET",
      `/api/ai-search/stream?batchId=${batch.id}`,
      { Accept: "text/event-stream" },
    );

    expect(events(await stream.until("\n\n"))).toMatchObject([
      { id: batch.id, status: "processing" },
    ]);
    expect(stream.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(stream.headers["content-encoding"]).toBeUndefined();

    jobQueue.cancelBatch(scope(), batch.id);
    expect(events(await stream.rest())).toMatchObject([
      { id: batch.id, status: "cancelled" },
    ]);
  });

  it("sends each step of a duplicate scan as it happens", async () => {
    const scan = dedupeQueue.createScan(scope(), "quick");

    const stream = await open(
      "GET",
      `/api/dedupe/stream?scanId=${scan.scanId}`,
      { Accept: "text/event-stream" },
    );

    expect(events(await stream.until("\n\n"))).toMatchObject([
      { scanId: scan.scanId, phase: "starting" },
    ]);
    expect(stream.headers["content-encoding"]).toBeUndefined();

    dedupeQueue.update(scan.scanId, {
      phase: "deterministic",
      contactsScanned: 1,
    });
    expect(events(await stream.until("\n\n"))).toMatchObject([
      { phase: "deterministic", contactsScanned: 1 },
    ]);

    dedupeQueue.complete(scan.scanId, []);
    expect(events(await stream.rest())).toMatchObject([
      { phase: "complete", clustersFound: 0 },
    ]);
  });

  it("streams an import's progress frames as they are", async () => {
    const stream = await open(
      "POST",
      "/api/contacts/bulk",
      { Accept: "text/event-stream" },
      [{ name: "Bea Import" }, { name: "Cal Import" }],
    );

    const frames = events(await stream.rest());
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(stream.headers["content-encoding"]).toBeUndefined();
    expect(frames[0]).toMatchObject({ phase: "accepted" });
    expect(frames.at(-1)).toMatchObject({ done: true, count: 2 });
  });

  it("answers an MCP client on its event stream as it is", async () => {
    // tools/list is about 10 KB, far over the threshold, and the MCP SDK
    // answers it as an event stream. The SDK also marks its streams
    // `Cache-Control: no-transform`, which the package honours on its own,
    // so this holds even without the stream rule. It is here for the route.
    const stream = await open(
      "POST",
      "/api/mcp",
      { Accept: "application/json, text/event-stream" },
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    );

    const answer = events(await stream.rest());
    expect(stream.status).toBe(200);
    expect(stream.headers["content-type"]).toMatch(/^text\/event-stream/);
    expect(stream.headers["content-encoding"]).toBeUndefined();
    expect(answer).toHaveLength(1);
    expect(answer[0].id).toBe(1);
    expect(answer[0].result.tools.length).toBeGreaterThan(5);
  });
});
