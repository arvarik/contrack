// =============================================================================
// Unit: the local model files, where the server reads them, and downloads
// =============================================================================
// The search models used to download from huggingface.co at first boot, and
// nothing could turn that off. modelFiles.ts points Transformers.js at a model
// folder first and lets MODEL_DOWNLOADS=false refuse the network. These tests
// pin that configuration, and check that the pinned list covers the models
// the server loads by default, so a model swap cannot leave the Docker image
// shipping the wrong files.
// =============================================================================

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  EMBEDDING_MODEL_ID,
  PINNED_MODELS,
  configureModelLibrary,
  describeModelLoadError,
  modelCacheDir,
  modelDir,
  modelDownloadsAllowed,
  modelOnDisk,
  type ModelLibraryEnv,
} from "../../server/services/search/modelFiles.ts";
import { DEFAULT_RERANK_MODEL } from "../../server/services/search/crossEncoder.ts";
import { BUILTIN_MODEL_ID } from "../../server/ai/embeddings.ts";

function libraryEnv(): ModelLibraryEnv {
  return {
    cacheDir: "/library/default/cache",
    localModelPath: "/library/default/models/",
    allowLocalModels: false,
    allowRemoteModels: true,
  };
}

describe("the pinned models", () => {
  it("cover both models the server loads by default", () => {
    const ids = PINNED_MODELS.map((m) => m.id);
    expect(ids).toContain(EMBEDDING_MODEL_ID);
    expect(ids).toContain(DEFAULT_RERANK_MODEL);
    expect(BUILTIN_MODEL_ID).toBe(EMBEDDING_MODEL_ID);
  });

  it("pin each file to a commit and a SHA-256", () => {
    for (const model of PINNED_MODELS) {
      expect(model.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(model.files.map((f) => f.path)).toEqual(
        expect.arrayContaining([
          "config.json",
          "tokenizer.json",
          "tokenizer_config.json",
          "onnx/model_quantized.onnx",
        ]),
      );
      for (const file of model.files) {
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
  });
});

describe("modelDir", () => {
  it("defaults to DATA_DIR/models, and to ./models without DATA_DIR", () => {
    expect(modelDir({ DATA_DIR: "/srv/contrack" })).toBe(
      path.join("/srv/contrack", "models"),
    );
    expect(modelDir({})).toBe(path.join(process.cwd(), "models"));
  });

  it("takes MODEL_DIR over both, resolved to an absolute path", () => {
    expect(modelDir({ MODEL_DIR: "/app/models", DATA_DIR: "/data" })).toBe(
      "/app/models",
    );
    expect(modelDir({ MODEL_DIR: "vendor/models" })).toBe(
      path.resolve("vendor/models"),
    );
    // Compose passes an unset variable as an empty string.
    expect(modelDir({ MODEL_DIR: "  ", DATA_DIR: "/data" })).toBe(
      path.join("/data", "models"),
    );
  });
});

describe("modelDownloadsAllowed", () => {
  it("allows downloads unless MODEL_DOWNLOADS says no", () => {
    expect(modelDownloadsAllowed({})).toBe(true);
    expect(modelDownloadsAllowed({ MODEL_DOWNLOADS: "" })).toBe(true);
    expect(modelDownloadsAllowed({ MODEL_DOWNLOADS: "true" })).toBe(true);
    for (const no of ["false", "FALSE", "0", "off", " no "])
      expect(modelDownloadsAllowed({ MODEL_DOWNLOADS: no })).toBe(false);
  });
});

describe("configureModelLibrary", () => {
  it("reads the model folder first and refuses downloads when told to", () => {
    const env = libraryEnv();
    configureModelLibrary(env, {
      MODEL_DIR: "/app/models",
      MODEL_DOWNLOADS: "false",
      DATA_DIR: "/app/data",
    });
    expect(env).toEqual({
      cacheDir: path.join("/app/data", ".cache"),
      localModelPath: `/app/models${path.sep}`,
      allowLocalModels: true,
      allowRemoteModels: false,
    });
  });

  it("keeps the library's cache when neither TRANSFORMERS_CACHE nor DATA_DIR is set", () => {
    const env = libraryEnv();
    configureModelLibrary(env, {});
    expect(env.cacheDir).toBe("/library/default/cache");
    expect(env.allowRemoteModels).toBe(true);
    expect(modelCacheDir({ TRANSFORMERS_CACHE: "/tmp/cache" })).toBe(
      "/tmp/cache",
    );
  });
});

describe("describeModelLoadError", () => {
  const missing =
    '`local_files_only=true` or `env.allowRemoteModels=false` and file was not found locally at "/nowhere/Xenova/x/config.json".';
  const tokenizer =
    "Cannot read properties of undefined (reading 'tokenizer_class')";
  const offline = (dir: string) => ({
    MODEL_DOWNLOADS: "false",
    MODEL_DIR: dir,
    TRANSFORMERS_CACHE: path.join(dir, "cache"),
  });

  it("names models:fetch for a pinned model that is not on disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modeldir-"));
    const message = describeModelLoadError(
      missing,
      EMBEDDING_MODEL_ID,
      offline(dir),
    );
    expect(message).toContain("npm run models:fetch");
    expect(message).toContain(`${EMBEDDING_MODEL_ID} is not in ${dir}`);
    expect(message).not.toContain('".. ');
  });

  it("names a download or a copy for a model models:fetch does not fetch", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modeldir-"));
    const message = describeModelLoadError(
      tokenizer,
      "Xenova/ms-marco-MiniLM-L-6-v2",
      offline(dir),
    );
    expect(message).toContain("fetches only the default models");
    expect(message).toContain("MODEL_DOWNLOADS=true");
    expect(message).toContain(path.join(dir, "Xenova/ms-marco-MiniLM-L-6-v2"));
  });

  it("leaves the error alone when downloads are on, or the model is on disk", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "contrack-modeldir-"));
    expect(describeModelLoadError(missing, EMBEDDING_MODEL_ID, {})).toBe(
      missing,
    );
    mkdirSync(path.join(dir, EMBEDDING_MODEL_ID), { recursive: true });
    writeFileSync(path.join(dir, EMBEDDING_MODEL_ID, "config.json"), "{}");
    expect(modelOnDisk(EMBEDDING_MODEL_ID, offline(dir))).toBe(true);
    expect(
      describeModelLoadError(
        "Protobuf parsing failed",
        EMBEDDING_MODEL_ID,
        offline(dir),
      ),
    ).toBe("Protobuf parsing failed");
  });
});
