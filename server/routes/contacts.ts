import {
  enrichmentContact,
  lockEnrichment,
} from "../services/aiSearch/contactSnapshot.ts";
import { getPreferences } from "../services/userPreferencesService.ts";
import { requireContact } from "../services/contactGuard.ts";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import {
  ensureDir,
  ownerUploadDir,
  resolveOwnUploadPath,
} from "../utils/paths.ts";
import { log } from "../utils/logger.ts";
import { getErrorMessage } from "../utils/helpers.ts";
import { contactService } from "../services/contactService.ts";
import { trashRetentionDays } from "../services/lifecycleSettings.ts";
import { relationshipService } from "../services/relationshipService.ts";
import { parseContactRecord } from "../ai/aiService.ts";
import { parseQuery, validateBody } from "../utils/validators.ts";
import { contactRoutes } from "../../shared/contracts/contacts.ts";
import { z } from "zod";
import { AppError, NotFoundError, ValidationError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { startStream } from "../utils/stream.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { importService, type ImportRecord } from "../services/importService.ts";
import { generateAndStoreBulkEmbeddings } from "../services/dedupe/embeddings.ts";
import { importIdSchema } from "./imports.ts";
import type { NewContactPayload } from "../repositories/types.ts";
import { providerIdFor } from "../ai/gateway.ts";
import {
  mergeSearchResult,
  researchHistory,
} from "../services/aiSearch/mergeEngine.ts";
import {
  chooseResearch,
  research,
  researchChoiceSchema,
  RESEARCH_TIMEOUT_MS,
  toAISearchResult,
} from "../services/research/index.ts";
import {
  DEFAULT_RESEARCH_DEPTH,
  researchDepthSchema,
  type ResearchDepth,
} from "../../shared/researchDepth.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { AVATAR_MIME_EXTENSIONS } from "../utils/avatarProcessor.ts";

// Avatars go to uploads/u/<ownerId>/avatars/ now, so there is no one directory
// to create at import time. The destination callback creates the caller's.

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
    cb(
      new ValidationError(
        "Only JPEG, PNG, GIF, WebP, or AVIF images are allowed",
      ),
    );
  },
});

/**
 * Refuse an `avatarUrl` under `/uploads/` that is outside the caller's own
 * folder, `uploads/u/<ownerId>/`.
 *
 * The client writes `avatarUrl` for a picked face or a photo on the web. A
 * value under `/uploads/` names a file on this server, though, and the code
 * that replaces a contact's photo deletes the old one. Another account's
 * file, a shared logo, and a `..` path out of the folder are refused here,
 * and `updateAvatar` deletes only from the owner's own avatars folder.
 *
 * After `validateBody`, so the body has its contract's shape: one contact,
 * an array of them for an import, or `{ ids, data }` for a bulk edit.
 */
function refuseForeignUploads(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const ownerId = scopeOf(req).ownerId;
  const body = req.body as { data?: unknown };
  const rows = (Array.isArray(body) ? body : [body.data ?? body]) as {
    avatarUrl?: string | null;
  }[];
  const foreign = rows.findIndex(
    ({ avatarUrl }) =>
      typeof avatarUrl === "string" &&
      avatarUrl.startsWith("/uploads/") &&
      resolveOwnUploadPath(ownerId, avatarUrl) === null,
  );
  if (foreign === -1) return next();
  const row = Array.isArray(body) ? `Contact ${foreign + 1}: ` : "";
  next(
    new ValidationError(
      `${row}avatarUrl names a file outside your own uploads. Upload the photo instead.`,
    ),
  );
}

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
    const { view } = parseQuery(contactRoutes.list.query, req.query);

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
    // Only a tracked contact has a score. The client never asks for an
    // untracked one, so this answer is for a script or a stale tab.
    if (!breakdown)
      throw new AppError(
        "This contact is not tracked, so it has no score.",
        404,
        {
          code: "NOT_TRACKED",
          details: { entity: "Contact", id },
        },
      );
    res.json(breakdown);
  }),
);

