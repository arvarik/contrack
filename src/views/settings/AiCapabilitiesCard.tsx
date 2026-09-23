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
 *
 * The list sits in the Privacy page's "AI on this instance" card. The names
 * are the ones the AI providers page uses, so an admin and a member call each
 * kind of work by the same name.
 */
import { Check, Minus } from "lucide-react";
import { useAISettings, type AICapability } from "../../api/aiSettings";

const CAPABILITIES: { key: AICapability; label: string; does: string }[] = [
  {
    key: "quick",
    label: "Quick tasks",
    does: "Reading a signature, summaries, short answers.",
  },
  {
    key: "deep",
    label: "Deep tasks",
    does: "Judging duplicates, and longer reasoning.",
  },
  { key: "research", label: "Web research", does: "Enrichment from the web." },
  {
    key: "embeddings",
    label: "Embeddings",
    does: "Search by meaning, and matching duplicates.",
  },
];

/** One row per kind of AI work: served, and by whom, or not set up. */
export const AiCapabilitiesList = () => {
  const { data: settings, isLoading } = useAISettings();

  if (isLoading || !settings) {
    return (
      <ul
        aria-busy="true"
        aria-label="Loading AI capabilities"
        className="space-y-2"
      >
        {CAPABILITIES.map((capability) => (
          <li
            key={capability.key}
            className="h-14 rounded-xl bg-surface-container-low animate-pulse"
          />
        ))}
      </ul>
    );
  }

  return (
    <ul className="space-y-2">
      {CAPABILITIES.map((capability) => {
        const resolved = settings.capabilities[capability.key]?.resolved;
        return (
          <li
            key={capability.key}
            className="flex items-start gap-2.5 rounded-xl bg-surface-container-low px-3 py-2.5"
          >
            {resolved ? (
              <Check
                aria-hidden="true"
                className="w-4 h-4 text-success shrink-0 mt-0.5"
              />
            ) : (
              <Minus
                aria-hidden="true"
                className="w-4 h-4 text-on-surface-variant shrink-0 mt-0.5"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-on-surface">
                {capability.label}
                <span className="ml-2 text-xs font-normal text-on-surface-variant">
                  {resolved
                    ? (resolved.providerLabel ?? resolved.label ?? "On")
                    : "Not set up"}
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
  );
};
