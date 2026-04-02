import { Router } from "express";
import { sqlite } from "../db.ts";
import { log } from "../logger.ts";
import { hydrateContact } from "../helpers.ts";

const router = Router();

// =========================================================================
// MCP-Oriented "Smart" APIs
// Mounted flat on /api
// =========================================================================

router.get("/query/contacts", (req, res) => {
  const rid = (req as any).requestId;
  try {
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
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/query/contacts failed`, { error: err.message });
    res.status(500).json({ error: "Failed to query contacts" });
  }
});

router.get("/contacts/action-items", (req, res) => {
  const rid = (req as any).requestId;
  try {
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
    res.json(rows.map(hydrateContact));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/contacts/action-items failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch action items" });
  }
});

router.get("/tags", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const rows = sqlite.prepare("SELECT DISTINCT tag FROM contact_tags ORDER BY tag ASC").all() as {tag:string}[];
    res.json(rows.map(r => r.tag));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/tags failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch tags" });
  }
});

router.get("/industries", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const rows = sqlite.prepare("SELECT DISTINCT industry FROM contacts WHERE industry IS NOT NULL AND industry != '' ORDER BY industry ASC").all() as {industry:string}[];
    res.json(rows.map(r => r.industry));
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/industries failed`, { error: err.message });
    res.status(500).json({ error: "Failed to fetch industries" });
  }
});

router.get("/interactions/search", (req, res) => {
  const rid = (req as any).requestId;
  try {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: "q parameter is required" });
    
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
  } catch (err: any) {
    log.error("API", `[${rid}] GET /api/interactions/search failed`, { error: err.message });
    res.status(500).json({ error: "Failed to search interactions" });
  }
});

export const mcpRouter = router;