router.post(
  "/contacts",
  validateBody(contactRoutes.create.body),
  refuseForeignUploads,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    if (!req.body.name) throw new AppError("Name is required", 400);

    // A person adding a contact is the one case "Enrich new contacts
    // automatically" covers.
    const contact = contactService.createContact(
      scopeOf(req),
      req.body,
      "manual",
      { autoEnrich: true },
    );
    log.info(
      "API",
      `[${rid}] POST /api/contacts → "${req.body.name}" (${contact?.id})`,
    );
    res.status(201).json(contact);
  }),
);

/**
 * The import id a request carries, or a fresh one.
 *
 * The browser makes the id when a file is chosen and sends it in
 * `X-Import-Id`, so a second request for the same file is recognised as the
 * same import. A caller that sends none gets one made here and returned, and
 * its import is recorded the same way.
 */
function importIdOf(req: Request): string {
  const header = req.get("x-import-id");
  if (header === undefined || header === "") return importService.newId();
  const parsed = importIdSchema.safeParse(header);
  if (!parsed.success) {
    throw new ValidationError("X-Import-Id must be a UUID");
  }
  return parsed.data;
}

/** The terminal frame of a streamed import. */
function doneFrame(record: ImportRecord, repeated: boolean) {
  return {
    done: true,
    importId: record.id,
    repeated,
    status: record.status,
    count: record.imported,
    failed: record.failed,
    summary: record.summary,
  };
}

