import { sqlite } from "../../db.ts";
import { resolveEmbeddings } from "../../ai/embeddings.ts";
import { embedContact } from "./localEmbeddings.ts";
import { log } from "../../utils/logger.ts";
import { getErrorMessage } from "../../utils/helpers.ts";

const pending = new Set<string>();
let running = false;
let timer: ReturnType<typeof setTimeout> | undefined;

async function drain(): Promise<void> {
  timer = undefined;
  if (running) return;
  running = true;
  try {
    while (pending.size) {
      const id = pending.values().next().value!;
      pending.delete(id);
      // Automatic refreshes run locally. Provider embeddings use the explicit backfill path.
      if (resolveEmbeddings().kind !== "builtin") continue;
      try {
        await embedContact(id);
      } catch (error) {
        log.warn(
          "SearchIndex",
          `Local refresh failed for ${id}: ${getErrorMessage(error)}`,
        );
      }
    }
  } finally {
    running = false;
  }
}

/** Coalesce local indexing after edits. FTS updates in the contact transaction. */
export function scheduleSearchIndex(id: string): void {
  sqlite
    .prepare(
      "UPDATE contacts SET searchExpansion = NULL WHERE id = ? AND searchExpansion IS NOT NULL",
    )
    .run(id);
  if (process.env.DISABLE_BACKGROUND_JOBS === "true") return;
  pending.add(id);
  if (!timer && !running) {
    timer = setTimeout(() => void drain(), 250);
    timer.unref();
  }
}
