import React, { useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Check,
  AlertTriangle,
  Server,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAISettings,
  useSetProviderKey,
  useDeleteProviderKey,
  useRefreshModels,
  useSaveEndpoint,
  useDeleteEndpoint,
  useSetSearxng,
} from "../../api/aiSettings";
import { Modal } from "../../components/ui/Modal";
import { CapabilitiesCard } from "./CapabilitiesCard";
import { CARD, SECTION_HEADING, ICON_BTN } from "../../lib/styles";
import { cn } from "../../lib/utils";

// ---------------------------------------------------------------------------
// AISettingsView — capability-based AI configuration
// ---------------------------------------------------------------------------
// Two cards, in the order the work happens: connect credentials, then decide
// what each kind of AI work runs on. The second card is its own component —
// see CapabilitiesCard.
//
// Every capability defaults to Automatic, so someone who pastes one key and
// never opens this page gets sensible behavior with zero configuration.
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

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-3xl mx-auto pb-28 md:pb-10">
      {/* ── Providers ─────────────────────────────────────────────────── */}
      <section className={cn(CARD, "space-y-4 p-4 sm:p-6")}>
        <div>
          <h3 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <Server className="w-5 h-5 text-primary" />
            Providers
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 text-pretty">
            Add the services you have keys for. Keys are stored in this app's
            local database and only ever sent to the provider they belong to.
          </p>
        </div>

        <div className="space-y-2">
          {settings.providers.map((provider) => (
            <div
              key={provider.id}
              className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-surface-container-low"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                  {provider.label}
                  {provider.source === "env" && (
                    <span className="text-[9px] uppercase tracking-wider bg-surface-container-highest px-1.5 py-0.5 rounded font-bold text-on-surface-variant">
                      from .env
                    </span>
                  )}
                  {/* Grounding support is a real capability difference between
                      providers, and it decides whether this one can appear in
                      the web-research list at all. */}
                  {provider.supportsGrounding && (
                    <span className="text-[9px] uppercase tracking-wider bg-sky-500/10 text-info px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                      <Globe className="w-2.5 h-2.5" />
                      web search
                    </span>
                  )}
                </div>
                <div className="text-xs text-on-surface-variant flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="font-mono">{provider.keyPreview}</span>
                  {provider.modelCount !== null ? (
                    <span className="text-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      {provider.modelCount} models
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">
                      not yet discovered
                    </span>
                  )}
                  {provider.modelsError && (
                    <span
                      className="text-error flex items-center gap-1"
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
                  className={cn(ICON_BTN, "text-error")}
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
              <Plus className="w-4 h-4 text-on-surface-variant shrink-0" />
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
                className={cn(ICON_BTN, "text-error")}
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
            <Plus className="w-4 h-4 text-on-surface-variant shrink-0" />
            <span className="text-sm text-on-surface-variant">
              Add an OpenAI-compatible endpoint
            </span>
          </button>
        </div>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────────── */}
      <CapabilitiesCard settings={settings} />

      {/* ── SearXNG ───────────────────────────────────────────────────── */}
      {/* Its own card rather than a footnote inside Capabilities: it is a
          separate piece of infrastructure the user runs, not a model pick. */}
      <section className={cn(CARD, "space-y-3 p-4 sm:p-6")}>
        <div>
          <h3 className={cn(SECTION_HEADING, "flex items-center gap-2")}>
            <Globe className="w-5 h-5 text-primary" />
            Self-hosted search (SearXNG)
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 text-pretty">
            A fallback for web research that needs no cloud provider. Point
            Contrack at your own SearXNG instance and it will be used
            automatically whenever no connected provider offers web search.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {/* The control is nested in its label so the association holds
              without depending on id resolution. */}
          <label htmlFor="searxng-url" className="flex-1 min-w-0">
            <span className="sr-only">SearXNG base URL</span>
            <input
              id="searxng-url"
              type="url"
              aria-label="SearXNG base URL"
              value={searxngInput ?? settings.searxngUrl ?? ""}
              onChange={(e) => setSearxngInput(e.target.value)}
              placeholder="http://searxng.local:8080"
              className="w-full px-3 py-2.5 rounded-xl bg-surface-container-highest text-sm font-mono outline-none focus:ring-2 focus:ring-primary/40"
            />
          </label>
          <button
            onClick={() =>
              setSearxng
                .mutateAsync(searxngInput ?? "")
                .then(() => {
                  setSearxngInput(null);
                  toast.success("SearXNG endpoint saved");
                })
                .catch((e) => toast.error(String(e.message ?? e)))
            }
            disabled={searxngInput === null}
            className="px-4 py-2.5 rounded-xl text-sm font-bold bg-surface-container-high hover:bg-surface-container-highest transition-colors shrink-0 disabled:text-on-surface-variant disabled:cursor-not-allowed"
          >
            Save
          </button>
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
              className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none disabled:cursor-not-allowed"
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
              className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-on-primary hover:opacity-90 transition-opacity disabled:bg-surface-container-high disabled:text-on-surface-variant disabled:shadow-none disabled:cursor-not-allowed"
            >
              {saveEndpoint.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
