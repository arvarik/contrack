import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../logger.ts";
import { buildContactUpdate } from "../helpers.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { queueGeocode } from "../geocoder.ts";
import { parseContactRecord } from "../ai/aiService.ts";
import { invalidateSearchCache } from "../searchCache.ts";
import { validateBody, contactCreateSchema, contactUpdateSchema, contactBulkCreateSchema } from "../utils/validators.ts";
import { z } from 'zod';
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

// Avatar-specific upload storage — separate subfolder
const avatarDir = path.join(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap for avatars
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

const router = Router();

router.get("/contacts/map", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const results = sqlite.prepare(
    "SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL AND (isArchived = 0 OR isArchived IS NULL)"
  ).all();
  log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
  res.json(results);
}));

router.get("/contacts/archived", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const all = sqlite.prepare("SELECT * FROM contacts WHERE isArchived = 1 ORDER BY updatedAt DESC").all();
  log.debug("API", `[${rid}] GET /api/contacts/archived → ${all.length}`);
  res.json(contactRepo.hydrateMany(all));
}));

router.get("/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const view = req.query.view as string;

  // Slim mode — optimized for sidebar rendering (1 query instead of 12×N)
  if (view === 'slim') {
    const rows = sqlite.prepare(`
      SELECT c.id, c.name, c.firstName, c.lastName, c.company, c.avatarUrl, 
             c.themeColor, c.isGhost, c.isArchived, c.addedAt, c.updatedAt,
             c.role, c.headline, c.location, c.industry, c.pronouns,
             c.cadenceDays, c.lastContactedAt, c.nextFollowUpAt,
             c.lat, c.lng,
             GROUP_CONCAT(DISTINCT t.tag) as _tags,
             (SELECT COUNT(*) FROM interactions WHERE contactId = c.id) as interactionCount
      FROM contacts c
      LEFT JOIN contact_tags t ON c.id = t.contactId
      WHERE (c.isArchived = 0 OR c.isArchived IS NULL)
      GROUP BY c.id
      ORDER BY c.addedAt DESC
    `).all() as any[];

    // Also batch-fetch lists for all contacts in one query
    const listRows = sqlite.prepare(`
      SELECT lm.contactId, l.id, l.name, l.icon, l.sortOrder
      FROM list_members lm
      JOIN lists l ON l.id = lm.listId
      ORDER BY l.sortOrder ASC
    `).all() as any[];
    
    const listsByContact = new Map<string, any[]>();
    for (const lr of listRows) {
      if (!listsByContact.has(lr.contactId)) listsByContact.set(lr.contactId, []);
      listsByContact.get(lr.contactId)!.push({ id: lr.id, name: lr.name, icon: lr.icon, sortOrder: lr.sortOrder });
    }

    const result = rows.map(({ _tags, ...r }) => ({
      ...r,
      isGhost: !!r.isGhost,
      isArchived: !!r.isArchived,
      tags: _tags ? _tags.split(',').map((tag: string) => ({ id: tag, tag })) : [],
      lists: listsByContact.get(r.id) || [],
      interactionCount: r.interactionCount ?? 0,
      // Provide empty arrays for child records the sidebar doesn't need
      emails: [], phones: [], socialLinks: [], education: [], experience: [],
      sources: [], addresses: [], interests: [], attributes: [],
    }));

    log.debug("API", `[${rid}] GET /api/contacts?view=slim → ${result.length} (slim)`);
    return res.json(result);
  }

  // Full mode — complete hydration for backward compat
  const all = sqlite.prepare("SELECT * FROM contacts WHERE (isArchived = 0 OR isArchived IS NULL) ORDER BY addedAt DESC").all();
  log.debug("API", `[${rid}] GET /api/contacts → ${all.length}`);
  res.json(contactRepo.hydrateMany(all));
}));

router.get("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const contact = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(req.params.id);
  if (!contact) { log.warn("API", `[${rid}] 404 ${req.params.id}`); throw new AppError("Not found", 404); }
  res.json(contactRepo.hydrate(contact));
}));

