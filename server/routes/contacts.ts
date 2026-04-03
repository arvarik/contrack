import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../logger.ts";
import { hydrateContact, buildContactUpdate, insertChildRecords, detectPlatformFromUrl, extractHandleFromUrl } from "../helpers.ts";
import { queueGeocode } from "../geocoder.ts";
import { parseContactRecord } from "../../aiService.ts";
import { invalidateSearchCache } from "../searchCache.ts";

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

router.get("/contacts/map", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const results = sqlite.prepare(
      "SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL AND (isArchived = 0 OR isArchived IS NULL)"
    ).all();
    log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
    res.json(results);
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts/map failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch map data" });
  }
});

router.get("/contacts/archived", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const all = sqlite.prepare("SELECT * FROM contacts WHERE isArchived = 1 ORDER BY updatedAt DESC").all();
    log.debug("API", `[${rid}] GET /api/contacts/archived → ${all.length}`);
    res.json(all.map(hydrateContact));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts/archived failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch archived contacts" });
  }
});

router.get("/contacts", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const all = sqlite.prepare("SELECT * FROM contacts ORDER BY addedAt DESC").all();
    log.debug("API", `[${rid}] GET /api/contacts → ${all.length}`);
    res.json(all.map(hydrateContact));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

router.get("/contacts/:id", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const contact = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(req.params.id);
    if (!contact) { log.warn("API", `[${rid}] 404 ${req.params.id}`); return res.status(404).json({ error: "Not found" }); }
    res.json(hydrateContact(contact));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts/${req.params.id} failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch contact" });
  }
});

router.post("/contacts", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const body = req.body;
    if (!body.name) return res.status(400).json({ error: "Name is required" });

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
      insertChildRecords(id, body);
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
    res.status(201).json(hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id)));
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/contacts failed`, { error: err.message });
    res.status(500).json({ error: "Failed to create contact" });
  }
});

router.post("/contacts/bulk", (req, res) => {
  const rid = (req as any).requestId;
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: "Expected array" });

    const valid = req.body.filter((c: any) => !!c.name);
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
        insertChildRecords(id, c, c._sourcePlatform || 'manual');
        if (c.location) queueGeocode(id, c.location);
        count++;
      }
    });
    txn();
    invalidateSearchCache();
    log.info("API", `[${rid}] POST /api/contacts/bulk → ${count} imported`);
    res.status(201).json({ success: true, count });
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/contacts/bulk failed`, { error: err.message });
    res.status(500).json({ error: "Failed to import contacts" });
  }
});

router.post("/parse-contact", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required" });
    const parsed = await parseContactRecord(text);
    log.info("API", `[${rid}] POST /api/parse-contact → parsed "${parsed.name}"`);
    res.json(parsed);
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/parse-contact failed`, { error: err.message });
    res.status(500).json({ error: "Failed to parse contact text" });
  }
});

// ---------------------------------------------------------------------------
// Bulk Operations — MUST be before /:id routes to avoid param collision
// ---------------------------------------------------------------------------

router.post("/contacts/bulk-delete", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: "ids array required" });

    const deleteFn = sqlite.transaction(() => {
      const stmt = sqlite.prepare("DELETE FROM contacts WHERE id = ?");
      for (const id of ids) stmt.run(id);
    });
    deleteFn();
    invalidateSearchCache();
    log.info("API", `[${rid}] POST /api/contacts/bulk-delete → ${ids.length} deleted`);
    res.json({ success: true, count: ids.length });
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/contacts/bulk-delete failed`, { error: err.message });
    res.status(500).json({ error: "Failed to bulk delete" });
  }
});

router.put("/contacts/bulk-update", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { ids, data } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.status(400).json({ error: "ids array required" });
    if (!data || typeof data !== 'object')
      return res.status(400).json({ error: "data object required" });

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
  } catch (err: any) {
    log.error("API", `[${rid}] PUT /api/contacts/bulk-update failed`, { error: err.message });
    res.status(500).json({ error: "Failed to bulk update" });
  }
});

router.put("/contacts/:id", (req, res) => {
  const rid = (req as any).requestId;
  try {
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
          insertChildRecords(id, { [bodyKey]: body[bodyKey] });
        }
      }
    });
    txn();

    const updated = hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return res.status(404).json({ error: "Not found" });
    
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
  } catch (err: any) {
    log.error("API", `[${rid}] PUT /api/contacts/${req.params.id} failed`, { error: err.message });
    res.status(500).json({ error: "Failed to update contact" });
  }
});

router.delete("/contacts/:id", async (req, res) => {
  const rid = (req as any).requestId;
  try {
    const result = await db.delete(schema.contacts).where(eq(schema.contacts.id, req.params.id)).returning();
    if (!result?.length) return res.status(404).json({ error: "Not found" });
    invalidateSearchCache();
    log.info("API", `[${rid}] DELETE /api/contacts/${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] DELETE failed`, { error: err.message });
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

// ---------------------------------------------------------------------------
// Avatar Upload — persists image to disk, updates avatarUrl in DB
// Must come after DELETE /:id to avoid 'avatar' being matched as :id
// ---------------------------------------------------------------------------

router.post("/contacts/:id/avatar", uploadAvatar.single("avatar"), (req, res) => {
  const rid = (req as any).requestId;
  try {
    if (!req.file) return res.status(400).json({ error: "No image file provided" });
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

    const updated = hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return res.status(404).json({ error: "Contact not found" });

    invalidateSearchCache();
    log.info("API", `[${rid}] POST /api/contacts/${id}/avatar → ${avatarUrl}`);
    res.json(updated);
  } catch (err: any) {
    log.error("API", `[${rid}] POST /api/contacts/:id/avatar failed`, { error: err.message });
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});

export const contactsRouter = router;
