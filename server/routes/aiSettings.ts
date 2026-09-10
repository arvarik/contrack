// =============================================================================
// Routes — AI Settings (providers, capabilities, model discovery)
// =============================================================================
// Mounted at /api/settings/ai. Behind the auth gate like every other /api
// route. API keys are write-only: responses only ever carry a redacted
// preview (`••••1234`).
// =============================================================================

import { Router, type Request } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
import { requireAdmin } from "../middleware/auth.ts";
import { auditService } from "../services/auditService.ts";
import {
  getSettingsView,
  getModelsForCapability,
  setProviderKey,
  deleteProviderKey,
  setCapabilityAssignment,
  upsertCustomEndpoint,
  deleteCustomEndpoint,
  refreshModels,
} from "../services/aiSettingsService.ts";
import { setSetting, SETTING_KEYS } from "../services/settingsService.ts";
import { invalidateProviderCache } from "../ai/providerRegistry.ts";
import { ensureEmbeddingStore } from "../services/search/localEmbeddings.ts";
import { ensureDedupeEmbeddingStore } from "../services/dedupe/embeddings.ts";
import { probeDimension } from "../ai/embeddings.ts";
import { AppError } from "../utils/AppError.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import type { AICapability } from "../ai/capabilities.ts";

const router = Router();

// Reading this configuration is open to any signed-in account: the app has to
// know which capabilities are available before it offers them. Writing it is
// administration — provider keys, custom endpoints and capability
// assignments are one shared configuration that everybody on the instance
// runs on. Every write below carries `requireAdmin` and writes one
// `settings.changed` audit row naming the setting key, never its value.

/** Record a settings write. The key name only, never what was written. */
function auditSettingChange(
  req: Request,
  key: string,
  details?: Record<string, unknown>,
): void {
  auditService.record({
    actorUserId: req.principal?.user.id ?? null,
    action: "settings.changed",
    targetType: "setting",
    targetId: key,
    details,
    ip: req.ip ?? null,
  });
}

// ─── Overview ────────────────────────────────────────────────────────────────

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(getSettingsView());
  }),
);

/** Capability-eligible models, grouped by provider (for the dropdowns). */
router.get(
  "/models/:capability",
  asyncHandler(async (req, res) => {
    const capability = String(req.params.capability) as AICapability;
    res.json({ groups: getModelsForCapability(capability) });
  }),
);

// ─── Provider credentials ────────────────────────────────────────────────────

const providerKeySchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
});

/**
 * Store a key and immediately validate it by discovering models — the
 * response doubles as the "✓ N models" confirmation in the UI.
 */
router.put(
  "/providers/:id/key",
  requireAdmin,
  validateBody(providerKeySchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const id = String(req.params.id);
    setProviderKey(id, req.body.apiKey);
    auditSettingChange(req, SETTING_KEYS.aiProviderKeys, { provider: id });

    try {
      const entry = await refreshModels(id);
      log.info(
        "API",
        `[${rid}] PUT /api/settings/ai/providers/${id}/key → ${entry.models.length} models`,
      );
      res.json({ success: true, modelCount: entry.models.length });
    } catch (err) {
      // Keep the key (the user may be offline) but report the failure.
      log.warn("API", `[${rid}] Key stored for ${id} but discovery failed`);
      throw err;
    }
  }),
);

router.delete(
  "/providers/:id/key",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    deleteProviderKey(id);
    auditSettingChange(req, SETTING_KEYS.aiProviderKeys, {
      provider: id,
      removed: true,
    });
    res.json({ success: true });
  }),
);

router.post(
  "/providers/:id/refresh-models",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const entry = await refreshModels(id);
    auditSettingChange(req, SETTING_KEYS.aiModelCache, { provider: id });
    res.json({ modelCount: entry.models.length, fetchedAt: entry.fetchedAt });
  }),
);

// ─── Custom OpenAI-compatible endpoints ──────────────────────────────────────

const endpointSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/i, "Use letters, numbers, and hyphens only"),
  label: z.string().min(1),
  baseUrl: z.string().url(),
  apiKey: z.string().optional(),
});

router.put(
  "/endpoints",
  requireAdmin,
  validateBody(endpointSchema),
  asyncHandler(async (req, res) => {
    upsertCustomEndpoint(req.body);
    auditSettingChange(req, SETTING_KEYS.aiCustomEndpoints, {
      endpoint: req.body.id,
    });
    const providerId = `custom:${req.body.id}`;
    // Validate connectivity the same way built-in keys are validated.
    const entry = await refreshModels(providerId);
    res.json({ success: true, modelCount: entry.models.length });
  }),
);

router.delete(
  "/endpoints/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    deleteCustomEndpoint(id);
    auditSettingChange(req, SETTING_KEYS.aiCustomEndpoints, {
      endpoint: id,
      removed: true,
    });
    res.json({ success: true });
  }),
);

// ─── Capability assignments ──────────────────────────────────────────────────

const assignmentSchema = z.object({
  mode: z.enum(["auto", "pinned", "disabled"]),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

router.put(
  "/capabilities/:capability",
  requireAdmin,
  validateBody(assignmentSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const capability = String(req.params.capability) as AICapability;
    // An embeddings model is only usable if the endpoint really implements
    // /v1/embeddings. Compat servers advertise bare model ids, so capability is
    // guessed from the name — a model called "…-embed" on a server started
    // without embeddings support looks fine until it is probed. Probe first and
    // refuse the assignment, rather than saving a pin that quietly leaves the
    // vector store on the previous model.
    if (capability === "embeddings" && req.body.mode === "pinned") {
      const dimension = await probeDimension(
        String(req.body.providerId),
        String(req.body.model),
      );
      if (dimension === null) {
        throw new AppError(
          `${req.body.providerId} could not produce an embedding with "${req.body.model}". ` +
            `Check the model supports embeddings and the endpoint exposes /v1/embeddings.`,
          502,
          { code: "EMBEDDINGS_PROBE_FAILED" },
        );
      }
    }

    setCapabilityAssignment(capability, req.body);
    auditSettingChange(req, SETTING_KEYS.aiCapabilities, { capability });

    // Switching embedding models changes the vector width, so BOTH stores
    // have to be rebuilt — search and dedupe share one model. Reconciling only
    // search leaves contact_embeddings at the old width, and every subsequent
    // insert fails with "Expected 384 dimensions but received 1536" until the
    // process restarts. Runs in the background so the request returns at once.
    if (capability === "embeddings") {
      Promise.all([ensureEmbeddingStore(), ensureDedupeEmbeddingStore()])
        .then(([searchCount, dedupeCount]) => {
          if (searchCount > 0 || dedupeCount > 0)
            log.info(
              "AISettings",
              `Re-embedded ${searchCount} contacts for search, ${dedupeCount} for dedupe`,
            );
        })
        .catch((err) =>
          log.error("AISettings", `Re-index failed: ${getErrorMessage(err)}`),
        );
    }
    log.info(
      "API",
      `[${rid}] PUT capability ${capability} → ${req.body.mode}${
        req.body.model ? ` (${req.body.providerId}/${req.body.model})` : ""
      }`,
    );
    res.json({ success: true, view: getSettingsView() });
  }),
);

// ─── SearXNG (self-hosted research) ──────────────────────────────────────────

const searxngSchema = z.object({
  url: z.string().url().or(z.literal("")),
});

router.put(
  "/searxng",
  requireAdmin,
  validateBody(searxngSchema),
  asyncHandler(async (req, res) => {
    setSetting(SETTING_KEYS.aiSearxng, { url: req.body.url });
    auditSettingChange(req, SETTING_KEYS.aiSearxng);
    invalidateProviderCache();
    res.json({ success: true });
  }),
);

export const aiSettingsRouter = router;