router.post("/contacts", validateBody(contactCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const body = req.body;
  if (!body.name) throw new AppError("Name is required", 400);

  const id = crypto.randomUUID();
  const txn = sqlite.transaction(() => {
    db.insert(schema.contacts).values({
      id, name: body.name,
      firstName: body.firstName || null, lastName: body.lastName || null,
      headline: body.headline || null, role: body.role || null,
      company: body.company || null, location: body.location || null,
      birthday: body.birthday || null, preferences: body.preferences || null,
      avatarUrl: body.avatarUrl || null,
      cadenceDays: body.cadenceDays ?? 90, about: body.about || null,
      pronouns: body.pronouns || null, industry: body.industry || null,
      website: body.website || null,
    }).run();
    contactRepo.insertChildRecords(id, body);
  });
  txn();
  if (body.location) {
    queueGeocode(id, body.location);
  } else if (body.addresses !== undefined && Array.isArray(body.addresses) && body.addresses.length > 0) {
    const primaryAddress = body.addresses.find((a: any) => a?.isPrimary) || body.addresses[0];
    const addressString = typeof primaryAddress === 'string' ? primaryAddress : primaryAddress.address;
    if (addressString) queueGeocode(id, addressString);
  }

  invalidateSearchCache();
  log.info("API", `[${rid}] POST /api/contacts → "${body.name}" (${id})`);
  res.status(201).json(contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id)));
}));

router.post("/contacts/bulk", validateBody(contactBulkCreateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const valid = req.body;
  let count = 0;

  const txn = sqlite.transaction(() => {
    for (const c of valid) {
      const id = crypto.randomUUID();
      db.insert(schema.contacts).values({
        id, name: c.name,
        firstName: c.firstName || null, lastName: c.lastName || null,
        headline: c.headline || null, role: c.role || null,
        company: c.company || null, location: c.location || null,
        birthday: c.birthday || null, preferences: c.preferences || null,
        avatarUrl: c.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(c.name)}&mouth=default,smile,serious`,
        cadenceDays: c.cadenceDays ?? 90,
        about: c.about || null, pronouns: c.pronouns || null,
        industry: c.industry || null, website: c.website || null,
      }).run();
      contactRepo.insertChildRecords(id, c, c._sourcePlatform || 'manual');
      if (c.location) queueGeocode(id, c.location);
      count++;
    }
  });
  txn();
  invalidateSearchCache();
  log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);
  res.status(201).json({ success: true, count });
}));

router.post("/parse-contact", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { text } = req.body;
  if (!text) throw new AppError("Text is required", 400);
  const parsed = await parseContactRecord(text);
  log.info("API", `[${rid}] POST /api/parse-contact → parsed "${parsed.name}"`);
  res.json(parsed);
}));

// ---------------------------------------------------------------------------
// Bulk Operations — MUST be before /:id routes to avoid param collision
// ---------------------------------------------------------------------------

router.post("/contacts/bulk-delete", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1) })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { ids } = req.body;

  const deleteFn = sqlite.transaction(() => {
    const stmt = sqlite.prepare("DELETE FROM contacts WHERE id = ?");
    for (const id of ids) stmt.run(id);
  });
  deleteFn();
  invalidateSearchCache();
  log.info("API", `[${rid}] POST /api/contacts/bulk-delete → ${ids.length} deleted`);
  res.json({ success: true, count: ids.length });
}));

router.put("/contacts/bulk-update", validateBody(z.object({ ids: z.array(z.string().min(1)).min(1), data: contactUpdateSchema })), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { ids, data } = req.body;

  const update = buildContactUpdate(data);
  const updateFn = sqlite.transaction(() => {
    const setClauses = Object.keys(update).map(k => `${k} = ?`).join(', ');
    const values = Object.values(update);
    const stmt = sqlite.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`);
    for (const id of ids) stmt.run(...values, id);
  });
  updateFn();
  invalidateSearchCache();
  log.info("API", `[${rid}] PUT /api/contacts/bulk-update → ${ids.length} updated`);
  res.json({ success: true, count: ids.length });
}));

