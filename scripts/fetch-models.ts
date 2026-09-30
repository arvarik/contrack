// =============================================================================
// npm run models:fetch — put the local search models on disk ahead of time
// =============================================================================
// The server loads two small models for search (see
// server/services/search/modelFiles.ts). Without this script, Transformers.js
// downloads them from huggingface.co at first boot. With it, the files are on
// disk before the server starts, so the server needs no network for search,
// and `MODEL_DOWNLOADS=false` can refuse any download at all.
//
//   node scripts/fetch-models.ts            fill MODEL_DIR (default DATA_DIR/models)
//   node scripts/fetch-models.ts <folder>   fill <folder> instead
//   node scripts/fetch-models.ts --check    check the files, download nothing
//
// Every file is pinned to one upstream commit and checked against its SHA-256
// before it is moved into place. A file that is already there with the right
// hash is not downloaded again. The Docker build runs this, so the image ships
// the models and a container never reaches Hugging Face.
//
// It reads `.env` in the working directory first, as the server does, so a
// MODEL_DIR, DATA_DIR or HF_ENDPOINT set there applies here too. Before, the
// script filled `./models` while the server read `DATA_DIR/models` from
// `.env`, and the server then downloaded the models anyway.
// =============================================================================

import "../server/utils/loadEnv.ts";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PINNED_MODELS,
  modelDir,
  type PinnedModel,
  type PinnedModelFile,
} from "../server/services/search/modelFiles.ts";

type Fetch = (url: string) => Promise<Response>;

export interface FetchModelsOptions {
  /** The model folder to fill. */
  dir: string;
  /** Check the files only, and download nothing. */
  checkOnly?: boolean;
  /** Where the files come from. Hugging Face unless HF_ENDPOINT names a mirror. */
  endpoint?: string;
  models?: readonly PinnedModel[];
  fetchImpl?: Fetch;
  log?: (line: string) => void;
}

export interface FetchModelsResult {
  /** Files that were already on disk with the right hash. */
  present: number;
  downloaded: number;
  /** Files that are missing or wrong, for `--check`. */
  missing: string[];
}

const ATTEMPTS = 3;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True when the file exists and its bytes hash to the pinned value. */
async function isPresent(
  target: string,
  file: PinnedModelFile,
): Promise<boolean> {
  try {
    const bytes = await readFile(target);
    return bytes.byteLength === file.bytes && sha256(bytes) === file.sha256;
  } catch {
    return false;
  }
}

/** Download one file, check it, and move it into place. */
async function download(
  url: string,
  target: string,
  file: PinnedModelFile,
  fetchImpl: Fetch,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const actual = sha256(bytes);
      if (bytes.byteLength !== file.bytes || actual !== file.sha256) {
        // A wrong file is not a network hiccup, and a retry would fetch the
        // same bytes. Stop, and say which file and which hash.
        throw Object.assign(
          new Error(
            `${url} has SHA-256 ${actual} (${bytes.byteLength} bytes), ` +
              `expected ${file.sha256} (${file.bytes} bytes)`,
          ),
          { permanent: true },
        );
      }
      // Written beside the target and renamed, so a stopped build never
      // leaves half a model that a later `--check` would have to find.
      await mkdir(path.dirname(target), { recursive: true });
      const partial = `${target}.partial`;
      await writeFile(partial, bytes);
      await rename(partial, target);
      return;
    } catch (err) {
      lastError = err;
      if ((err as { permanent?: boolean }).permanent) break;
    }
  }
  throw lastError;
}

/** Fill (or check) the model folder. Throws when a file cannot be had. */
export async function fetchModels(
  options: FetchModelsOptions,
): Promise<FetchModelsResult> {
  const {
    dir,
    checkOnly = false,
    endpoint = "https://huggingface.co",
    models = PINNED_MODELS,
    fetchImpl = fetch,
    log = () => {},
  } = options;
  const result: FetchModelsResult = { present: 0, downloaded: 0, missing: [] };

  for (const model of models) {
    for (const file of model.files) {
      const target = path.join(dir, model.id, file.path);
      const name = `${model.id}/${file.path}`;
      if (await isPresent(target, file)) {
        result.present++;
        continue;
      }
      if (checkOnly) {
        result.missing.push(name);
        continue;
      }
      await rm(target, { force: true });
      const url = `${endpoint.replace(/\/+$/, "")}/${model.id}/resolve/${model.revision}/${file.path}`;
      log(`Downloading ${name} (${(file.bytes / 1_048_576).toFixed(1)} MB)`);
      await download(url, target, file, fetchImpl);
      result.downloaded++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const folder = args.find((arg) => !arg.startsWith("--"));
  const dir = folder ? path.resolve(folder) : modelDir();
  try {
    const result = await fetchModels({
      dir,
      checkOnly,
      endpoint: process.env.HF_ENDPOINT,
      log: (line) => console.log(line),
    });
    if (result.missing.length > 0) {
      console.error(
        `Missing or wrong in ${dir}:\n  ${result.missing.join("\n  ")}\n` +
          "Run `npm run models:fetch` to download them.",
      );
      process.exit(1);
    }
    console.log(
      `Models ready in ${dir}: ${result.downloaded} downloaded, ${result.present} already there.`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("fetch-models.ts") ||
    process.argv[1].endsWith("fetch-models.js"));

if (isDirectRun) {
  void main();
}
