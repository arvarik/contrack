import {
  enrichmentContact,
  lockEnrichment,
} from "../services/aiSearch/contactSnapshot.ts";
import { withTimeout } from "../ai/resilience.ts";
import { validateEnrichmentStrategy } from "../services/aiSearch/strategies/index.ts";
import { requireContact } from "../services/contactGuard.ts";
import { idsSchema } from "../utils/validators.ts";
import { Router } from "express";
import multer from "multer";
import { ensureDir, ownerUploadDir } from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { contactService } from "../services/contactService.ts";
import { relationshipService } from "../services/relationshipService.ts";
import { parseContactRecord } from "../ai/aiService.ts";
import {
  validateBody,
  contactCreateSchema,
  contactUpdateSchema,
  contactBulkCreateSchema,
} from "../utils/validators.ts";
import { z } from "zod";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { providerIdFor } from "../ai/gateway.ts";
import { getStrategy } from "../services/aiSearch/strategies/index.ts";
import {
  buildSearchPrompt,
  type AISearchOutput,
} from "../services/aiSearch/promptTemplate.ts";
import { mergeSearchResult } from "../services/aiSearch/mergeEngine.ts";
import {
  generateAndStoreBulkEmbeddings,
  isEmbeddingAvailable,
} from "../services/dedupe/embeddings.ts";
import { dedupeService } from "../services/dedupe/index.ts";
import {
  contactRepo,
  RELATION_REGISTRY,
} from "../repositories/contactRepository.ts";

// Avatars go to uploads/u/<ownerId>/avatars/ now, so there is no one directory
// to create at import time. The destination callback creates the caller's.

// Raster image types only. SVG is deliberately excluded — it can carry
// scripts and is served from the app origin. The extension is derived from
// the MIME type, never from the client-supplied filename.
const AVATAR_MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

const avatarStorage = multer.diskStorage({
  // The owner comes off req.principal, not the async context. multer hands
  // this callback the request, so it is the shortest path to the answer and
  // it cannot be broken by a stream boundary the context does not cross.
  destination: (req, _file, cb) => {
    const owner = req.principal?.user.id;
    if (!owner) return cb(new Error("No principal for an avatar upload"), "");
    const dir = ownerUploadDir(owner, "avatars");
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = AVATAR_MIME_EXTENSIONS[file.mimetype] ?? ".jpg";
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap for avatars
  fileFilter: (_req, file, cb) => {
    if (file.mimetype in AVATAR_MIME_EXTENSIONS) return cb(null, true);
    cb(new Error("Only JPEG, PNG, GIF, WebP, or AVIF images are allowed"));
  },
});

/**
 * How long the non-stream import waits before its dedupe sweep.
 *
 * Long enough for the inserts and the embedding pass to settle, and named so a
 * test can shorten it. Three seconds of real waiting in the suite proves
 * nothing that fifty milliseconds does not.
 */
const IMPORT_SETTLE_MS = Number(process.env.IMPORT_SETTLE_MS ?? 3000);

const router = Router();

router.get(
  "/contacts/map",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const results = contactService.getMapContacts(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
    res.json(results);
  }),
);

router.get(
  "/contacts/archived",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const results = contactService.getArchivedContacts(scopeOf(req));
    log.debug("API", `[${rid}] GET /api/contacts/archived → ${results.length}`);
    res.json(results);
  }),
);

router.get(
  "/contacts",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const scope = scopeOf(req);
    const view = req.query.view as string;

    if (view === "slim") {
      const results = contactService.getSlimContacts(scope);
      log.debug(
        "API",
        `[${rid}] GET /api/contacts?view=slim → ${results.length} (slim)`,
      );
      return res.json(results);
    }

    const results = contactService.getAllContacts(scope);
    log.debug("API", `[${rid}] GET /api/contacts → ${results.length}`);
    res.json(results);
  }),
);

