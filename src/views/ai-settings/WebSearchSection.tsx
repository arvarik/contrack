/**
 * WebSearchSection: everything contact research's web search needs, in one
 * place on Administration → AI.
 *
 * 1. "Allow web search": off stops every web search, the web search
 *    model's and SearXNG's. It was the research model's "Off" option, a
 *    model choice that also stopped a second engine and lost a pinned model.
 * 2. The web search model: a model that searches the web itself.
 * 3. The SearXNG address. It was under General, apart from everything it
 *    works with. SEARXNG_URL sets it and locks the field.
 * 4. The web search engine: what research searches with when an account
 *    keeps "Instance default".
 *
 * @module views/ai-settings/WebSearchSection
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  useSetSearxng,
  useSetWebSearch,
  type AISettings,
} from "../../api/aiSettings";
import { Switch } from "../../components/ui/Switch";
import { featuresUsing } from "../../lib/aiFeatures";
import { SettingRow } from "../settings/SettingRow";
import { EngineChoice } from "../settings/EngineChoice";
import { SETTINGS_CARD, SETTINGS_SECTION_HEADING } from "../settings/layout";
import { cn } from "../../lib/utils";
import { ModelRow } from "./ModelRow";

const FIELD =
  "w-full min-h-[44px] sm:min-h-0 px-3 py-2 rounded-xl bg-surface-container-highest text-sm font-mono";

export function WebSearchSection({ settings }: { settings: AISettings }) {
  const setWebSearch = useSetWebSearch();
  const { webSearch } = settings;

  const allow = (on: boolean) =>
    setWebSearch.mutate(
      { allowed: on },
      {
        onSuccess: () =>
          toast.success(on ? "Web search is on" : "Web search is off"),
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : String(err)),
      },
    );

  return (
    <section aria-labelledby="web-search-heading">
      <h2 id="web-search-heading" className={SETTINGS_SECTION_HEADING}>
        Web search
      </h2>
      <div className={SETTINGS_CARD}>
        <SettingRow
          id="allow-web-search"
          title="Allow web search"
          description="Contact research searches the web for public facts. Off stops every web search, SearXNG's too"
          inline
        >
          <Switch
            label="Allow web search"
            checked={webSearch.allowed}
            disabled={setWebSearch.isPending}
            onChange={allow}
          />
        </SettingRow>
        <ModelRow
          id="web-search-model"
          capability="research"
          title="Web search model"
          summary="A model that searches the web itself. Only Gemini, OpenAI and Anthropic models can"
          usedBy={featuresUsing("webSearch")}
          state={settings.capabilities.research}
          noModels="None of your providers has a model that searches the web"
        />
        <SettingRow
          id="searxng"
          title="SearXNG address"
          description="Your own SearXNG search engine, such as http://127.0.0.1:8888. Turn on its JSON answers"
          below
        >
          <SearxngField searxng={webSearch.searxng} />
        </SettingRow>
        <SettingRow
          id="web-search-engine"
          title="Web search engine"
          description={
            settings.multipleAccounts
              ? "What contact research searches with. An account can choose its own on Contact enrichment"
              : "What contact research searches with. Contact enrichment shows it too"
          }
          below
        >
          <EngineChoice scope="instance" />
        </SettingRow>
      </div>
    </section>
  );
}

/** The SearXNG address: a field, Save and Remove, or the variable that sets it. */
function SearxngField({
  searxng,
}: {
  searxng: AISettings["webSearch"]["searxng"];
}) {
  const setSearxng = useSetSearxng();
  const [input, setInput] = useState<string | null>(null);
  const value = input ?? searxng.url ?? "";

  if (searxng.source === "env") {
    return (
      <p className="text-xs sm:text-sm text-on-surface-variant">
        <span className="font-mono text-on-surface">{searxng.url}</span>. Set by{" "}
        <code className="font-mono">SEARXNG_URL</code>
      </p>
    );
  }

  const save = (url: string, message: string) =>
    setSearxng.mutate(url, {
      onSuccess: () => {
        setInput(null);
        toast.success(message);
      },
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
    });

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      <input
        id="searxng-url"
        type="url"
        aria-label="SearXNG address"
        value={value}
        disabled={setSearxng.isPending}
        onChange={(event) => setInput(event.target.value)}
        placeholder="http://127.0.0.1:8888"
        className={cn(FIELD, "flex-1 min-w-0")}
      />
      <button
        type="button"
        disabled={input === null || setSearxng.isPending}
        onClick={() => save(value.trim(), "SearXNG address saved")}
        className="btn-primary shrink-0"
      >
        Save
      </button>
      {searxng.url && (
        <button
          type="button"
          disabled={setSearxng.isPending}
          onClick={() => save("", "SearXNG address removed")}
          className="btn-secondary shrink-0 text-error"
        >
          Remove
        </button>
      )}
    </div>
  );
}