router.post(
  "/contacts/bulk",
  validateBody(contactRoutes.bulkCreate.body),
  refuseForeignUploads,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    // Captured once, before the SSE stream starts and before any background
    // work is scheduled. A handler that reads the context after the response
    // has been written is reading whatever async context it happens to be in.
    const scope = scopeOf(req);
    const wantsStream = req.headers.accept?.includes("text/event-stream");
    const contacts = req.body as NewContactPayload[];
    const importId = importIdOf(req);

    // The record first. A known id is answered from the record and nothing
    // is written again, which is what makes a retry after a dropped
    // connection safe. A run this process is still on answers 409.
    const { record, repeated } = importService.begin(
      scope,
      importId,
      contacts.length,
      "Importing contacts…",
    );
    if (repeated) {
      log.info(
        "API",
        `[${rid}] POST /api/contacts/bulk → import ${importId} already ${record.status}, nothing written`,
      );
    }

    if (wantsStream) {
      // =====================================================================
      // SSE Multi-Phase Import Pipeline
      // Phase 1: Import contacts
      // Phase 2: Generate embeddings (if available)
      // Phase 3: Run dedupe scan against imported contacts
      // Phase 4: Stream results summary
      // =====================================================================
      startStream(res, "text/event-stream");

      const send = (data: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // The id, before anything else. A stream that dies after this frame
      // still leaves the browser with what it needs to ask what happened.
      send({ phase: "accepted", importId });

      if (repeated) {
        send(doneFrame(record, true));
        res.end();
        return;
      }

      // Phase 1: Import
      let written: { count: number; createdIds: string[]; failed: number };
      try {
        written = await contactService.bulkCreateContacts(
          scope,
          contacts,
          (processed, total, phase) => {
            send({ phase: "importing", processed, total, message: phase });
            // The record keeps the same count, every fifty rows, so a
            // browser that lost the stream reads progress by polling.
            if (processed % 50 === 0 || processed === total) {
              importService.progress(scope, importId, processed);
            }
          },
          { importId },
        );
      } catch (err: unknown) {
        // Nothing committed. The record says so, and the stream ends with
        // no `done` frame, which is the browser's cue to ask the record.
        importService.fail(scope, importId, getErrorMessage(err));
        log.error(
          "API",
          `[${rid}] POST /api/contacts/bulk → import ${importId} failed before commit: ${getErrorMessage(err)}`,
        );
        res.end();
        return;
      }

      log.info(
        "API",
        `[${rid}] POST /api/contacts/bulk → ${written.count} imported, ${written.failed} failed (import ${importId})`,
      );

      // Phases 2 to 4: fingerprints, the duplicate check, the summary. One
      // function, shared with the JSON path, a retry, and a resumed check.
      const finished = await importService.finish(
        scope,
        importId,
        written.createdIds,
        rid,
        send,
      );
      send(doneFrame(finished, false));
      res.end();
    } else {
      // Standard JSON mode — for small imports or non-streaming clients
      if (repeated) {
        res.status(200).json({
          success: true,
          repeated: true,
          importId,
          status: record.status,
          count: record.imported,
          failed: record.failed,
        });
        return;
      }

      let written: { count: number; createdIds: string[]; failed: number };
      try {
        written = await contactService.bulkCreateContacts(
          scope,
          contacts,
          undefined,
          { importId },
        );
      } catch (err: unknown) {
        importService.fail(scope, importId, getErrorMessage(err));
        throw err;
      }
      log.info(
        "API",
        `[${rid}] POST /api/contacts/bulk → ${written.count} imported, ${written.failed} failed (import ${importId})`,
      );

      // The tail outlives the response, and waits out the settle delay
      // before it starts. AsyncLocalStorage does carry the request's scope
      // through a timer, so this ran attributed before the wrapper as well as
      // after it. The wrapper makes the owner an argument rather than an
      // inheritance: the day this work moves behind a queue, the context it
      // runs in belongs to whoever drained the queue.
      //
      // One scan for the whole import, not one check per contact. The loop
      // that was here called `incrementalDedupeCheck` once per created
      // contact, and every one of those normalized the account's whole
      // corpus. `runImportScan`, inside `finish`, builds the corpus once.
      runWithContext(
        { requestId: `imp-${rid}`, principal: null, scope },
        () => {
          // The fingerprints start now, while the settle delay runs, as they
          // always have on this path. `finish` is told not to run them again.
          generateAndStoreBulkEmbeddings(written.createdIds).catch((err) =>
            log.warn(
              "API",
              `Background bulk embedding failed: ${getErrorMessage(err)}`,
            ),
          );
          void (async () => {
            // Let bulk inserts and embedding tasks settle first.
            await new Promise((resolve) =>
              setTimeout(resolve, IMPORT_SETTLE_MS),
            );
            await importService.finish(
              scope,
              importId,
              written.createdIds,
              `imp-${rid}`,
              undefined,
              { skipEmbedding: true },
            );
          })().catch((err) =>
            log.error(
              "API",
              `Bulk background import tail crashed: ${getErrorMessage(err)}`,
            ),
          );
        },
      );
      res.status(201).json({
        success: true,
        count: written.count,
        failed: written.failed,
        importId,
      });
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
  validateBody(contactRoutes.bulkDelete.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const count = contactService.bulkDeleteContacts(scopeOf(req), req.body.ids);
    log.info(
      "API",
      `[${rid}] POST /api/contacts/bulk-delete → ${count} deleted`,
    );
    res.json({
      success: true,
      count,
      retentionDays: trashRetentionDays().value,
    });
  }),
);

router.put(
  "/contacts/bulk-update",
  validateBody(contactRoutes.bulkUpdate.body),
  refuseForeignUploads,
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const scope = scopeOf(req);
    const count = contactService.bulkUpdateContacts(
      scope,
      req.body.ids,
      req.body.data,
    );
    // Contacts that just became tracked are scored before the answer goes
    // out, so the ring is right on the next read and not an hour later.
    if (req.body.data.isTracked === true) {
      await relationshipService.scoreContacts(scope.ownerId, req.body.ids);
    }
    log.info(
      "API",
      `[${rid}] PUT /api/contacts/bulk-update → ${count} updated`,
    );
    res.json({ success: true, count });
  }),
);

