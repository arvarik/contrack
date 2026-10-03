/**
 * ModelRow: one model choice on Administration → AI: the Fast model, the
 * Strong model, the embedding model, or the web search model.
 *
 * ```
 * Fast model                                                       Unsaved
 * Quick, frequent work. A small, cheap model fits.
 * Used by Ask Contrack, Contact research, Briefings and insights, …
 * [ Automatic                                        ▾ ] [Cancel] [Save]
 * ✓ Google Gemini · gemini-3.5-flash-lite
 * ```
 *
 * The select is local until Save: a click while reading the list never
 * re-points a model, and for the embedding model never starts a rebuild of
 * the search index. The line under it names what runs now. The select
 * already says how it was chosen (Automatic, the `AI_*_MODEL` variable, or
 * a pin), so the line says it only when the two differ: a pinned model that
 * cannot run now, and what runs in its place. A pin the catalog no longer
 * lists stays visible, so the field never goes blank.
 *
 * The "Used by" line comes from the feature table (`lib/aiFeatures`), the
 * one the "What each feature uses" list reads, so the two never disagree.
 *
 * @module views/ai-settings/ModelRow
 */
import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCapabilityModels,
  useSetCapability,
  type AICapability,
  type AISettings,
  type CapabilityAssignment,
} from "../../api/aiSettings";
import { Select, type SelectOption } from "../../components/ui/Select";
import { useHashTarget } from "../settings/SettingRow";
import { cn } from "../../lib/utils";

interface ModelRowProps {
  /** The row's anchor: settings search and the feature list link to it. */
  id: string;
  capability: AICapability;
  title: string;
  /** What kind of work it is, and what kind of model fits, in a line. */
  summary: string;
  /** The features that use it, from `featuresUsing`. */
  usedBy: string[];
  state?: AISettings["capabilities"][string];
  /** Automatic's own name, when it is not "Automatic" (the built-in model). */
  autoLabel?: string;
  /** Said under the select while a change is unsaved. */
  warning?: string;
  /** Said when no connected provider has a model for it. */
  noModels: string;
}

/** An assignment as a select value. */
const toValue = (assignment: CapabilityAssignment): string =>
  assignment.mode === "pinned" && assignment.providerId && assignment.model
    ? `${assignment.providerId}::${assignment.model}`
    : "auto";

/** A select value back as an assignment. */
const fromValue = (value: string): CapabilityAssignment =>
  value.includes("::")
    ? {
        mode: "pinned",
        providerId: value.split("::")[0],
        // Model ids can contain "::" in principle; only the first is a
        // separator.
        model: value.split("::").slice(1).join("::"),
      }
    : { mode: "auto" };

export function ModelRow({
  id,
  capability,
  title,
  summary,
  usedBy,
  state,
  autoLabel = "Automatic",
  warning,
  noModels,
}: ModelRowProps) {
  const { ref, flashing } = useHashTarget<HTMLDivElement>(id);
  const { data: groups = [], isLoading } = useCapabilityModels(capability);
  const setCapability = useSetCapability();
  const [draft, setDraft] = useState<string | null>(null);

  const saved = state?.assignment ?? { mode: "auto" as const };
  const savedValue = toValue(saved);
  const value = draft ?? savedValue;
  const isDirty = draft !== null && draft !== savedValue;
  const resolved = state?.resolved;
  const envDefault = state?.envDefault;
  const modelCount = groups.reduce((n, group) => n + group.models.length, 0);

  // With AI_*_MODEL set, the variable chooses in Automatic's place, so the
  // option says so rather than promising an automatic pick.
  const options: SelectOption[] = [
    { value: "auto", label: envDefault ? `From ${envDefault}` : autoLabel },
    ...groups.flatMap((group) =>
      group.models.map((model) => ({
        value: `${group.providerId}::${model.id}`,
        label:
          model.label +
          (model.capabilityConfidence === "guessed" ? " (?)" : ""),
        group: group.providerLabel,
      })),
    ),
  ];
  if (
    saved.mode === "pinned" &&
    saved.model &&
    !options.some((option) => option.value === savedValue)
  ) {
    options.push({
      value: savedValue,
      label: `${saved.model} (no longer listed)`,
      group: resolved?.providerLabel ?? saved.providerId,
    });
  }

  const save = () => {
    if (!isDirty) return;
    setCapability
      .mutateAsync({ capability, assignment: fromValue(value) })
      .then(() => {
        setDraft(null);
        toast.success(`${title} saved`);
      })
      .catch((err) => toast.error(String(err?.message ?? err)));
  };

  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      className={cn(
        "scroll-mt-20 outline-none rounded-xl transition-colors duration-(--dur-slow)",
        "-mx-3 px-3 py-4 first:-mt-2 first:pt-2 last:-mb-2 last:pb-2",
        flashing && "flash bg-primary/10",
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-on-surface">{title}</h3>
        {isDirty && (
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] bg-warning/15 text-warning px-1.5 py-0.5 rounded">
            Unsaved
          </span>
        )}
      </div>
      <p className="text-xs sm:text-sm text-on-surface-variant mt-0.5 text-pretty">
        {summary}
      </p>
      <p className="text-xs text-on-surface-variant mt-0.5 text-pretty">
        Used by {usedBy.join(", ")}
      </p>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <Select
            id={`capability-${capability}`}
            label={title}
            variant="field"
            value={value}
            onChange={(next) => setDraft(next)}
            options={options}
            placeholder={isLoading ? "Loading models…" : "Choose a model"}
          />
        </div>
        {isDirty && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="btn-secondary flex-1 sm:flex-none"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={setCapability.isPending}
              className="btn-primary flex-1 sm:flex-none"
            >
              {setCapability.isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              Save
            </button>
          </div>
        )}
      </div>

      {/* What runs now, or why nothing does. */}
      <div className="flex items-start gap-1.5 text-xs text-on-surface-variant mt-2">
        {resolved ? (
          <>
            <Check className="w-3.5 h-3.5 text-success shrink-0 mt-px" />
            <span className="min-w-0">
              <span className="font-bold text-on-surface">
                {resolved.label ?? resolved.providerLabel}
              </span>
              {!resolved.label && resolved.model && (
                <>
                  {" · "}
                  <span className="font-mono text-[11px] break-all">
                    {resolved.model}
                  </span>
                </>
              )}
              {saved.mode === "pinned" && resolved.source !== "pinned" && (
                <span className="block mt-0.5 text-warning">
                  The pinned model cannot run now, so{" "}
                  {resolved.source === "env" && envDefault
                    ? envDefault
                    : "Automatic"}{" "}
                  chose this one
                </span>
              )}
              {saved.mode !== "pinned" &&
                envDefault &&
                resolved.source === "auto" && (
                  <span className="block mt-0.5 text-warning">
                    {envDefault} names a model that cannot run now, so Automatic
                    chose this one
                  </span>
                )}
            </span>
          </>
        ) : (
          <>
            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
            <span className="text-warning">
              {state?.unavailableReason ?? "Nothing runs this yet"}
            </span>
          </>
        )}
      </div>

      {!isLoading && modelCount === 0 && (
        <p className="text-xs text-on-surface-variant mt-1.5">{noModels}</p>
      )}

      {warning && isDirty && (
        <div className="flex items-start gap-1.5 text-xs text-warning bg-warning/10 rounded-lg px-3 py-2 mt-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
          <span className="text-pretty">{warning}</span>
        </div>
      )}
    </div>
  );
}
