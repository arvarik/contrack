/**
 * CapabilitiesCard — "what powers each kind of AI work".
 *
 * Three problems with the version this replaces, all of them the same
 * problem in different clothes: it assumed the reader already knew how the
 * system worked.
 *
 *  1. Four capabilities were listed flat, with no hint that "quick" and
 *     "deep" are the same kind of thing (a language model) and that
 *     embeddings and web research are not. What each one powered was hidden
 *     behind a hover tooltip — invisible on touch, and invisible to anyone
 *     who did not think to hover.
 *
 *  2. Unpinned capabilities read "→ your connected providers, chosen
 *     automatically", which is a true statement that answers no question a
 *     user actually has. They now name the model that will run.
 *
 *  3. Changing the dropdown saved immediately and fired a success toast, so
 *     a click-through while reading the list silently re-pointed a capability
 *     — and in the embeddings case kicked off a full re-index. Selection is
 *     now local state; nothing is written until Save.
 *
 * Layout is mobile-first: the select is full width and the actions wrap
 * beneath it, expanding to a single row from `sm`.
 */
import React, { useState } from "react";
import {
  AlertTriangle,
  Brain,
  BrainCircuit,
  Check,
  Dna,
  Globe,
  Info,
  Loader2,
  MessageSquareText,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCapabilityModels,
  useSetCapability,
  type AICapability,
  type AISettings,
  type CapabilityAssignment,
} from "../../api/aiSettings";
import { CARD, SECTION_HEADING } from "../../lib/styles";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// Capability metadata
// ---------------------------------------------------------------------------

interface CapabilityMeta {
  key: AICapability;
  label: string;
  icon: React.ReactNode;
  /** One line, always visible: what this capability powers. */
  summary: string;
  /** The full feature list, behind a disclosure. */
  detail: string;
  /** Extra option beyond auto/pinned. */
  specialMode?: { mode: "auto" | "disabled"; label: string };
  /** Shown while the change is still pending, when it matters most. */
  warning?: string;
}

/**
 * The groups exist to answer the question the flat list provoked: "what are
 * these four things and why are there four of them?" Two of them are the
 * same tool at different sizes; the other two are different tools entirely.
 */
interface CapabilityGroup {
  id: string;
  title: string;
  icon: React.ReactNode;
  /** Plain-language explanation of the *kind* of work, not the setting. */
  blurb: string;
  capabilities: CapabilityMeta[];
}