router.get(
  "/contacts/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const contact = contactService.getContactById(
      scopeOf(req),
      String(req.params.id),
    );
    if (!contact) {
      log.warn("API", `[${rid}] 404 ${String(req.params.id)}`);
      throw new NotFoundError("Contact");
    }
    res.json(contact);
  }),
);

/**
 * Why a contact scores what it scores.
 *
 * Separate from the contact payload rather than folded into it: computing the
 * breakdown runs an aggregate query per contact, which is fine on demand for
 * one contact and wasteful on a list of four hundred.
 */
router.get(
  "/contacts/:id/score",
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    // The owner check happens here, so explainScore keeps taking an id alone.
    // It reads and writes `contacts` by that id, which is safe only because
    // this line ran first.
    contactRepo.requireOwned(scopeOf(req), id);
    const breakdown = relationshipService.explainScore(id);
    if (!breakdown) throw new NotFoundError("Contact");
    res.json(breakdown);
  }),
);

router.post(
  "/contacts",
  validateBody(contactCreateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    if (!req.body.name) throw new AppError("Name is required", 400);

    const contact = contactService.createContact(scopeOf(req), req.body);
    log.info(
      "API",
      `[${rid}] POST /api/contacts → "${req.body.name}" (${contact?.id})`,
    );
    res.status(201).json(contact);
  }),
);

router.post(
  "/contacts/bulk",
  validateBody(contactBulkCreateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    // Captured once, before the SSE stream starts and before any background
    // work is scheduled. A handler that reads the context after the response
    // has been written is reading whatever async context it happens to be in.
    const scope = scopeOf(req);
    const wantsStream = req.headers.accept?.includes("text/event-stream");

    if (wantsStream) {
      // =====================================================================
      // SSE Multi-Phase Import Pipeline
      // Phase 1: Import contacts
      // Phase 2: Generate embeddings (if available)
      // Phase 3: Run dedupe scan against imported contacts
      // Phase 4: Stream results summary
      // =====================================================================
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const send = (data: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Phase 1: Import
      const { count, createdIds } = await contactService.bulkCreateContacts(
        scope,
        req.body,
        (processed, total, phase) => {
          send({ phase: "importing", processed, total, message: phase });
        },
      );

      log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);

      // Phase 2: Generate embeddings for imported contacts
      if (createdIds.length > 0 && isEmbeddingAvailable()) {
        send({
          phase: "embedding",
          message: "Generating contact fingerprints…",
        });
        try {
          await generateAndStoreBulkEmbeddings(createdIds);
          log.info(
            "API",
            `[${rid}] Bulk embeddings generated for ${createdIds.length} contacts`,
          );
        } catch (err: unknown) {
          log.warn(
            "API",
            `[${rid}] Bulk embedding failed: ${getErrorMessage(err)}`,
          );
        }
      }

      // Phase 3: Dedupe scan against the imported contacts
      //
      // This used to be about two hundred and fifty lines of matching written
      // out here, which found exact names, emails and phone numbers and
      // nothing else. The JSON branch below ran a different and stronger
      // check on the same contacts, so what counted as a duplicate depended
      // on whether the client had asked for a stream. Both branches now call
      // the same scan.
      let autoMerged = 0;
      let needsReview = 0;
      let matchedImportIds = new Set<string>();

      if (createdIds.length >= 1) {
        send({ phase: "scanning", message: "Looking for duplicates…" });

        try {
          const result = await dedupeService.runImportScan(
            scope,
            createdIds,
            rid,
            {
              onProgress: (checked, total) => {
                if (checked % 50 === 0 && checked < total) {
                  send({
                    phase: "scanning",
                    message: `Checked ${checked}/${total} contacts…`,
                    autoMerged,
                    needsReview,
                  });
                }
              },
            },
          );
          autoMerged = result.autoMerged;
          needsReview = result.pending;
          matchedImportIds = result.matchedIds;

          log.info(
            "API",
            `[${rid}] Post-import dedupe: ${autoMerged} auto-merged, ${needsReview} pending, ${matchedImportIds.size}/${createdIds.length} contacts had matches`,
          );
        } catch (err: unknown) {
          log.warn(
            "API",
            `[${rid}] Post-import dedupe failed: ${getErrorMessage(err)}`,
          );
        }
      }

      // Phase 4: Complete — send summary
      // newUnique = imported contacts that had NO matches at all
      const newUnique = count - matchedImportIds.size;
      send({
        done: true,
        count,
        summary: {
          imported: count,
          autoMerged,
          needsReview,
          newUnique: Math.max(0, newUnique),
        },
      });
      res.end();
    } else {
      // Standard JSON mode — for small imports or non-streaming clients
      const { count, createdIds } = await contactService.bulkCreateContacts(
        scope,
        req.body,
      );
      log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);

      // Generate embeddings + schedule incremental dedupe for each contact.
      //
      // Both outlive the response, and the second waits out the settle delay
      // before it starts. AsyncLocalStorage does carry the request's scope
      // through a timer, so this ran attributed before the wrapper as well as
      // after it. The wrapper makes the owner an argument rather than an
      // inheritance: the day this work moves behind a queue, the context it
      // runs in belongs to whoever drained the queue.
      if (createdIds.length > 0) {
        runWithContext(
          { requestId: `imp-${rid}`, principal: null, scope },
          () => {
            generateAndStoreBulkEmbeddings(createdIds).catch((err) =>
              log.warn(
                "API",
                `Background bulk embedding failed: ${getErrorMessage(err)}`,
              ),
            );
            // One scan for the whole import, not one check per contact.
            //
            // The loop that was here called `incrementalDedupeCheck` once per
            // created contact, and every one of those normalized the account's
            // whole corpus and built a pass context of its own. Importing `n`
            // contacts into a corpus of `m` cost about `n × m`, nearly all of
            // it the same work done again. `runImportScan` builds the corpus
            // once and matches every new contact against that.
            void (async () => {
              // Let bulk inserts and embedding tasks settle first.
              await new Promise((resolve) =>
                setTimeout(resolve, IMPORT_SETTLE_MS),
              );
              await dedupeService.runImportScan(
                scope,
                createdIds,
                `imp-${rid}`,
              );
            })().catch((err) =>
              log.error(
                "API",
                `Bulk background dedupe scan crashed: ${getErrorMessage(err)}`,
              ),
            );
          },
        );
      }
      res.status(201).json({ success: true, count });
    }
  }),
);

