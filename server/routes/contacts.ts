import { Router } from "express";
import crypto from "crypto";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { log } from "../logger.ts";
import { hydrateContact, buildContactUpdate, insertChildRecords, detectPlatformFromUrl, extractHandleFromUrl } from "../helpers.ts";
import { queueGeocode } from "../geocoder.ts";
import { parseContactRecord } from "../../aiService.ts";

const router = Router();

router.get("/contacts/map", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const results = sqlite.prepare("SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL").all();
    log.debug("API", `[${rid}] GET /api/contacts/map → ${results.length}`);
    res.json(results);
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts/map failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch map data" });
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
          avatarUrl: c.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(c.name)}`,
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

router.put("/contacts/:id", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const { id } = req.params;
    const body = req.body;

    const txn = sqlite.transaction(() => {
      db.update(schema.contacts).set(buildContactUpdate(body)).where(eq(schema.contacts.id, id)).run();

      if (body.emails !== undefined && Array.isArray(body.emails)) {
        sqlite.prepare("DELETE FROM contact_emails WHERE contactId = ?").run(id);
        for (let i = 0; i < body.emails.length; i++) {
          const e = body.emails[i];
          const email = (typeof e === 'string' ? e : e.email)?.trim();
          if (!email) continue;
          sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), id, email,
            (typeof e === 'object' ? e.label : 'personal') || 'personal',
            (typeof e === 'object' ? (e.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0)),
            typeof e === 'object' ? (e.source || 'manual') : 'manual',
          );
        }
      }
      if (body.phones !== undefined && Array.isArray(body.phones)) {
        sqlite.prepare("DELETE FROM contact_phones WHERE contactId = ?").run(id);
        for (let i = 0; i < body.phones.length; i++) {
          const p = body.phones[i];
          const phone = (typeof p === 'string' ? p : p.phone)?.trim();
          if (!phone) continue;
          sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), id, phone,
            (typeof p === 'object' ? p.label : 'mobile') || 'mobile',
            (typeof p === 'object' ? (p.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0)),
            typeof p === 'object' ? (p.source || 'manual') : 'manual',
          );
        }
      }
      if (body.socialLinks !== undefined && Array.isArray(body.socialLinks)) {
        sqlite.prepare("DELETE FROM contact_social_links WHERE contactId = ?").run(id);
        // Top-level imports used
        for (const sl of body.socialLinks) {
          const url = (typeof sl === 'string' ? sl : sl.url)?.trim();
          if (!url) continue;
          const platform = typeof sl === 'object' && sl.platform ? sl.platform : detectPlatformFromUrl(url);
          sqlite.prepare("INSERT INTO contact_social_links (id, contactId, platform, url, handle, source) VALUES (?, ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), id, platform, url,
            typeof sl === 'object' ? sl.handle || extractHandleFromUrl(url) : extractHandleFromUrl(url), 'manual',
          );
        }
      }
      if (body.tags !== undefined && Array.isArray(body.tags)) {
        sqlite.prepare("DELETE FROM contact_tags WHERE contactId = ?").run(id);
        for (const tag of body.tags) {
          const val = (typeof tag === 'string' ? tag : tag.tag)?.trim();
          if (!val) continue;
          sqlite.prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)").run(crypto.randomUUID(), id, val);
        }
      }
      if (body.addresses !== undefined && Array.isArray(body.addresses)) {
        sqlite.prepare("DELETE FROM contact_addresses WHERE contactId = ?").run(id);
        for (let i = 0; i < body.addresses.length; i++) {
          const a = body.addresses[i];
          const address = (typeof a === 'string' ? a : a.address)?.trim();
          if (!address) continue;
          sqlite.prepare("INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
            crypto.randomUUID(), id, address,
            (typeof a === 'object' ? a.label : 'home') || 'home',
            (typeof a === 'object' ? (a.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0)),
            typeof a === 'object' ? (a.source || 'manual') : 'manual',
          );
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
    log.info("API", `[${rid}] DELETE /api/contacts/${req.params.id}`);
    res.json({ success: true });
  } catch (err: any) {
    log.error("API", `[${rid}] DELETE failed`, { error: err.message });
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

export const contactsRouter = router;
