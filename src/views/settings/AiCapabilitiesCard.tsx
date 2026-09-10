/**
 * What AI this instance can do, for somebody who cannot change it.
 *
 * The AI configuration moved under Administration in 2.0: it is one set of
 * provider keys paying one bill, so it is an operator's page. A member still
 * needs the answer to a real question — why did enrichment do nothing, why is
 * semantic search off — and "ask your administrator" is not that answer when
 * the app already knows.
 *
 * Read-only, and deliberately says nothing about keys. `GET /api/settings/ai`
 * is class `instance-read` and a member may call it; what they get back is
 * which capability is served and by whom, which is the part that explains the
 * behaviour they can see.
 */
import { Brain, Check, Minus } from "lucide-react";
import { useAISettings, type AICapability } from "../../api/aiSettings";
import { SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";

const CAPABILITIES: { key: AICapability; label: string; does: string }[] = [
  { key: "quick", label: "Quick", does: "Parsing, summaries, short answers." },
  {
    key: "deep",
    label: "Deep",
    does: "Duplicate judgement, longer reasoning.",
  },
  { key: "research", label: "Research", does: "Enrichment from the live web." },
  {
    key: "embeddings",
    label: "Embeddings",
    does: "Semantic search and duplicate matching.",
  },
];

export const AiCapabilitiesCard = () => {
  const { data: settings, isLoading } = useAISettings();

  return (
    <div className="bg-surface-container-lowest rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Brain className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className={cn(SECTION_HEADING, "text-xs")}>
            Available AI capabilities
          </h3>
          <p className="text-xs text-on-surface-variant mt-0.5 text-pretty">
            Set by an administrator for the whole instance.
          </p>
        </div>
      </div>

      {isLoading || !settings ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : (
        <ul className="space-y-1.5">
          {CAPABILITIES.map((capability) => {
            const resolved = settings.capabilities[capability.key]?.resolved;
            return (
              <li
                key={capability.key}
                className="flex items-start gap-2.5 rounded-xl bg-surface-container-low px-3 py-2"
              >
                {resolved ? (
                  <Check className="w-4 h-4 text-success shrink-0 mt-0.5" />
                ) : (
                  <Minus className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-on-surface">
                    {capability.label}
                    <span className="ml-2 text-xs font-normal text-on-surface-variant">
                      {resolved
                        ? (resolved.providerLabel ?? resolved.label ?? "on")
                        : "not configured"}
                    </span>
                  </p>
                  <p className="text-xs text-on-surface-variant text-pretty">
                    {capability.does}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
