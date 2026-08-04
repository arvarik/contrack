import React, { useState } from "react";
import {
  Zap,
  Brain,
  Dna,
  Globe,
  Plus,
  RefreshCw,
  Trash2,
  Check,
  AlertTriangle,
  Info,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAISettings,
  useCapabilityModels,
  useSetProviderKey,
  useDeleteProviderKey,
  useRefreshModels,
  useSetCapability,
  useSaveEndpoint,
  useDeleteEndpoint,
  useSetSearxng,
  type AICapability,
  type CapabilityAssignment,
} from "../../api/aiSettings";
import { Modal } from "../../components/ui/Modal";
import { CARD, SECTION_HEADING, ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// AISettingsView — capability-based AI configuration
// ---------------------------------------------------------------------------
// Users configure *what runs each kind of AI work*, not "the AI provider".
// Every capability defaults to Auto, so a user who pastes one key and never
// opens this page gets sensible behavior with zero configuration.
// ---------------------------------------------------------------------------

interface CapabilityMeta {
  key: AICapability;
  label: string;
  icon: React.ReactNode;
  /** What app features this capability powers. */
  tooltip: string;
  /** Extra option beyond auto/pinned. */
  specialMode?: { mode: "builtin" | "disabled"; label: string };
  warning?: string;
}

const CAPABILITIES: CapabilityMeta[] = [
  {
    key: "fast",
    label: "Fast model",
    icon: <Zap className="w-4 h-4 text-amber-500" />,
    tooltip:
      "Magic Paste contact parsing, @mention extraction, search understanding and result verification, daily insights, and search expansion. High volume, low complexity — favors cheap, quick models.",
  },
  {
    key: "smart",
    label: "Smart model",
    icon: <Brain className="w-4 h-4 text-primary" />,
    tooltip:
      "Email (.eml) summarization, duplicate adjudication, and structured extraction from research. Lower volume, higher reasoning — favors stronger models.",
  },
  {
    key: "embeddings",
    label: "Embeddings",
    icon: <Dna className="w-4 h-4 text-emerald-500" />,
    tooltip:
      "Semantic search ranking and duplicate similarity detection. The built-in model runs locally with no API cost and works offline.",
    specialMode: { mode: "builtin", label: "Built-in (local, recommended)" },
    warning:
      "Changing the embedding model rebuilds the vector index and re-embeds every contact in the background.",
  },
  {
    key: "research",
    label: "Online research",
    icon: <Globe className="w-4 h-4 text-sky-500" />,
    tooltip:
      "AI Search enrichment — researching contacts across the live web. Requires a provider with search grounding, or a self-hosted SearXNG instance.",
    specialMode: { mode: "disabled", label: "Disabled" },
  },
];

// ---------------------------------------------------------------------------

export const AISettingsView = () => {
  const { data: settings, isLoading } = useAISettings();
  const setKey = useSetProviderKey();
  const deleteKey = useDeleteProviderKey();
  const refreshModels = useRefreshModels();
  const saveEndpoint = useSaveEndpoint();
  const deleteEndpoint = useDeleteEndpoint();
  const setSearxng = useSetSearxng();

  const [keyModalProvider, setKeyModalProvider] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [endpointModalOpen, setEndpointModalOpen] = useState(false);
  const [endpointForm, setEndpointForm] = useState({
    id: "",
    label: "",
    baseUrl: "",
    apiKey: "",
  });
  const [searxngInput, setSearxngInput] = useState<string | null>(null);

  if (isLoading || !settings) {
    return (
      <div className="p-6 text-sm text-on-surface-variant">
        Loading AI settings…
      </div>
    );
  }

  const handleSaveKey = async () => {
    if (!keyModalProvider || !keyInput.trim()) return;
    try {
      const result = await setKey.mutateAsync({
        providerId: keyModalProvider.id,
        apiKey: keyInput.trim(),
      });
      toast.success(
        `${keyModalProvider.label} connected — ${result.modelCount} models available`,
      );
      setKeyModalProvider(null);
      setKeyInput("");
    } catch (err) {
      toast.error(
        `Could not connect: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleSaveEndpoint = async () => {
    try {
      const result = await saveEndpoint.mutateAsync({
        id: endpointForm.id.trim(),
        label: endpointForm.label.trim() || endpointForm.id.trim(),
        baseUrl: endpointForm.baseUrl.trim(),
        apiKey: endpointForm.apiKey.trim() || undefined,
      });
      toast.success(`Endpoint connected — ${result.modelCount} models found`);
      setEndpointModalOpen(false);
      setEndpointForm({ id: "", label: "", baseUrl: "", apiKey: "" });
    } catch (err) {
      toast.error(
        `Could not reach endpoint: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const hasAnyProvider = settings.providers.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* ── Providers ─────────────────────────────────────────────────── */}
      <section className={cn(CARD, "space-y-4")}>
        <div>
          <h3 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <Server className="w-5 h-5 text-primary" />
            Providers
          </h3>
          <p className="text-sm text-on-surface-variant mt-1">
            Add the services you have keys for. Contrack picks the right model
            for each task from whatever is connected.
          </p>
        </div>

        <div className="space-y-2">
          {settings.providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-surface-container-low"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-2">
                  {provider.label}
                  {provider.source === "env" && (
                    <span className="text-[9px] uppercase tracking-wider bg-surface-container-highest px-1.5 py-0.5 rounded font-bold text-on-surface-variant">
                      from .env
                    </span>
                  )}
                </div>
                <div className="text-xs text-on-surface-variant flex items-center gap-2 mt-0.5">
                  <span className="font-mono">{provider.keyPreview}</span>
                  {provider.modelCount !== null ? (
                    <span className="text-emerald-600 flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      {provider.modelCount} models
                    </span>
                  ) : (
                    <span className="text-on-surface-variant/70">
                      not yet discovered
                    </span>
                  )}
                  {provider.modelsError && (
                    <span
                      className="text-red-500 flex items-center gap-1"
                      title={provider.modelsError}
                    >
                      <AlertTriangle className="w-3 h-3" />
                      refresh failed
                    </span>
                  )}
                </div>
              </div>
              {provider.supportsDiscovery && (
                <button
                  onClick={() =>
                    refreshModels
                      .mutateAsync(provider.id)
                      .then((r) => toast.success(`${r.modelCount} models`))
                      .catch((e) => toast.error(String(e.message ?? e)))
                  }
                  disabled={refreshModels.isPending}
                  className={ICON_BTN}
                  title="Refresh model list"
                  aria-label={`Refresh models for ${provider.label}`}
                >
                  <RefreshCw
                    className={cn(
                      "w-4 h-4",
                      refreshModels.isPending && "animate-spin",
                    )}
                  />
                </button>
              )}
              {provider.source === "settings" && (
                <button
                  onClick={() =>
                    deleteKey
                      .mutateAsync(provider.id)
                      .then(() => toast.success(`${provider.label} removed`))
                  }
                  className={cn(ICON_BTN, "text-red-500")}
                  title="Remove key"
                  aria-label={`Remove ${provider.label} key`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}

          {settings.availableProviders.map((provider) => (
            <button
              key={provider.id}
              onClick={() => {
                setKeyModalProvider(provider);
                setKeyInput("");
              }}
              className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-dashed border-on-surface-variant/25 hover:bg-surface-container-low transition-colors text-left"
            >
              <Plus className="w-4 h-4 text-on-surface-variant" />
              <span className="text-sm text-on-surface-variant">
                Add {provider.label} key
              </span>
            </button>
          ))}
        </div>

        {/* Custom endpoints */}
        <div className="pt-2 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Custom endpoints (Ollama, vLLM, LM Studio, xAI…)
          </div>
          {settings.customEndpoints.map((endpoint) => (
            <div
              key={endpoint.id}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-surface-container-low"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm">{endpoint.label}</div>
                <div className="text-xs text-on-surface-variant font-mono truncate">
                  {endpoint.baseUrl}
                </div>
              </div>
              <button
                onClick={() =>
                  deleteEndpoint
                    .mutateAsync(endpoint.id)
                    .then(() => toast.success("Endpoint removed"))
                }
                className={cn(ICON_BTN, "text-red-500")}
                title="Remove endpoint"
                aria-label={`Remove ${endpoint.label}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setEndpointModalOpen(true)}
            className="w-full flex items-center gap-3 py-2.5 px-3 rounded-xl border border-dashed border-on-surface-variant/25 hover:bg-surface-container-low transition-colors text-left"
          >
            <Plus className="w-4 h-4 text-on-surface-variant" />
            <span className="text-sm text-on-surface-variant">
              Add an OpenAI-compatible endpoint
            </span>
          </button>
        </div>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────────── */}
      <section className={cn(CARD, "space-y-4")}>
        <div>
          <h3 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <Brain className="w-5 h-5 text-primary" />
            Capabilities
          </h3>
          <p className="text-sm text-on-surface-variant mt-1">
            Choose what powers each kind of AI work. <strong>Auto</strong> picks
            the best available option from your connected providers.
          </p>
        </div>

        {!hasAnyProvider && (
          <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-500/10 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              No providers connected. AI features are disabled — semantic search
              still works using the built-in local model.
            </span>
          </div>
        )}

        <div className="space-y-4">
          {CAPABILITIES.map((meta) => (
            <CapabilityRow
              key={meta.key}
              meta={meta}
              assignment={settings.capabilities[meta.key]?.assignment}
              resolved={settings.capabilities[meta.key]?.resolved}
            />
          ))}
        </div>

        {/* SearXNG — self-hosted research */}
        <div className="pt-2 border-t border-on-surface-variant/10 space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
            Self-hosted search (SearXNG)
          </h4>
          <p className="text-xs text-on-surface-variant">
            Enables online research without a cloud provider. Used automatically
            when no provider offers search grounding.
          </p>
          <div className="flex gap-2">
            {/* The control is nested in its label so the association holds
                without depending on id resolution. */}
            <label htmlFor="searxng-url" className="flex-1">
              <span className="sr-only">SearXNG base URL</span>
              <input
                id="searxng-url"
                type="url"
                aria-label="SearXNG base URL"
                value={searxngInput ?? settings.searxngUrl ?? ""}
                onChange={(e) => setSearxngInput(e.target.value)}
                placeholder="http://searxng.local:8080"
                className="w-full px-3 py-2 rounded-xl bg-surface-container-highest text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <button
              onClick={() =>
                setSearxng
                  .mutateAsync(searxngInput ?? "")
                  .then(() => toast.success("SearXNG endpoint saved"))
                  .catch((e) => toast.error(String(e.message ?? e)))
              }
              disabled={searxngInput === null}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </section>

      {/* ── Key modal ─────────────────────────────────────────────────── */}
      <Modal
        isOpen={!!keyModalProvider}
        onClose={() => setKeyModalProvider(null)}
        title={`Connect ${keyModalProvider?.label ?? ""}`}
      >
        <div className="space-y-4">
          <p className="text-sm text-on-surface-variant">
            Your key is stored locally in this app's database and never leaves
            your machine except to call {keyModalProvider?.label}.
          </p>
          <input
            type="password"
            aria-label={`${keyModalProvider?.label ?? "Provider"} API key`}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="API key"
            // Capturing this one value is the modal's entire purpose.
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="w-full px-4 py-3 rounded-xl bg-surface-container-highest text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setKeyModalProvider(null)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || setKey.isPending}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {setKey.isPending ? "Verifying…" : "Connect"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Endpoint modal ────────────────────────────────────────────── */}
      <Modal
        isOpen={endpointModalOpen}
        onClose={() => setEndpointModalOpen(false)}
        title="Add OpenAI-compatible endpoint"
      >
        <div className="space-y-3">
          <p className="text-sm text-on-surface-variant">
            Works with Ollama, vLLM, LM Studio, llama.cpp, xAI, DeepSeek,
            Mistral — anything speaking the OpenAI API format.
          </p>
          {(
            [
              { key: "id", label: "ID", placeholder: "homelab" },
              { key: "label", label: "Name", placeholder: "Homelab Ollama" },
              {
                key: "baseUrl",
                label: "Base URL",
                placeholder: "http://alpha:11434/v1",
              },
              {
                key: "apiKey",
                label: "API key (optional)",
                placeholder: "leave blank for local servers",
              },
            ] as const
          ).map((field) => (
            <label key={field.key} htmlFor={`endpoint-${field.key}`}>
              <span className="block text-xs font-bold text-on-surface-variant">
                {field.label}
              </span>
              <input
                id={`endpoint-${field.key}`}
                aria-label={field.label}
                value={endpointForm[field.key]}
                onChange={(e) =>
                  setEndpointForm((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
                placeholder={field.placeholder}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-surface-container-highest text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>
          ))}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setEndpointModalOpen(false)}
              className="px-4 py-2 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEndpoint}
              disabled={
                !endpointForm.id.trim() ||
                !endpointForm.baseUrl.trim() ||
                saveEndpoint.isPending
              }
              className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saveEndpoint.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ---------------------------------------------------------------------------
// One capability row: label + tooltip + model dropdown + resolved preview
// ---------------------------------------------------------------------------

const CapabilityRow = ({
  meta,
  assignment,
  resolved,
}: {
  meta: CapabilityMeta;
  assignment?: CapabilityAssignment;
  resolved?: { providerId: string; model?: string } | null;
}) => {
  const { data: groups = [] } = useCapabilityModels(meta.key);
  const setCapability = useSetCapability();

  const current = assignment ?? {
    mode: meta.key === "embeddings" ? "builtin" : "auto",
  };
  const value =
    current.mode === "pinned" && current.providerId && current.model
      ? `${current.providerId}::${current.model}`
      : current.mode;

  const handleChange = (next: string) => {
    const assignmentNext: CapabilityAssignment = next.includes("::")
      ? {
          mode: "pinned",
          providerId: next.split("::")[0],
          model: next.split("::").slice(1).join("::"),
        }
      : { mode: next as CapabilityAssignment["mode"] };

    setCapability
      .mutateAsync({ capability: meta.key, assignment: assignmentNext })
      .then(() => toast.success(`${meta.label} updated`))
      .catch((err) => toast.error(String(err.message ?? err)));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {meta.icon}
        <span className="text-sm font-bold">{meta.label}</span>
        <span className="group relative inline-flex">
          <Info className="w-3.5 h-3.5 text-on-surface-variant/60 cursor-help" />
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-container-highest text-xs text-on-surface p-3 rounded-xl shadow-xl z-20">
            {meta.tooltip}
          </span>
        </span>
      </div>

      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="w-full px-3 py-2 rounded-xl bg-surface-container-highest text-sm outline-none focus:ring-2 focus:ring-primary/40"
      >
        {meta.key !== "embeddings" && (
          <option value="auto">Auto (recommended)</option>
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

      {current.mode === "auto" && (
        <div className="text-xs text-on-surface-variant pl-1">
          {resolved ? (
            <>
              → resolves to <strong>{resolved.providerId}</strong>
              {resolved.model ? ` · ${resolved.model}` : ""}
            </>
          ) : (
            <span className="text-amber-600">
              → nothing available for this capability
            </span>
          )}
        </div>
      )}
      {meta.warning && current.mode !== "builtin" && (
        <div className="text-xs text-amber-600 pl-1 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          {meta.warning}
        </div>
      )}
    </div>
  );
};
