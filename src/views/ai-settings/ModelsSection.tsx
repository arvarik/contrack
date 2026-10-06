/**
 * ModelsSection: the models every AI feature runs on, on Administration →
 * AI.
 *
 * Three choices and one fact. The Fast model takes the frequent, simple
 * work and the Strong model the rarer, harder work: the same kind of model
 * at two sizes, so routine work runs on a cheap one. The embedding model is
 * a different kind of model, which turns contacts into numbers to compare
 * by meaning; the search index's coverage sits under it, since a new one
 * rebuilds the index. The reranker is read-only: only SEARCH_RERANK_MODEL
 * sets it, and the row says so instead of leaving it unseen.
 *
 * The web search model is in the Web search section, beside the switch and
 * SearXNG it works with.
 *
 * @module views/ai-settings/ModelsSection
 */
import { Check, Minus } from "lucide-react";
import type { AISettings } from "../../api/aiSettings";
import { featuresUsing } from "../../lib/aiFeatures";
import { SearchCoverageBar } from "../search";
import { useHashTarget } from "../settings/SettingRow";
import { SETTINGS_CARD, SETTINGS_SECTION_HEADING } from "../settings/layout";
import { cn } from "../../lib/utils";
import { ModelRow } from "./ModelRow";

const NO_CHAT_MODELS =
  "No connected provider has a chat model. Add a key or a server under Providers";

export function ModelsSection({ settings }: { settings: AISettings }) {
  const { capabilities } = settings;
  return (
    <section aria-labelledby="models-heading">
      <h2 id="models-heading" className={SETTINGS_SECTION_HEADING}>
        Models
      </h2>
      <div className={SETTINGS_CARD}>
        <p className="text-sm text-on-surface-variant text-pretty pb-2">
          Each model serves several features. Automatic picks from the providers
          you connected
        </p>
        <ModelRow
          id="fast-model"
          capability="quick"
          title="Fast model"
          summary="Quick, frequent work. A small, cheap model fits"
          usedBy={featuresUsing("fast")}
          state={capabilities.quick}
          noModels={NO_CHAT_MODELS}
        />
        <ModelRow
          id="strong-model"
          capability="deep"
          title="Strong model"
          summary="Rarer, harder work. A more capable model fits"
          usedBy={featuresUsing("strong")}
          state={capabilities.deep}
          noModels={NO_CHAT_MODELS}
        />
        <ModelRow
          id="embedding-model"
          capability="embeddings"
          title="Embedding model"
          summary="Turns each contact into numbers, to compare people by meaning. The built-in model runs on the server, free and offline. A hosted one gets every contact's profile text"
          usedBy={featuresUsing("embedding")}
          state={capabilities.embeddings}
          autoLabel="Built-in (recommended)"
          warning="Saving another embedding model rebuilds the search index in the background. Search by meaning is incomplete until it finishes"
          noModels="No connected provider has an embedding model. The built-in one always works"
        />
        <div className="pb-4">
          <SearchCoverageBar />
        </div>
        <RerankerRow reranker={settings.reranker} />
      </div>
    </section>
  );
}

/** The reranker: what it does, what runs, and that only a variable sets it. */
function RerankerRow({ reranker }: { reranker: AISettings["reranker"] }) {
  const { ref, flashing } = useHashTarget<HTMLDivElement>("reranker");
  return (
    <div
      id="reranker"
      ref={ref}
      tabIndex={-1}
      className={cn(
        "scroll-mt-20 outline-none rounded-xl transition-colors duration-(--dur-slow)",
        "-mx-3 px-3 py-4 last:-mb-2 last:pb-2",
        flashing && "flash bg-primary/10",
      )}
    >
      <h3 className="text-sm font-bold text-on-surface">Reranker</h3>
      <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
        Puts Ask Contrack's best matches first. It runs on the server
      </p>
      <p className="text-xs text-on-surface-variant mt-0.5">
        Used by {featuresUsing("reranker").join(", ")}
      </p>
      <div className="flex items-start gap-1.5 text-xs text-on-surface-variant mt-2">
        {reranker.model ? (
          <Check className="w-3.5 h-3.5 text-success shrink-0 mt-px" />
        ) : (
          <Minus className="w-3.5 h-3.5 shrink-0 mt-px" />
        )}
        <span className="min-w-0">
          <span className="font-bold text-on-surface">
            {reranker.model ? "Built-in" : "Off"}
          </span>
          {reranker.model && (
            <>
              {" · "}
              <span className="font-mono text-[11px] break-all">
                {reranker.model}
              </span>
            </>
          )}
          {". "}
          {reranker.source === "env"
            ? "Set by SEARCH_RERANK_MODEL"
            : "Only SEARCH_RERANK_MODEL changes it"}
        </span>
      </div>
    </div>
  );
}
