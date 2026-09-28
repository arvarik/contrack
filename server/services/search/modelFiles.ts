// =============================================================================
// Local model files: which ones, where they live, and whether to download
// =============================================================================
// Search runs two small models on the CPU worker: the embedding model and the
// cross-encoder. Transformers.js finds a model file in three places, in this
// order:
//
//   1. its cache, `TRANSFORMERS_CACHE` or `DATA_DIR/.cache`
//   2. the model folder, `MODEL_DIR` (default `DATA_DIR/models`)
//   3. huggingface.co, which it then writes into the cache
//
// Step 3 is a network call at first boot that the operator never asked for,
// and an air-gapped install fails there. `npm run models:fetch` fills the
// model folder ahead of time, the Docker image ships it at `/app/models`, and
// `MODEL_DOWNLOADS=false` turns step 3 off, so a model that is not on disk
// fails with a message that names the fix instead of reaching the network.
//
// This module is read by the CPU worker, which must never import anything
// that reaches `server/db.ts` (see `cpuWorker.ts`). It imports Node's `fs`
// and `path` and nothing else, and that is the rule for anything added here.
// =============================================================================

import fs from "fs";
import path from "path";

/** One file of a pinned model, as `scripts/fetch-models.ts` checks it. */
export interface PinnedModelFile {
  /** The path inside the model, which is also its path on disk. */
  path: string;
  sha256: string;
  bytes: number;
}

/** A model the server loads by default, pinned to one upstream commit. */
export interface PinnedModel {
  id: string;
  /** The Hugging Face commit the files come from. */
  revision: string;
  files: readonly PinnedModelFile[];
}

/**
 * The models the server loads when nothing overrides them.
 *
 * The file list is exactly what Transformers.js reads for a q8 model: the
 * config, the tokenizer and its config, and the quantized ONNX weights. The
 * hashes were checked against the files at these commits on 2026-09-28, and
 * the two ONNX hashes match the LFS object ids Hugging Face publishes.
 */
export const PINNED_MODELS: readonly PinnedModel[] = [
  {
    id: "Xenova/all-MiniLM-L6-v2",
    revision: "751bff37182d3f1213fa05d7196b954e230abad9",
    files: [
      {
        path: "config.json",
        sha256:
          "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
        bytes: 650,
      },
      {
        path: "tokenizer.json",
        sha256:
          "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
        bytes: 711_661,
      },
      {
        path: "tokenizer_config.json",
        sha256:
          "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
        bytes: 366,
      },
      {
        path: "onnx/model_quantized.onnx",
        sha256:
          "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
        bytes: 22_972_370,
      },
    ],
  },
  {
    id: "Xenova/ms-marco-TinyBERT-L-2-v2",
    revision: "b76bb5e1fefd66aa36cd108622d768e86c015ff1",
    files: [
      {
        path: "config.json",
        sha256:
          "463d8bce12140e74c56e008b1212b056487a76acdca8f31f9627d202f6e5a7bd",
        bytes: 824,
      },
      {
        path: "tokenizer.json",
        sha256:
          "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
        bytes: 711_396,
      },
      {
        path: "tokenizer_config.json",
        sha256:
          "0b29c7bfc889e53b36d9dd3e686dd4300f6525110eaa98c76a5dafceb2029f53",
        bytes: 1_242,
      },
      {
        path: "onnx/model_quantized.onnx",
        sha256:
          "026c2ec3257cd351696e45bbd6040bb83cf818ba89059b4344bd6350138b62ce",
        bytes: 4_496_298,
      },
    ],
  },
];

/** The built-in embedding model, which search and dedupe both use. */
export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";

type Env = Record<string, string | undefined>;

/** The writable download cache, or undefined for the library's default. */
export function modelCacheDir(env: Env = process.env): string | undefined {
  return (
    env.TRANSFORMERS_CACHE ??
    (env.DATA_DIR ? path.join(env.DATA_DIR, ".cache") : undefined)
  );
}

/**
 * The folder of model files the server reads before it downloads anything.
 *
 * Laid out the way the cache is, `<folder>/<model id>/<file>`, so a copied
 * cache works as a model folder too.
 */
export function modelDir(env: Env = process.env): string {
  return env.MODEL_DIR?.trim()
    ? path.resolve(env.MODEL_DIR.trim())
    : path.join(env.DATA_DIR ?? process.cwd(), "models");
}

/** False when `MODEL_DOWNLOADS` is `false` (or `0`, `off`, `no`). */
export function modelDownloadsAllowed(env: Env = process.env): boolean {
  const value = env.MODEL_DOWNLOADS?.trim().toLowerCase();
  return !(value && ["false", "0", "off", "no"].includes(value));
}

/** The part of Transformers.js's `env` object this module sets. */
export interface ModelLibraryEnv {
  cacheDir: string | null;
  localModelPath: string;
  allowLocalModels: boolean;
  allowRemoteModels: boolean;
}

/**
 * Point Transformers.js at the model folder and the cache, and allow or
 * refuse downloads. Every place that loads a model calls this first, so the
 * worker and the in-process fallback read the same files the same way.
 */
export function configureModelLibrary(
  library: ModelLibraryEnv,
  env: Env = process.env,
): void {
  const cacheDir = modelCacheDir(env);
  if (cacheDir) library.cacheDir = cacheDir;
  // The library joins this with the model id as a plain string, so the
  // trailing separator is what keeps `/app/models` + `Xenova/...` apart.
  library.localModelPath = modelDir(env) + path.sep;
  library.allowLocalModels = true;
  library.allowRemoteModels = modelDownloadsAllowed(env);
}

/**
 * True when the model's config is in the model folder or the cache, which is
 * where the library looks before it would download anything.
 */
export function modelOnDisk(modelId: string, env: Env = process.env): boolean {
  return [modelDir(env), modelCacheDir(env)].some(
    (dir) =>
      dir !== undefined &&
      fs.existsSync(path.join(dir, modelId, "config.json")),
  );
}

/**
 * The load error, with the fix appended when downloads are off and the model
 * is not on disk.
 *
 * Transformers.js reports a missing file in more than one way: "`env.
 * allowRemoteModels=false` and file was not found locally", or for a
 * tokenizer "Cannot read properties of undefined (reading
 * 'tokenizer_class')". Neither names the fix, so this checks the disk itself.
 * A pinned model comes from `npm run models:fetch`, and any other model needs
 * a download or a copy by hand.
 */
export function describeModelLoadError(
  message: string,
  modelId: string,
  env: Env = process.env,
): string {
  if (modelDownloadsAllowed(env) || modelOnDisk(modelId, env)) return message;
  const dir = modelDir(env);
  const fix = PINNED_MODELS.some((model) => model.id === modelId)
    ? "Run `npm run models:fetch` to put it there, or set MODEL_DOWNLOADS=true to let the server download it once."
    : `\`npm run models:fetch\` fetches only the default models. Set MODEL_DOWNLOADS=true to let the server download it once, or copy its files into ${path.join(dir, modelId)}.`;
  return `${message.replace(/[.\s]+$/, "")}. MODEL_DOWNLOADS is false and ${modelId} is not in ${dir}. ${fix}`;
}
