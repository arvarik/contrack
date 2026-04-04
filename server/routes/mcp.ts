import { Router } from "express";
import { sqlite } from "../db.ts";
import { log } from "../logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";

const router = Router();

// =========================================================================
// MCP-Oriented "Smart" APIs
// Mounted flat on /api
// =========================================================================

router.get("/query/contacts", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const fields = req.query.fields as string;
  const role = req.query.role as string;
  const company = req.query.company as string;
  const industry = req.query.industry as string;

  let q = "SELECT * FROM contacts WHERE 1=1";
  const params: any[] = [];
  if (role) { q += " AND role LIKE ?"; params.push(`%${role}%`); }
  if (company) { q += " AND company LIKE ?"; params.push(`%${company}%`); }
  if (industry) { q += " AND industry = ?"; params.push(industry); }
  
  q += " ORDER BY addedAt DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  let rows = sqlite.prepare(q).all(...params) as any[];
  
  if (fields) {
    const allowed = fields.split(',').map(f => f.trim());
    rows = rows.map(r => {
      const projected: any = {};
      for (const k of allowed) if (k in r) projected[k] = r[k];
      return projected;
    });
  }

  log.debug("API", `[${rid}] GET /api/query/contacts → ${rows.length} records`);
  res.json(rows);
}));

router.get("/contacts/action-items", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const now = new Date().toISOString();
  const rows = sqlite.prepare(`
    SELECT * FROM contacts 
    WHERE 
      nextFollowUpAt <= ?
      OR (
         lastContactedAt IS NOT NULL AND cadenceDays > 0 AND 
         datetime(lastContactedAt, '+' || cadenceDays || ' days') <= ?
      )
    ORDER BY lastContactedAt ASC
  `).all(now, now) as any[];
  
  log.debug("API", `[${rid}] GET /api/contacts/action-items → ${rows.length} contacts`);
  res.json(contactRepo.hydrateMany(rows));
}));

router.get("/tags", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const rows = sqlite.prepare("SELECT DISTINCT tag FROM contact_tags ORDER BY tag ASC").all() as {tag:string}[];
  res.json(rows.map(r => r.tag));
}));

router.get("/industries", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const rows = sqlite.prepare("SELECT DISTINCT industry FROM contacts WHERE industry IS NOT NULL AND industry != '' ORDER BY industry ASC").all() as {industry:string}[];
  res.json(rows.map(r => r.industry));
}));

router.get("/interactions/search", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const q = req.query.q as string;
  if (!q) throw new AppError("q parameter is required", 400);
  
  const safeQ = `%${q}%`;
  const type = req.query.type as string;
  
  let sqlQuery = `
    SELECT i.*, c.name as contactName 
    FROM interactions i
    JOIN contacts c ON i.contactId = c.id
    WHERE (i.title LIKE ? OR i.content LIKE ?)
  `;
  const params: any[] = [safeQ, safeQ];
  
  if (type) {
    sqlQuery += " AND i.type = ?";
    params.push(type);
  }
  
  sqlQuery += " ORDER BY i.date DESC LIMIT 50";
  
  const rows = sqlite.prepare(sqlQuery).all(...params);
  log.debug("API", `[${rid}] GET /api/interactions/search → ${rows.length} results`);
  res.json(rows);
}));

// ---------------------------------------------------------------------------
// Global Timeline Feed — Cross-contact activity stream
// ---------------------------------------------------------------------------

router.get("/timeline", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const since = req.query.since as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const type = req.query.type as string;

  let sqlQuery = `
    SELECT i.*, c.name as contactName, c.avatarUrl as contactAvatar, c.themeColor as contactThemeColor
    FROM interactions i
    JOIN contacts c ON i.contactId = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (since) {
    sqlQuery += " AND i.date >= ?";
    params.push(since);
  }

  if (type) {
    sqlQuery += " AND i.type = ?";
    params.push(type);
  }

  sqlQuery += " ORDER BY i.date DESC LIMIT ?";
  params.push(limit);

  const rows = sqlite.prepare(sqlQuery).all(...params);
  log.debug("API", `[${rid}] GET /api/timeline → ${rows.length} entries`);
  res.json(rows);
}));

export const mcpRouter = router;