const GROUPS: CapabilityGroup[] = [
  {
    id: "language",
    title: "Language models",
    icon: <MessageSquareText className="w-4 h-4 text-primary" />,
    blurb:
      "Reading and writing text — parsing a pasted signature, summarising an email, deciding whether two contacts are the same person. Contrack splits this in two so routine work runs on a cheap fast model and the hard work runs on a stronger one.",
    capabilities: [
      {
        key: "quick",
        label: "Quick tasks",
        icon: <Zap className="w-4 h-4 text-warning" />,
        summary: "High volume, low complexity. Favours cheap, fast models.",
        detail:
          "Magic Paste contact parsing, @mention extraction, search understanding and result verification, daily insights, and search expansion.",
      },
      {
        key: "deep",
        label: "Deep tasks",
        icon: <BrainCircuit className="w-4 h-4 text-primary" />,
        summary: "Lower volume, harder reasoning. Favours stronger models.",
        detail:
          "Email (.eml) summarisation, duplicate adjudication, and structured extraction from research results.",
      },
    ],
  },
  {
    id: "embeddings",
    title: "Embeddings",
    icon: <Dna className="w-4 h-4 text-success" />,
    blurb:
      "A different kind of model: instead of writing text it turns each contact into a list of numbers, so Contrack can compare people by meaning rather than spelling. This is what makes “who works in climate tech?” find someone whose profile never says those words.",
    capabilities: [
      {
        key: "embeddings",
        label: "Embedding model",
        icon: <Dna className="w-4 h-4 text-success" />,
        summary:
          "Powers semantic search ranking and duplicate similarity detection.",
        detail:
          "The built-in model runs locally, costs nothing, and works offline. A hosted model can rank better on large networks, at the cost of sending contact text to that provider.",
        specialMode: { mode: "auto", label: "Built-in (local, recommended)" },
        warning:
          "Saving a different embedding model re-embeds every contact and rebuilds both vector indexes in the background. Search results will be incomplete until that finishes.",
      },
    ],
  },
  {
    id: "research",
    title: "Web research",
    icon: <Globe className="w-4 h-4 text-info" />,
    blurb:
      "Looking things up on the live internet. Only some models can do this — it needs a built-in search tool, so the list below is much shorter than the language-model lists above. A self-hosted SearXNG instance can stand in for it.",
    capabilities: [
      {
        key: "research",
        label: "Research model",
        icon: <Globe className="w-4 h-4 text-info" />,
        summary: "Powers Contact Enrichment — researching people on the web.",
        detail:
          "Only models with a first-party web-search tool are listed. Custom OpenAI-compatible endpoints never appear here: the compat API has no search standard.",
        specialMode: { mode: "disabled", label: "Off — never research online" },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode an assignment as a `<select>` value. */
const toSelectValue = (assignment: CapabilityAssignment): string =>
  assignment.mode === "pinned" && assignment.providerId && assignment.model
    ? `${assignment.providerId}::${assignment.model}`
    : assignment.mode;

/** Decode a `<select>` value back into an assignment. */
const fromSelectValue = (value: string): CapabilityAssignment =>
  value.includes("::")
    ? {
        mode: "pinned",
        providerId: value.split("::")[0],
        // Model ids can contain "::" in principle; only the first is a
        // separator.
        model: value.split("::").slice(1).join("::"),
      }
    : { mode: value as CapabilityAssignment["mode"] };

// ---------------------------------------------------------------------------
// One capability
// ---------------------------------------------------------------------------

const CapabilityRow = ({
  meta,
  state,
}: {
  meta: CapabilityMeta;
  state?: AISettings["capabilities"][string];
}) => {
  const { data: groups = [], isLoading: modelsLoading } = useCapabilityModels(
    meta.key,
  );
  const setCapability = useSetCapability();

  const saved = state?.assignment ?? { mode: "auto" as const };
  const savedValue = toSelectValue(saved);

  // Local until Save. `null` means "no local edit", which keeps the row in
  // sync when the server view refreshes underneath us.
  const [draft, setDraft] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const value = draft ?? savedValue;
  const isDirty = draft !== null && draft !== savedValue;

  const resolved = state?.resolved;
  const modelCount = groups.reduce((n, g) => n + g.models.length, 0);

  const handleSave = () => {
    if (!isDirty) return;
    setCapability
      .mutateAsync({
        capability: meta.key,
        assignment: fromSelectValue(value),
      })
      .then(() => {
        setDraft(null);
        toast.success(`${meta.label} saved`);
      })
      .catch((err) => toast.error(String(err?.message ?? err)));
  };

  /**
   * What is running right now, named concretely.
   *
   * The model leads and the fact that Contrack chose it is demoted to a pill —
   * the previous copy did the opposite ("→ your connected providers, chosen
   * automatically"), foregrounding the mechanism and omitting the answer.
   */
  const currentLine = resolved ? (
    <>
      <Check className="w-3.5 h-3.5 text-success shrink-0 mt-px" />
      <span className="min-w-0">
        {resolved.label ? (
          <span className="font-bold text-on-surface">{resolved.label}</span>
        ) : (
          <>
            <span className="font-bold text-on-surface">
              {resolved.providerLabel}
            </span>
            {resolved.model && (
              <>
                {" · "}
                <span className="font-mono text-[11px] break-all">
                  {resolved.model}
                </span>
              </>
            )}
          </>
        )}
        {saved.mode === "auto" && (
          <span className="ml-1.5 align-[1px] text-[9px] font-bold uppercase tracking-widest bg-surface-container-high text-on-surface-variant px-1.5 py-0.5 rounded whitespace-nowrap">
            Automatic
          </span>
        )}
      </span>
    </>
  ) : (
    <>
      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
      <span className="text-warning">
        {saved.mode === "disabled"
          ? "Turned off. Contrack will not use this capability."
          : (state?.unavailableReason ??
            "Nothing available for this capability.")}
      </span>
    </>
  );

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-on-surface">
              {meta.label}
            </span>
            {isDirty && (
              <span className="text-[9px] font-bold uppercase tracking-widest bg-amber-500/15 text-warning px-1.5 py-0.5 rounded">
                Unsaved
              </span>
            )}
          </div>
          {/* Always visible — this used to be a hover-only tooltip. */}
          <p className="text-xs text-on-surface-variant mt-0.5 text-pretty">
            {meta.summary}{" "}
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              className="inline-flex items-center gap-1 text-primary hover:underline font-semibold align-baseline"
            >
              <Info className="w-3 h-3" />
              {showDetail ? "Less" : "What uses this?"}
            </button>
          </p>
          {showDetail && (
            <p className="fade-enter text-xs text-on-surface-variant mt-1.5 bg-surface-container-low rounded-lg px-3 py-2 text-pretty">
              {meta.detail}
            </p>
          )}
        </div>
      </div>

      {/* Control + actions */}
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor={`capability-${meta.key}`} className="flex-1 min-w-0">
          <span className="sr-only">{meta.label} model</span>
          <select
            id={`capability-${meta.key}`}
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-surface-container-highest text-sm outline-none focus:ring-2 focus:ring-primary/40"
          >
            {/* The concrete model lives on the status line below, not in
                here — repeating it in both made the row read twice. */}
            {meta.key !== "embeddings" && (
              <option value="auto">Automatic — pick the best available</option>
            )}
            {meta.specialMode && (
              <option value={meta.specialMode.mode}>
                {meta.specialMode.label}
              </option>
            )}
            {groups.map((group) => (
              <optgroup key={group.providerId} label={group.providerLabel}>
                {group.models.map((model) => (
                  <option
                    key={`${group.providerId}::${model.id}`}
                    value={`${group.providerId}::${model.id}`}
                  >
                    {model.label}
                    {model.capabilityConfidence === "guessed" ? " (?)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {isDirty && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="flex-1 sm:flex-none px-3 py-2.5 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={setCapability.isPending}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none disabled:cursor-not-allowed"
            >
              {setCapability.isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              Save
            </button>
          </div>
        )}
      </div>

      {/* Status: what runs today, or why nothing does. */}
      <div className="flex items-start gap-1.5 text-xs text-on-surface-variant mt-2">
        {currentLine}
      </div>

      {/* No eligible models — say so rather than showing an empty dropdown. */}
      {!modelsLoading && modelCount === 0 && (
        <p className="text-xs text-on-surface-variant mt-1.5">
          {meta.key === "research"
            ? "None of your connected providers offer a web-search model."
            : "No connected provider has models for this yet — add a key above, or refresh a provider's model list."}
        </p>
      )}

      {/* The re-index warning belongs to the moment of deciding, not after. */}
      {meta.warning && isDirty && (
        <div className="flex items-start gap-1.5 text-xs text-warning bg-amber-500/10 rounded-lg px-3 py-2 mt-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span className="text-pretty">{meta.warning}</span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export const CapabilitiesCard = ({ settings }: { settings: AISettings }) => {
  const hasAnyProvider = settings.providers.length > 0;

  return (
    <section className={cn(CARD, "space-y-5 p-4 sm:p-6")}>
      <div>
        <h3 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
          <Brain className="w-5 h-5 text-primary" />
          What powers each task
        </h3>
        <p className="text-sm text-on-surface-variant mt-1.5 text-pretty">
          Contrack uses three different kinds of AI, and they are not
          interchangeable. Each section below explains one kind and lets you
          choose what runs it — or leave it on <strong>Automatic</strong>, which
          picks the best option from whatever you have connected.
        </p>
      </div>

      {!hasAnyProvider && (
        <div className="flex items-start gap-2 text-sm text-warning bg-amber-500/10 rounded-xl p-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="text-pretty">
            No providers connected, so the language-model and web-research
            features are off. Semantic search still works — it runs on the
            built-in local embedding model.
          </span>
        </div>
      )}

      {GROUPS.map((group) => (
        <div
          key={group.id}
          className="rounded-2xl bg-surface-container-low p-4"
        >
          <div className="flex items-center gap-2">
            {group.icon}
            <h4 className="text-sm font-bold text-on-surface">{group.title}</h4>
          </div>
          <p className="text-xs text-on-surface-variant mt-1 text-pretty">
            {group.blurb}
          </p>

          <div className="mt-3 divide-y divide-surface-container-high">
            {group.capabilities.map((meta) => (
              <CapabilityRow
                key={meta.key}
                meta={meta}
                state={settings.capabilities[meta.key]}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};
