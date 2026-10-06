// npm run models:smoke — load the local search models and use each once
// The server runs two small models for search (see
// server/services/search/modelFiles.ts): one embeds text, one scores a query
// against a document. This loads both the way the server does, from MODEL_DIR
// with the same settings, embeds one sentence and scores one pair.
//
// The Docker build runs it after it trims the runtime image to the native
// library of one platform. A trim that removed something the models need then
// fails the build, on the CPU the image is for, rather than in a container.
// An operator can run it in a container as well:
//
//   docker exec contrack node scripts/model-smoke.ts

import "../server/utils/loadEnv.ts";
import {
  EMBEDDING_MODEL_ID,
  PINNED_MODELS,
  configureModelLibrary,
} from "../server/services/search/modelFiles.ts";

/** The width of an all-MiniLM-L6-v2 vector. */
const EMBEDDING_WIDTH = 384;

const library = await import("@huggingface/transformers");
configureModelLibrary(library.env);

const embed = await library.pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
  dtype: "q8",
});
const vector = await embed("Contrack keeps track of people.", {
  pooling: "mean",
  normalize: true,
});
if (vector.dims.at(-1) !== EMBEDDING_WIDTH) {
  throw new Error(
    `${EMBEDDING_MODEL_ID} gave a vector of ${vector.dims.join("x")}, not ${EMBEDDING_WIDTH} wide`,
  );
}

for (const { id } of PINNED_MODELS.filter(
  (model) => model.id !== EMBEDDING_MODEL_ID,
)) {
  const tokenizer = await library.AutoTokenizer.from_pretrained(id);
  const model =
    await library.AutoModelForSequenceClassification.from_pretrained(id, {
      dtype: "q8",
    });
  const inputs = tokenizer(["who works at a bank"], {
    text_pair: ["Ada is a teller at a bank"],
    padding: true,
    truncation: true,
  });
  const { logits } = (await model(inputs)) as {
    logits: { tolist(): number[][] };
  };
  if (!Number.isFinite(logits.tolist()[0]?.[0])) {
    throw new Error(`${id} gave no score`);
  }
}

console.log(
  `The local search models load and run on ${process.platform}/${process.arch}.`,
);
