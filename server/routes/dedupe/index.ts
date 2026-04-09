import { Router } from "express";
import { registerScanRoutes } from "./scan.ts";
import { registerMergeRoutes } from "./merge.ts";
import { registerSuggestionRoutes } from "./suggestions.ts";
import { registerEmbeddingRoutes } from "./embeddings.ts";

export const dedupeRouter = Router();

registerScanRoutes(dedupeRouter);
registerMergeRoutes(dedupeRouter);
registerSuggestionRoutes(dedupeRouter);
registerEmbeddingRoutes(dedupeRouter);
