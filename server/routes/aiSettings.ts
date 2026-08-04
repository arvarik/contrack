// =============================================================================
// Routes — AI Settings (providers, capabilities, model discovery)
// =============================================================================
// Mounted at /api/settings/ai. Behind the auth gate like every other /api
// route. API keys are write-only: responses only ever carry a redacted
// preview (`••••1234`).
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { validateBody } from "../utils/validators.ts";
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
import { getErrorMessage } from "../utils/helpers.ts";
import type { AICapability } from "../ai/capabilities.ts";

const router = Router();

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
  validateBody(providerKeySchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const id = String(req.params.id);
    setProviderKey(id, req.body.apiKey);

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
  asyncHandler(async (req, res) => {
    deleteProviderKey(String(req.params.id));
    res.json({ success: true });
  }),
);

router.post(
  "/providers/:id/refresh-models",
  asyncHandler(async (req, res) => {
    const entry = await refreshModels(String(req.params.id));
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
  validateBody(endpointSchema),
  asyncHandler(async (req, res) => {
    upsertCustomEndpoint(req.body);
    const providerId = `custom:${req.body.id}`;
    // Validate connectivity the same way built-in keys are validated.
    const entry = await refreshModels(providerId);
    res.json({ success: true, modelCount: entry.models.length });
  }),
);

router.delete(
  "/endpoints/:id",
  asyncHandler(async (req, res) => {
    deleteCustomEndpoint(String(req.params.id));
    res.json({ success: true });
  }),
);

// ─── Capability assignments ──────────────────────────────────────────────────

const assignmentSchema = z.object({
  mode: z.enum(["auto", "pinned", "builtin", "disabled"]),
  providerId: z.string().optional(),
  model: z.string().optional(),
});

router.put(
  "/capabilities/:capability",
  validateBody(assignmentSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const capability = String(req.params.capability) as AICapability;
    setCapabilityAssignment(capability, req.body);

    // Switching embedding models changes the vector width — rebuild and
    // re-embed in the background so the request returns immediately.
    if (capability === "embeddings") {
      ensureEmbeddingStore()
        .then((count) => {
          if (count > 0)
            log.info("AISettings", `Re-embedded ${count} contacts`);
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
  validateBody(searxngSchema),
  asyncHandler(async (req, res) => {
    setSetting(SETTING_KEYS.aiSearxng, { url: req.body.url });
    invalidateProviderCache();
    res.json({ success: true });
  }),
);

export const aiSettingsRouter = router;
