// =============================================================================
// Routes — Imports: the record a bulk import leaves behind
// =============================================================================
// Mounted in server/app.ts at /api. `POST /api/contacts/bulk` writes the
// record; these three read it back and act on it.
//
//   GET  /api/imports/:id         where the import is, and its summary
//   GET  /api/imports/:id/rows    the rows in one status, failed by default
//   POST /api/imports/:id/retry   run the failed rows again
//
// Every handler resolves the import through the caller's scope, so an id
// another account chose answers 404 exactly as an id nobody chose does.
// =============================================================================

import { Router } from "express";
import { z } from "zod";
import { log } from "../utils/logger.ts";
import { AppError, NotFoundError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { scopeOf } from "../tenancy/scope.ts";
import { runWithContext } from "../tenancy/requestContext.ts";
import { contactService } from "../services/contactService.ts";
import { importService } from "../services/importService.ts";
import { getErrorMessage } from "../utils/helpers.ts";

const router = Router();

/**
 * An import id. The browser makes one with `crypto.randomUUID()`, and the
 * server makes one the same way for a caller that sent none.
 */
export const importIdSchema = z.uuid();

function requireId(raw: unknown): string {
  const parsed = importIdSchema.safeParse(String(raw));
  if (!parsed.success) throw new NotFoundError("Import", String(raw));
  return parsed.data;
}

router.get(
  "/imports/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const id = requireId(req.params.id);
    const record = importService.get(scope, id, req.requestId);
    if (!record) throw new NotFoundError("Import", id);
    res.json(record);
  }),
);

const rowsQuerySchema = z.object({
  status: z.enum(["failed", "done"]).default("failed"),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get(
  "/imports/:id/rows",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const id = requireId(req.params.id);
    const query = rowsQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new AppError(
        "status must be failed or done, and limit between 1 and 500",
        400,
        { code: "VALIDATION_ERROR" },
      );
    }
    const { status, limit } = query.data;
    res.json({ rows: importService.rows(scope, id, status, limit) });
  }),
);

/**
 * Run the failed rows again.
 *
 * The rows are written and the response goes out. The duplicate check for
 * the new contacts runs afterwards, the way the JSON import's does, and the
 * record moves from `imported` back to `complete` when it finishes. A
 * browser that wants the summary polls `GET /api/imports/:id`.
 */
router.post(
  "/imports/:id/retry",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const rid = req.requestId;
    const id = requireId(req.params.id);

    importService.beginRetry(scope, id);
    let createdIds: string[] = [];
    let retried = 0;
    try {
      const { indexes, contacts } = importService.failedRows(scope, id);
      retried = contacts.length;
      if (retried === 0) {
        throw new AppError(
          "The failed rows of this import cannot be run again.",
          400,
          { code: "NOTHING_TO_RETRY" },
        );
      }
      const result = await contactService.bulkCreateContacts(
        scope,
        contacts,
        undefined,
        { importId: id, rowIndexes: indexes },
      );
      createdIds = result.createdIds;
    } catch (err) {
      importService.releaseRetry(scope, id);
      throw err;
    }

    const record = importService.get(scope, id, rid);
    log.info(
      "API",
      `[${rid}] POST /api/imports/${id}/retry → ${retried} retried, ${createdIds.length} imported`,
    );
    res.json({
      importId: id,
      status: record?.status ?? "imported",
      retried,
      imported: record?.imported ?? createdIds.length,
      failed: record?.failed ?? retried - createdIds.length,
    });

    // The tail outlives the response. Same wrapper as the JSON import, for
    // the same reason: the owner is an argument of the job, not something
    // inherited from whatever context is current when it runs.
    runWithContext(
      { requestId: `imp-retry-${rid}`, principal: null, scope },
      () => importService.finish(scope, id, createdIds, rid),
    ).catch((err) =>
      log.error(
        "API",
        `[${rid}] Retry tail for import ${id} crashed: ${getErrorMessage(err)}`,
      ),
    );
  }),
);

export const importsRouter = router;
