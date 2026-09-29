// =============================================================================
// Unit: scripts/fetch-models.ts downloads pinned files and checks each hash
// =============================================================================
// The Docker build runs this script, so the image ships the search models and
// never reaches huggingface.co. A file that does not match its pinned SHA-256
// must stop the build rather than ship, and a file already on disk must not
// be downloaded again.
// =============================================================================

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { fetchModels } from "../../../scripts/fetch-models.ts";
import type { PinnedModel } from "../../../server/services/search/modelFiles.ts";

const CONFIG = Buffer.from('{"model_type":"bert"}');
const WEIGHTS = Buffer.from("not really onnx, but bytes all the same");

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const MODELS: PinnedModel[] = [
  {
    id: "Example/tiny-model",
    revision: "0123456789abcdef0123456789abcdef01234567",
    files: [
      { path: "config.json", sha256: sha256(CONFIG), bytes: CONFIG.length },
      {
        path: "onnx/model_quantized.onnx",
        sha256: sha256(WEIGHTS),
        bytes: WEIGHTS.length,
      },
    ],
  },
];

/** A fetch that serves the two files, and records every URL it was asked for. */
function fakeHub(bodies: Record<string, Buffer> = {}) {
  const served: Record<string, Buffer> = {
    "config.json": CONFIG,
    "onnx/model_quantized.onnx": WEIGHTS,
    ...bodies,
  };
  const fetchImpl = vi.fn(async (url: string) => {
    const file = url.split("/resolve/")[1].split("/").slice(1).join("/");
    const body = served[file];
    return body
      ? new Response(new Uint8Array(body))
      : new Response("missing", { status: 404 });
  });
  return fetchImpl;
}

const tempDir = () => mkdtempSync(path.join(tmpdir(), "contrack-models-"));

describe("fetchModels", () => {
  it("downloads each file from its pinned commit into <dir>/<model>/<file>", async () => {
    const dir = tempDir();
    const fetchImpl = fakeHub();
    const result = await fetchModels({ dir, models: MODELS, fetchImpl });

    expect(result).toEqual({ present: 0, downloaded: 2, missing: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://huggingface.co/Example/tiny-model/resolve/0123456789abcdef0123456789abcdef01234567/config.json",
    );
    expect(
      readFileSync(
        path.join(dir, "Example/tiny-model/onnx/model_quantized.onnx"),
      ),
    ).toEqual(WEIGHTS);
  });

  it("does not download a file that is already there with the right hash", async () => {
    const dir = tempDir();
    await fetchModels({ dir, models: MODELS, fetchImpl: fakeHub() });

    const again = fakeHub();
    const result = await fetchModels({ dir, models: MODELS, fetchImpl: again });
    expect(result).toEqual({ present: 2, downloaded: 0, missing: [] });
    expect(again).not.toHaveBeenCalled();
  });

  it("replaces a file whose bytes are wrong", async () => {
    const dir = tempDir();
    const target = path.join(dir, "Example/tiny-model/config.json");
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "tampered");

    const result = await fetchModels({
      dir,
      models: MODELS,
      fetchImpl: fakeHub(),
    });
    expect(result.downloaded).toBe(2);
    expect(readFileSync(target)).toEqual(CONFIG);
  });

  it("refuses a download whose hash does not match, and leaves nothing behind", async () => {
    const dir = tempDir();
    const fetchImpl = fakeHub({ "config.json": Buffer.from('{"evil":true}') });

    await expect(
      fetchModels({ dir, models: MODELS, fetchImpl }),
    ).rejects.toThrow(/SHA-256 [0-9a-f]{64}.*expected/);
    // A wrong file is not retried: the same URL serves the same bytes.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(dir, "Example/tiny-model/config.json"))).toBe(
      false,
    );
  });

  it("retries a failed request, then gives up", async () => {
    const dir = tempDir();
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 503 }));
    await expect(
      fetchModels({ dir, models: MODELS, fetchImpl }),
    ).rejects.toThrow(/HTTP 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses a mirror when one is named", async () => {
    const dir = tempDir();
    const fetchImpl = fakeHub();
    await fetchModels({
      dir,
      models: MODELS,
      fetchImpl,
      endpoint: "https://mirror.example.com/",
    });
    expect(fetchImpl.mock.calls[0][0]).toMatch(
      /^https:\/\/mirror\.example\.com\/Example\/tiny-model\/resolve\//,
    );
  });

  it("with checkOnly, reports what is missing and downloads nothing", async () => {
    const dir = tempDir();
    const fetchImpl = fakeHub();
    const result = await fetchModels({
      dir,
      models: MODELS,
      fetchImpl,
      checkOnly: true,
    });
    expect(result.missing).toEqual([
      "Example/tiny-model/config.json",
      "Example/tiny-model/onnx/model_quantized.onnx",
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
