/**
 * ProvidersSection: the services Contrack's AI runs on, on Administration →
 * AI.
 *
 * Two kinds, in two lists: the hosted providers (Gemini, OpenAI,
 * Anthropic), each by its key, and OpenAI-compatible servers (Ollama, vLLM,
 * LM Studio, OpenRouter…), each by its address. A key set in the
 * environment says which variable set it, and cannot be removed here.
 *
 * A custom endpoint is a provider on the server, so it arrives in both
 * lists. Rendering both listed it twice, and the second row carried a
 * "remove key" button that deletes from the provider-key store, where a
 * custom endpoint has no entry, so it reported success and removed nothing.
 * The servers list owns them, discovery status included.
 *
 * @module views/ai-settings/ProvidersSection
 */
import { useState } from "react";
import {
  Plus,
  RefreshCw,
  Trash2,
  Check,
  AlertTriangle,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import {
  useSetProviderKey,
  useDeleteProviderKey,
  useRefreshModels,
  useSaveEndpoint,
  useDeleteEndpoint,
  type AISettings,
} from "../../api/aiSettings";
import { Modal } from "../../components/ui/Modal";
import { useHashTarget } from "../settings/SettingRow";
import { ICON_BTN, LABEL } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { SETTINGS_CARD, SETTINGS_SECTION_HEADING } from "../settings/layout";

/**
 * "Add a key" and "Add a server": a flat row in the primary with the state
 * layer, under the connected rows on the wash, so an empty slot never reads
 * as one that is filled.
 */
const ADD_ROW =
  "state-layer w-full min-h-[44px] sm:min-h-0 flex items-center gap-3 py-2.5 px-3 rounded-xl text-left text-sm font-semibold text-primary";

export function ProvidersSection({ settings }: { settings: AISettings }) {
  const { ref, flashing } = useHashTarget<HTMLDivElement>("providers");
  const { ref: serversRef, flashing: serversFlashing } =
    useHashTarget<HTMLDivElement>("openai-compatible");
  const setKey = useSetProviderKey();
  const deleteKey = useDeleteProviderKey();
  const refreshModels = useRefreshModels();
  const saveEndpoint = useSaveEndpoint();
  const deleteEndpoint = useDeleteEndpoint();

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

  const builtInProviders = settings.providers.filter(
    (provider) => provider.kind !== "openai-compatible",
  );
  const endpointStatus = (id: string) =>
    settings.providers.find((provider) => provider.id === `custom:${id}`);

  const handleSaveKey = async () => {
    if (!keyModalProvider || !keyInput.trim()) return;
    try {
      const result = await setKey.mutateAsync({
        providerId: keyModalProvider.id,
        apiKey: keyInput.trim(),
      });
      toast.success(
        `${keyModalProvider.label} connected. It has ${result.modelCount} models`,
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
      toast.success(`Server connected. It has ${result.modelCount} models`);
      setEndpointModalOpen(false);
      setEndpointForm({ id: "", label: "", baseUrl: "", apiKey: "" });
    } catch (err) {
      toast.error(
        `Could not reach the server: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <>
      <section aria-labelledby="providers-heading">
        <h2 id="providers-heading" className={SETTINGS_SECTION_HEADING}>
          Providers
        </h2>
        <div
          id="providers"
          ref={ref}
          tabIndex={-1}
          className={cn(
            SETTINGS_CARD,
            "space-y-4 scroll-mt-20 outline-none transition-colors duration-(--dur-slow)",
            flashing && "flash bg-primary/10",
          )}
        >
          <p className="text-sm text-on-surface-variant text-pretty">
            Keys stay in this server's database, and each one goes only to its
            own provider
          </p>

          <div className="space-y-2">
            {builtInProviders.map((provider) => (
              <div
                key={provider.id}
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-surface-container-low"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm flex items-center gap-2 flex-wrap">
                    {provider.label}
                    {provider.source === "env" && (
                      <span className="text-[11px] tracking-[0.02em] bg-surface-container-highest px-1.5 py-0.5 rounded font-semibold text-on-surface-variant">
                        Set by{" "}
                        <code className="font-mono">
                          {provider.envVariable ?? "the environment"}
                        </code>
                      </span>
                    )}
                    {/* Grounding support is a real capability difference between
                      providers, and it decides whether this one can appear in
                      the web-research list at all. */}
                    {provider.supportsGrounding && (
                      <span className="text-[11px] uppercase tracking-[0.08em] bg-info/10 text-info px-1.5 py-0.5 rounded font-bold flex items-center gap-1">
                        <Globe className="w-2.5 h-2.5" />
                        Web search
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
                        Models not listed yet
                      </span>
                    )}
                    {provider.modelsError && (
                      <span
                        className="text-error flex items-center gap-1"
                        title={provider.modelsError}
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Refresh failed
                      </span>
                    )}
                  </div>
                  {/* Only Google says a key is on its free tier, and only in
                    a quota error, so this appears after the first one. */}
                  {provider.freeTier && (
                    <p className="text-xs text-warning flex items-start gap-1.5 mt-1 text-pretty">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      This key is on Google's free tier. Google may use prompts
                      and responses, contacts' details included, to improve its
                      products. A key from a project with billing keeps them out
                    </p>
                  )}
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
                    title="Refresh the model list"
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
                className={ADD_ROW}
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                Add {provider.label} key
              </button>
            ))}
          </div>

          {/* OpenAI-compatible servers */}
          <div
            id="openai-compatible"
            ref={serversRef}
            tabIndex={-1}
            className={cn(
              "pt-2 space-y-2 scroll-mt-20 outline-none rounded-xl transition-colors duration-(--dur-slow)",
              serversFlashing && "flash bg-primary/10",
            )}
          >
            <div className={LABEL}>
              OpenAI-compatible servers (Ollama, vLLM, LM Studio, OpenRouter…)
            </div>
            {settings.customEndpoints.map((endpoint) => {
              const status = endpointStatus(endpoint.id);
              return (
                <div
                  key={endpoint.id}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-surface-container-low"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm">{endpoint.label}</div>
                    <div className="text-xs text-on-surface-variant font-mono truncate">
                      {endpoint.baseUrl}
                    </div>
                    {/* Discovery status decides whether this endpoint can serve
                      anything at all: with no models found there is nothing to
                      call, so saying "connected" alone would be misleading. */}
                    <div className="text-xs flex items-center gap-2 mt-0.5 flex-wrap">
                      {status?.modelCount ? (
                        <span className="text-success flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          {status.modelCount} models
                        </span>
                      ) : (
                        <span className="text-warning flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          No models found. Refresh to try again
                        </span>
                      )}
                      {status?.modelsError && (
                        <span
                          className="text-error truncate"
                          title={status.modelsError}
                        >
                          {status.modelsError}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      refreshModels
                        .mutateAsync(`custom:${endpoint.id}`)
                        .then((r) => toast.success(`${r.modelCount} models`))
                        .catch((e) => toast.error(String(e.message ?? e)))
                    }
                    disabled={refreshModels.isPending}
                    className={ICON_BTN}
                    title="Refresh the model list"
                    aria-label={`Refresh models for ${endpoint.label}`}
                  >
                    <RefreshCw
                      className={cn(
                        "w-4 h-4",
                        refreshModels.isPending && "animate-spin",
                      )}
                    />
                  </button>
                  <button
                    onClick={() =>
                      deleteEndpoint
                        .mutateAsync(endpoint.id)
                        .then(() => toast.success("Server removed"))
                    }
                    className={cn(ICON_BTN, "text-error")}
                    title="Remove server"
                    aria-label={`Remove ${endpoint.label}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => setEndpointModalOpen(true)}
              className={ADD_ROW}
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              Add an OpenAI-compatible server
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
            your machine except to call {keyModalProvider?.label}
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
            className="w-full px-4 py-3 rounded-xl bg-surface-container-highest text-sm font-mono"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setKeyModalProvider(null)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveKey}
              disabled={!keyInput.trim() || setKey.isPending}
              className="btn-primary"
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
        title="Add an OpenAI-compatible server"
      >
        <div className="space-y-3">
          <p className="text-sm text-on-surface-variant">
            Works with Ollama, vLLM, LM Studio, llama.cpp, OpenRouter, xAI,
            DeepSeek and Mistral: any server that speaks the OpenAI API
          </p>
          {/* The two mistakes that make a working server look broken. Both
              produce the same "could not reach endpoint" error, and neither is
              guessable from it. */}
          <ul className="text-xs text-on-surface-variant bg-surface-container-low rounded-lg px-3 py-2 space-y-1 list-disc list-inside">
            <li>
              End the URL with <code className="font-mono">/v1</code> — Ollama
              serves its OpenAI API at{" "}
              <code className="font-mono">:11434/v1</code>, not at the root
            </li>
            <li>
              Running Contrack in Docker?{" "}
              <code className="font-mono">localhost</code> means the container.
              Use <code className="font-mono">host.docker.internal</code> or the
              machine&rsquo;s LAN address to reach a server on your host
            </li>
          </ul>
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
                className="w-full mt-1 min-h-[44px] sm:min-h-0 px-3 py-2 rounded-xl bg-surface-container-highest text-sm font-mono"
              />
            </label>
          ))}
          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => setEndpointModalOpen(false)}
              className="btn-secondary"
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
              className="btn-primary"
            >
              {saveEndpoint.isPending ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