router.put("/contacts/:id", validateBody(contactUpdateSchema), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const body = req.body;

  const txn = sqlite.transaction(() => {
    db.update(schema.contacts).set(buildContactUpdate(body)).where(eq(schema.contacts.id, id)).run();

    // For every known array relation, if it is explicitly passed in the body,
    // treat it as a "Full Replacement" operation. Wipe the olds, and insert the news.
    const childMappings: [keyof typeof body, string][] = [
      ['emails', 'contact_emails'],
      ['phones', 'contact_phones'],
      ['socialLinks', 'contact_social_links'],
      ['tags', 'contact_tags'],
      ['interests', 'contact_interests'],
      ['addresses', 'contact_addresses'],
      ['attributes', 'contact_attributes'],
      ['education', 'contact_education'],
      ['experience', 'contact_experience'],
      ['sources', 'contact_sources'],
    ];

    for (const [bodyKey, tableName] of childMappings) {
      if (body[bodyKey] !== undefined && Array.isArray(body[bodyKey])) {
        sqlite.prepare(`DELETE FROM ${tableName} WHERE contactId = ?`).run(id);
        contactRepo.insertChildRecords(id, { [bodyKey]: body[bodyKey] });
      }
    }
  });
  txn();

  const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
  if (!updated) throw new AppError("Not found", 404);
  
  // Trigger geocoding: Prefer explicitly updated `location` scalar, otherwise fallback to primary `address`
  if (body.location) {
    queueGeocode(id, body.location);
  } else if (body.addresses !== undefined && Array.isArray(body.addresses) && body.addresses.length > 0) {
    const primaryAddress = body.addresses.find((a: any) => a?.isPrimary) || body.addresses[0];
    const addressString = typeof primaryAddress === 'string' ? primaryAddress : primaryAddress.address;
    if (addressString) queueGeocode(id, addressString);
  }

  invalidateSearchCache();
  log.info("API", `[${rid}] PUT /api/contacts/${id} → updated`);
  res.json(updated);
}));

// ---------------------------------------------------------------------------
// PATCH — Lightweight scalar-only update (theme, archive, cadence, etc.)
// Skips child record processing entirely — use PUT for full updates with arrays.
// ---------------------------------------------------------------------------

router.patch("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const { id } = req.params;
  const body = req.body;

  // Only allow scalar contact fields — reject if any child arrays are passed
  const childKeys = ['emails', 'phones', 'socialLinks', 'tags', 'interests', 'addresses', 'attributes', 'education', 'experience', 'sources'];
  const hasChildArrays = childKeys.some(k => body[k] !== undefined);
  if (hasChildArrays) {
    throw new AppError("PATCH does not support child arrays. Use PUT for full updates.", 400);
  }

  const update = buildContactUpdate(body);
  db.update(schema.contacts).set(update).where(eq(schema.contacts.id, id)).run();

  // Trigger geocoding if location changed
  if (body.location) {
    queueGeocode(id, body.location);
  }

  const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
  if (!updated) throw new AppError("Not found", 404);

  invalidateSearchCache();
  log.info("API", `[${rid}] PATCH /api/contacts/${id} → updated (scalar)`);
  res.json(updated);
}));

router.delete("/contacts/:id", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const result = await db.delete(schema.contacts).where(eq(schema.contacts.id, req.params.id)).returning();
  if (!result?.length) throw new AppError("Not found", 404);
  invalidateSearchCache();
  log.info("API", `[${rid}] DELETE /api/contacts/${req.params.id}`);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Avatar Upload — persists image to disk, updates avatarUrl in DB
// Must come after DELETE /:id to avoid 'avatar' being matched as :id
// ---------------------------------------------------------------------------

router.post("/contacts/:id/avatar", uploadAvatar.single("avatar"), asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  if (!req.file) throw new AppError("No image file provided", 400);
  const { id } = req.params;

  // Build the public URL served by express.static
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;

  // Delete old uploaded avatar if it was a local file (not a dicebear URL)
  const existing = sqlite.prepare("SELECT avatarUrl FROM contacts WHERE id = ?").get(id) as any;
  if (existing?.avatarUrl?.startsWith('/uploads/avatars/')) {
    const oldPath = path.join(process.cwd(), existing.avatarUrl);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  db.update(schema.contacts)
    .set({ avatarUrl, updatedAt: new Date().toISOString() })
    .where(eq(schema.contacts.id, id))
    .run();

  const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
  if (!updated) throw new AppError("Contact not found", 404);

  invalidateSearchCache();
  log.info("API", `[${rid}] POST /api/contacts/${id}/avatar → ${avatarUrl}`);
  res.json(updated);
}));

export const contactsRouter = router;
