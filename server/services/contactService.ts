import crypto from "crypto";
import fs from "fs";
import path from "path";
import { db, sqlite } from "../db.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { contactRepo } from "../repositories/contactRepository.ts";
import { queueGeocode } from "./geocodingService.ts";
import { invalidateSearchCache } from "../utils/searchCache.ts";
import { buildContactUpdate } from "../utils/helpers.ts";

export const contactService = {
  createContact(body: any, source: string = 'manual') {
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
      contactRepo.insertChildRecords(id, body, source);
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
    return contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
  },

  bulkCreateContacts(validContacts: any[]) {
    let count = 0;
    const txn = sqlite.transaction(() => {
      for (const c of validContacts) {
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
    return count;
  },

  bulkDeleteContacts(ids: string[]) {
    const deleteFn = sqlite.transaction(() => {
      const stmt = sqlite.prepare("DELETE FROM contacts WHERE id = ?");
      for (const id of ids) stmt.run(id);
    });
    deleteFn();
    invalidateSearchCache();
    return ids.length;
  },

  bulkUpdateContacts(ids: string[], data: any) {
    const update = buildContactUpdate(data);
    const updateFn = sqlite.transaction(() => {
      const setClauses = Object.keys(update).map(k => `${k} = ?`).join(', ');
      const values = Object.values(update);
      const stmt = sqlite.prepare(`UPDATE contacts SET ${setClauses} WHERE id = ?`);
      for (const id of ids) stmt.run(...values, id);
    });
    updateFn();
    invalidateSearchCache();
    return ids.length;
  },

  updateContact(id: string, body: any) {
    const txn = sqlite.transaction(() => {
      db.update(schema.contacts).set(buildContactUpdate(body)).where(eq(schema.contacts.id, id)).run();

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
    if (!updated) return null;
    
    if (body.location) {
      queueGeocode(id, body.location);
    } else if (body.addresses !== undefined && Array.isArray(body.addresses) && body.addresses.length > 0) {
      const primaryAddress = body.addresses.find((a: any) => a?.isPrimary) || body.addresses[0];
      const addressString = typeof primaryAddress === 'string' ? primaryAddress : primaryAddress.address;
      if (addressString) queueGeocode(id, addressString);
    }

    invalidateSearchCache();
    return updated;
  },

  patchContact(id: string, body: any) {
    const update = buildContactUpdate(body);
    db.update(schema.contacts).set(update).where(eq(schema.contacts.id, id)).run();

    if (body.location) {
      queueGeocode(id, body.location);
    }

    const updated = contactRepo.hydrate(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id));
    if (!updated) return null;

    invalidateSearchCache();
    return updated;
  },

  deleteContact(id: string) {
    const result = db.delete(schema.contacts).where(eq(schema.contacts.id, id)).returning().get();
    if (!result) return false;
    invalidateSearchCache();
    return true;
  },

  updateAvatar(id: string, fileFilename: string, fileOriginalName: string) {
    const avatarUrl = `/uploads/avatars/${fileFilename}`;
    
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
    if (!updated) return null;

    invalidateSearchCache();
    return updated;
  },

  getMapContacts() {
    return sqlite.prepare(
      "SELECT id, name, company, avatarUrl, location, lat, lng FROM contacts WHERE lat IS NOT NULL AND lng IS NOT NULL AND (isArchived = 0 OR isArchived IS NULL)"
    ).all();
  },

  getArchivedContacts() {
    const all = sqlite.prepare("SELECT * FROM contacts WHERE isArchived = 1 ORDER BY updatedAt DESC").all();
    return contactRepo.hydrateMany(all);
  },

  getSlimContacts() {
    const rows = sqlite.prepare(`
      SELECT c.id, c.name, c.firstName, c.lastName, c.company, c.avatarUrl, 
             c.themeColor, c.isGhost, c.isArchived, c.addedAt, c.updatedAt,
             c.role, c.headline, c.location, c.industry, c.pronouns,
             c.cadenceDays, c.lastContactedAt, c.nextFollowUpAt,
             c.lat, c.lng, c.relationshipScore,
             GROUP_CONCAT(DISTINCT t.tag) as _tags,
             (SELECT COUNT(*) FROM interactions WHERE contactId = c.id) as interactionCount,
             (SELECT GROUP_CONCAT(e.email) FROM contact_emails e WHERE e.contactId = c.id) as _allEmails,
             (SELECT GROUP_CONCAT(p.phone) FROM contact_phones p WHERE p.contactId = c.id) as _allPhones
      FROM contacts c
      LEFT JOIN contact_tags t ON c.id = t.contactId
      WHERE (c.isArchived = 0 OR c.isArchived IS NULL)
      GROUP BY c.id
      ORDER BY c.addedAt DESC
    `).all() as any[];

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

    return rows.map(({ _tags, _allEmails, _allPhones, ...r }) => ({
      ...r,
      isGhost: !!r.isGhost,
      isArchived: !!r.isArchived,
      tags: _tags ? _tags.split(',').map((tag: string) => ({ id: tag, tag })) : [],
      lists: listsByContact.get(r.id) || [],
      interactionCount: r.interactionCount ?? 0,
      emails: _allEmails ? _allEmails.split(',').map((e: string) => ({ email: e })) : [],
      phones: _allPhones ? _allPhones.split(',').map((p: string) => ({ phone: p })) : [],
      socialLinks: [], education: [], experience: [],
      sources: [], addresses: [], interests: [], attributes: [],
    }));
  },

  getAllContacts() {
    const all = sqlite.prepare("SELECT * FROM contacts WHERE (isArchived = 0 OR isArchived IS NULL) ORDER BY addedAt DESC").all();
    return contactRepo.hydrateMany(all);
  },

  getContactById(id: string) {
    const contact = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
    if (!contact) return null;
    return contactRepo.hydrate(contact);
  }
};