router.post(
  "/parse-contact",
  validateBody(z.object({ text: z.string().min(1, "text is required") })),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const { text } = req.body;
    const parsed = await parseContactRecord(text);
    log.info(
      "API",
      `[${rid}] POST /api/parse-contact → parsed "${parsed.name}"`,
    );
    res.json(parsed);
  }),
);

router.post(
  "/contacts/bulk-delete",
  validateBody(z.object({ ids: idsSchema })),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const count = contactService.bulkDeleteContacts(scopeOf(req), req.body.ids);
    log.info(
      "API",
      `[${rid}] POST /api/contacts/bulk-delete → ${count} deleted`,
    );
    res.json({ success: true, count });
  }),
);

router.put(
  "/contacts/bulk-update",
  validateBody(
    z.object({
      ids: idsSchema,
      data: contactUpdateSchema.refine(
        (data) => !Object.keys(RELATION_REGISTRY).some((key) => key in data),
        {
          message:
            "Bulk edits support profile fields only. Edit contact details on each contact.",
        },
      ),
    }),
  ),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const count = contactService.bulkUpdateContacts(
      scopeOf(req),
      req.body.ids,
      req.body.data,
    );
    log.info(
      "API",
      `[${rid}] PUT /api/contacts/bulk-update → ${count} updated`,
    );
    res.json({ success: true, count });
  }),
);

