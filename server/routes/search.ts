import { Router } from "express";
import { AppError } from "../utils/AppError.ts";
import { asyncHandler } from "../utils/asyncHandler.ts";
import { sqlite } from "../db.ts";
import { log } from "../logger.ts";
import { contactRepo } from "../repositories/contactRepository.ts";
import { semanticContactSearch, type CompressedContact } from "../ai/aiService.ts";
import { getCachedSearch, setCachedSearch } from "../searchCache.ts";

const router = Router();

router.get("/", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const q = req.query.q as string;
  if (!q) return res.json([]);
  const safeQ = q.replace(/["']/g, "");
  const results = sqlite.prepare(`
    SELECT c.* FROM contacts c
    JOIN contacts_fts fts ON c.id = fts.contactId
    WHERE contacts_fts MATCH ?
    ORDER BY rank LIMIT 20
  `).all(`"${safeQ}"*`);
  log.debug("API", `[${rid}] GET /api/search?q="${safeQ}" → ${results.length}`);
  res.json(contactRepo.hydrateMany(results));
}));

router.post("/semantic", asyncHandler(async (req, res) => {
  const rid = (req as any).requestId;
  const startTime = Date.now();

  const { query } = req.body as { query?: string };
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new AppError("query is required", 400);
  }
  if (query.trim().length > 500) {
    throw new AppError("query must be ≤ 500 characters", 400);
  }

  // ── Cache lookup ────────────────────────────────────────────────────
  const cached = getCachedSearch(query);
  if (cached) {
    log.info("SemanticSearch", `[${rid}] Cache HIT for "${query.trim().slice(0, 60)}" (${Date.now() - startTime}ms)`);
    return res.json({ ...cached, cached: true });
  }

  const rawContacts = sqlite.prepare(`
    SELECT id, name, role, company, location, about, industry, preferences
    FROM contacts
    WHERE isGhost = 0
  `).all() as Array<{
    id: string; name: string; role: string | null; company: string | null;
    location: string | null; about: string | null; industry: string | null;
    preferences: string | null;
  }>;

  const tagsStmt = sqlite.prepare("SELECT tag FROM contact_tags WHERE contactId = ?");
  const interestsStmt = sqlite.prepare("SELECT interest FROM contact_interests WHERE contactId = ?");

  const rawSize = rawContacts.length;
  const compressed: CompressedContact[] = rawContacts.map(c => {
    const tags = (tagsStmt.all(c.id) as { tag: string }[]).map(t => t.tag);
    const interests = (interestsStmt.all(c.id) as { interest: string }[]).map(t => t.interest);
    
    const entry: CompressedContact = { id: c.id, name: c.name };
    if (c.role)        entry.role        = c.role;
    if (c.company)     entry.company     = c.company;
    if (c.location)    entry.location    = c.location;
    if (c.about)       entry.about       = c.about;
    if (c.industry)    entry.industry    = c.industry;
    if (c.preferences) entry.preferences = c.preferences;
    if (tags.length || interests.length) entry.interests = [...tags, ...interests].join(", ");
    return entry;
  });

  const preBytes  = JSON.stringify(rawContacts).length;
  const postBytes = JSON.stringify(compressed).length;
  log.info("SemanticSearch", `[${rid}] Context: ${rawSize} contacts | ${preBytes}B → ${postBytes}B (${Math.round((1 - postBytes/preBytes) * 100)}% reduction)`);

  let aiMatches: { contact_id: string; reason: string }[] = [];
  let fallback = false;

  try {
    if (compressed.length > 0) {
      aiMatches = await semanticContactSearch(query.trim(), compressed);
    }
  } catch (aiErr: any) {
    log.warn("SemanticSearch", `[${rid}] Gemini failed (${aiErr?.message ?? aiErr}), falling back to FTS5`);
    fallback = true;
  }

  if (!fallback && aiMatches.length > 0) {
    const hydrated = aiMatches
      .map(m => {
        const row = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(m.contact_id);
        if (!row) return null;
        return { ...contactRepo.hydrate(row), aiReason: m.reason };
      })
      .filter(Boolean);

    const elapsed = Date.now() - startTime;
    log.info("SemanticSearch", `[${rid}] "${query}" → ${hydrated.length} AI matches in ${elapsed}ms — caching`);

    // ── Cache successful AI result ────────────────────────────────────
    const result = { matches: hydrated, fallback: false };
    setCachedSearch(query, result);

    return res.json({ ...result, cached: false });
  }

  if (fallback || aiMatches.length === 0) {
    const safeQ = query.trim().replace(/["']/g, "");
    let ftsResults: any[] = [];
    if (safeQ.length > 0) {
      try {
        ftsResults = sqlite.prepare(`
          SELECT c.* FROM contacts c
          JOIN contacts_fts fts ON c.id = fts.contactId
          WHERE contacts_fts MATCH ?
          ORDER BY rank LIMIT 10
        `).all(`"${safeQ}"*`);
      } catch {
        ftsResults = [];
      }
    }
    const matches = ftsResults.map(r => ({ ...contactRepo.hydrate(r), aiReason: null }));
    const elapsed = Date.now() - startTime;
    log.info("SemanticSearch", `[${rid}] FTS5 fallback → ${matches.length} results in ${elapsed}ms (not cached)`);
    // FTS5 fallback is NOT cached — stale fallback results are worse than a fresh miss
    return res.json({ matches, fallback: true, cached: false });
  }

  return res.json({ matches: [], fallback: false, cached: false });
}));

export const searchRouter = router;