router.put(
  "/contacts/:id",
  validateBody(contactRoutes.replace.body),
  refuseForeignUploads,
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
  validateBody(contactRoutes.patch.body),
  refuseForeignUploads,
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
    res.json({ success: true, retentionDays: trashRetentionDays().value });
  }),
);

/**
 * PATCH /api/contacts/:id/location
 *
 * The pin, by hand. `{ lat, lng }` puts it where a person dropped it and
 * marks the row `geoSource = 'manual'`, which the geocoder then leaves alone
 * until the address text changes. `{ regeocode: true }` hands the pin back:
 * the coordinates are cleared and the geocoder reads the address again.
 */
router.patch(
  "/contacts/:id/location",
  requireContact,
  validateBody(contactRoutes.location.body),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const id = String(req.params.id);
    const body = req.body as z.output<typeof contactRoutes.location.body>;
    const updated =
      "regeocode" in body
        ? contactService.regeocode(scopeOf(req), id)
        : contactService.setLocation(scopeOf(req), id, body.lat, body.lng);
    if (!updated) throw new NotFoundError("Contact");
    log.info(
      "API",
      `[${rid}] PATCH /api/contacts/${id}/location → ${
        "regeocode" in body ? "back to the geocoder" : "placed by hand"
      }`,
    );
    res.json(updated);
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
 * Single-contact enrichment, through the research layer that runs the batch
 * jobs too, for an individual contact.
 *
 * Quota-aware: Returns 429 if grounding RPD is exhausted.
 * Returns 503 if AI provider is not configured.
 */
/**
 * The single enrichment's body: nothing, or the depth, the technique and the
 * web search. The contract gives the shape, and the technique and the web
 * search are then checked against the registries this server holds.
 */
const enrichBodySchema = contactRoutes.enrich.body.pipe(
  researchChoiceSchema.extend({ depth: researchDepthSchema.optional() }),
);

router.post(
  "/contacts/:id/enrich",
  requireContact,
  validateBody(enrichBodySchema),
  asyncHandler(async (req, res) => {
    const rid = req.requestId;
    const id = String(req.params.id);
    const scope = scopeOf(req);
    const depth: ResearchDepth = req.body.depth ?? DEFAULT_RESEARCH_DEPTH;
    // requireContact above already checked the owner. This repeats it against
    // the repository so the check is visible at the call that spends money.
    contactRepo.requireOwned(scope, id);

    const choice = chooseResearch(
      { technique: req.body.technique, webSearch: req.body.webSearch },
      getPreferences(scope.ownerId).webSearchEngine,
    );
    const contact = enrichmentContact(scope, id);
    const release = lockEnrichment(id);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on("close", onClose);
    try {
      const startMs = Date.now();
      // The research provider is named for the log only: the technique
      // decides which models it calls.
      log.info(
        "API",
        `[${rid}] POST /api/contacts/${id}/enrich — starting ${choice.technique} (${depth}) for "${contact.name}" (provider: ${providerIdFor("research") ?? "none"})`,
      );

      const result = toAISearchResult(
        await research({
          scope,
          contact,
          depth,
          history: researchHistory(contact),
          signal: controller.signal,
          ...choice,
          // The allowance a batch job has at this depth, under Node's own
          // request timeout of 300 s (server.ts sets no shorter one).
          timeoutMs: Math.min(RESEARCH_TIMEOUT_MS[depth], 290_000),
        }),
      );
      controller.signal.throwIfAborted();
      const fieldsUpdated = mergeSearchResult(
        scope,
        id,
        contact,
        result.data,
        result,
      );
      const latencyMs = Date.now() - startMs;

      log.info(
        "API",
        `[${rid}] POST /api/contacts/${id}/enrich — ${fieldsUpdated} field(s) merged in ${latencyMs}ms`,
      );

      res.json({
        success: true,
        fieldsUpdated,
        outcome:
          result.outcome === "no-public-info"
            ? "no-public-info"
            : fieldsUpdated > 0
              ? "added"
              : "nothing-new",
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
