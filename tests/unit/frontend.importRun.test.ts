// @vitest-environment jsdom
// =============================================================================
// The import stream reader and the remembered import
// =============================================================================
// The reader's one job is to tell a finished import from a dropped
// connection. The old reader returned whatever it had when the body ended,
// and the modal showed that as success. The storage helpers keep the id the
// browser made so a reload can find the import again, per account.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMPORT_KEY_PREFIX,
  forgetImport,
  importKey,
  isSettled,
  readImportStream,
  recallImport,
  rememberImport,
  type ImportProgress,
} from "../../src/lib/importRun";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** A response whose body the test feeds by hand. */
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body),
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    pushBytes: (bytes: Uint8Array) => controller.enqueue(bytes),
    end: () => controller.close(),
  };
}

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

const SUMMARY = {
  imported: 3,
  autoMerged: 1,
  needsReview: 0,
  newUnique: 2,
  failed: 0,
};

describe("readImportStream", () => {
  it("returns the done frame, with the id, the status and the summary", async () => {
    const s = stream();
    const progress: ImportProgress[] = [];
    const reading = readImportStream(s.response, (p) => progress.push(p));
    s.push(frame({ phase: "accepted", importId: "imp-1" }));
    s.push(frame({ phase: "importing", processed: 1, total: 3 }));
    s.push(frame({ phase: "scanning", message: "Looking…", autoMerged: 1 }));
    s.push(
      frame({
        done: true,
        importId: "imp-1",
        status: "complete",
        count: 3,
        failed: 0,
        summary: SUMMARY,
      }),
    );
    s.end();

    expect(await reading).toEqual({
      kind: "done",
      importId: "imp-1",
      status: "complete",
      summary: SUMMARY,
      count: 3,
      failed: 0,
      repeated: false,
    });
    expect(progress.map((p) => p.phase)).toEqual(["importing", "scanning"]);
    expect(progress[1].autoMerged).toBe(1);
  });

  it("reports a body that ended without done as interrupted, with the id it saw", async () => {
    const s = stream();
    const reading = readImportStream(s.response, () => {});
    s.push(frame({ phase: "accepted", importId: "imp-2" }));
    s.push(frame({ phase: "importing", processed: 2, total: 9 }));
    s.end();

    // This is the case the old reader got wrong: it returned a count of
    // zero here and the modal showed "Import complete" over it.
    expect(await reading).toEqual({ kind: "interrupted", importId: "imp-2" });
  });

  it("reports interrupted with no id when the connection died before the first frame", async () => {
    const s = stream();
    const reading = readImportStream(s.response, () => {});
    s.end();
    expect(await reading).toEqual({ kind: "interrupted", importId: null });
  });

  it("stops at the done frame rather than waiting for the body to end", async () => {
    const s = stream();
    const reading = readImportStream(s.response, () => {});
    s.push(
      frame({
        done: true,
        importId: "imp-3",
        status: "imported",
        repeated: true,
        count: 5,
        failed: 0,
        summary: null,
      }),
    );
    // No `s.end()`. A server that leaves the connection open must not hold
    // the modal open with it.
    const result = await reading;
    expect(result.kind).toBe("done");
    if (result.kind === "done") {
      expect(result.repeated).toBe(true);
      expect(result.status).toBe("imported");
      expect(result.summary).toBeNull();
    }
  });

  it("reads a frame split across chunks, mid-character", async () => {
    const s = stream();
    const progress: ImportProgress[] = [];
    const reading = readImportStream(s.response, (p) => progress.push(p));
    const bytes = new TextEncoder().encode(
      frame({ phase: "importing", message: "Importing José…", total: 1 }),
    );
    // Split inside the two-byte "é".
    const cut = bytes.findIndex((b) => b === 0xc3) + 1;
    s.pushBytes(bytes.slice(0, cut));
    s.pushBytes(bytes.slice(cut));
    s.push(frame({ done: true, importId: "imp-4", status: "complete" }));
    s.end();

    await reading;
    expect(progress[0].message).toBe("Importing José…");
  });

  it("skips a frame that is not JSON, and lines that are not frames", async () => {
    const s = stream();
    const progress: ImportProgress[] = [];
    const reading = readImportStream(s.response, (p) => progress.push(p));
    s.push(": keep-alive\n\n");
    s.push("data: {broken\n\n");
    s.push(frame({ phase: "embedding", message: "Fingerprints…" }));
    s.push(frame({ phase: "mystery" }));
    s.end();

    expect(await reading).toEqual({ kind: "interrupted", importId: null });
    expect(progress.map((p) => p.phase)).toEqual(["embedding"]);
  });

  it("throws on a response with no body", async () => {
    await expect(
      readImportStream(new Response(null), () => {}),
    ).rejects.toThrow(/stream unavailable/i);
  });
});

describe("the remembered import", () => {
  const entry = { importId: "imp-9", fileName: "friends.vcf", startedAt: 5 };

  it("is keyed by account, and encoded", () => {
    expect(importKey("acct:1")).toBe(`${IMPORT_KEY_PREFIX}acct%3A1`);
    expect(importKey(null)).toBe(`${IMPORT_KEY_PREFIX}local`);
    expect(importKey("  ")).toBe(`${IMPORT_KEY_PREFIX}local`);
  });

  it("round-trips, and one account cannot see another's", () => {
    rememberImport("acct-1", entry);
    expect(recallImport("acct-1")).toEqual(entry);
    expect(recallImport("acct-2")).toBeNull();
    expect(recallImport(null)).toBeNull();
    forgetImport("acct-1");
    expect(recallImport("acct-1")).toBeNull();
  });

  it("discards and removes a value that is not an import", () => {
    localStorage.setItem(importKey("acct-1"), "{nope");
    expect(recallImport("acct-1")).toBeNull();
    expect(localStorage.getItem(importKey("acct-1"))).toBeNull();

    localStorage.setItem(
      importKey("acct-1"),
      JSON.stringify({ importId: 12, fileName: "x" }),
    );
    expect(recallImport("acct-1")).toBeNull();
    expect(localStorage.getItem(importKey("acct-1"))).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => rememberImport("acct-1", entry)).not.toThrow();
    expect(recallImport("acct-1")).toBeNull();
    expect(() => forgetImport("acct-1")).not.toThrow();
  });
});

describe("isSettled", () => {
  it("is true only for the two end states", () => {
    expect(isSettled("complete")).toBe(true);
    expect(isSettled("failed")).toBe(true);
    expect(isSettled("running")).toBe(false);
    expect(isSettled("imported")).toBe(false);
  });
});