router.put(
  "/contacts/:id",
  validateBody(contactUpdateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const updated = contactService.updateContact(
      scopeOf(req),
      String(req.params.id),
      req.body,
    );
    if (!updated) throw new NotFoundError("Contact");
    log.info(
      "API",
      `[${rid}] PUT /api/contacts/${String(req.params.id)} → updated`,
    );
    res.json(updated);
  }),
);

router.patch(
  "/contacts/:id",
  validateBody(contactUpdateSchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const childKeys = [
      "emails",
      "phones",
      "socialLinks",
      "tags",
      "interests",
      "addresses",
      "attributes",
      "education",
      "experience",
      "sources",
    ];
    const hasChildArrays = childKeys.some((k) => req.body[k] !== undefined);
    if (hasChildArrays) {
      throw new AppError(
        "PATCH does not support child arrays. Use PUT for full updates.",
        400,
      );
    }

    const updated = contactService.patchContact(
      scopeOf(req),
      String(req.params.id),
      req.body,
    );
    if (!updated) throw new NotFoundError("Contact");
    log.info(
      "API",
      `[${rid}] PATCH /api/contacts/${String(req.params.id)} → updated (scalar)`,
    );
    res.json(updated);
  }),
);

router.delete(
  "/contacts/:id",
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const success = contactService.deleteContact(
      scopeOf(req),
      String(req.params.id),
    );
    if (!success) throw new NotFoundError("Contact");
    log.info("API", `[${rid}] DELETE /api/contacts/${String(req.params.id)}`);
    res.json({ success: true });
  }),
);

router.post(
  "/contacts/:id/avatar",
  requireContact,
  uploadAvatar.single("avatar"),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    if (!req.file) throw new AppError("No image file provided", 400);

    const updated = contactService.updateAvatar(
      scopeOf(req),
      String(req.params.id),
      req.file.filename,
    );
    if (!updated) throw new NotFoundError("Contact");

    log.info(
      "API",
      `[${rid}] POST /api/contacts/${String(req.params.id)}/avatar → uploaded`,
    );
    res.json(updated);
  }),
);

/**
 * POST /api/contacts/:id/enrich
 *
 * Single-contact enrichment using the TwoPassStrategy (grounding-based web research).
 * Reuses the same pipeline as batch AI Search but for an individual contact.
 *
 * Quota-aware: Returns 429 if grounding RPD is exhausted.
 * Returns 503 if AI provider is not configured.
 */
router.post(
  "/contacts/:id/enrich",
  requireContact,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const id = String(req.params.id);
    const scope = scopeOf(req);
    // requireContact above already checked the owner. This repeats it against
    // the repository so the check is visible at the call that spends money.
    contactRepo.requireOwned(scope, id);

    const strategyName = validateEnrichmentStrategy();
    const contact = enrichmentContact(scope, id);
    const release = lockEnrichment(id);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    try {
      const startMs = Date.now();
      // F-02: Use provider-aware strategy instead of hardcoded 'two-pass'
      // Strategy follows whichever provider serves the *research* capability,
      // not the legacy default provider.
      const researchProvider = providerIdFor("research");
      const strategy = getStrategy(strategyName);
      const prompt = buildSearchPrompt(contact);

      log.info(
        "API",
        `[${rid}] POST /api/contacts/${id}/enrich — starting ${strategyName} for "${contact.name}" (provider: ${researchProvider ?? "none"})`,
      );

      const result = await withTimeout(
        (signal) => strategy.execute(contact, prompt, signal),
        90_000,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const fieldsUpdated = mergeSearchResult(
        scope,
        id,
        contact,
        result.data as AISearchOutput,
        result.citations,
      );
      const latencyMs = Date.now() - startMs;

      log.info(
        "API",
        `[${rid}] POST /api/contacts/${id}/enrich — ${fieldsUpdated} field(s) merged in ${latencyMs}ms`,
      );

      res.json({
        success: true,
        fieldsUpdated,
        latencyMs,
        models: result.models,
        tokenCount: result.tokenCount,
      });
    } finally {
      release();
      res.off("close", onClose);
    }
  }),
);

export const contactsRouter = router;
