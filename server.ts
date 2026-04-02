import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, sql } from "drizzle-orm";
import morgan from "morgan";
import multer from "multer";
import fs from "fs";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";
import * as schema from "./src/db/schema.ts";
import { parseContactRecord, generateCatchMeUpBriefing, extractMentions, summarizeEmlEmail, semanticContactSearch, type CompressedContact } from "./aiService.ts";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY || GEMINI_KEY === "dummy_key") {
  console.warn("\n\x1b[33m⚠️  [WARNING] GEMINI_API_KEY is not configured inside .env!\x1b[0m");
  console.warn("\x1b[33m   AI features (Briefings, Entity Extraction) will fail gracefully.\x1b[0m\n");
}

const genai = new GoogleGenAI({ apiKey: GEMINI_KEY || "dummy_key" });

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Structured Logger
// ---------------------------------------------------------------------------

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LOG_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[90m",
  INFO:  "\x1b[36m",
  WARN:  "\x1b[33m",
  ERROR: "\x1b[31m",
};
const RESET = "\x1b[0m";

const log = {
  _fmt(level: LogLevel, tag: string, msg: string, meta?: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    const color = LOG_COLORS[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    console.log(`${color}[${ts}] [${level}] [${tag}]${RESET} ${msg}${metaStr}`);
  },
  debug: (tag: string, msg: string, meta?: Record<string, unknown>) => log._fmt("DEBUG", tag, msg, meta),
  info:  (tag: string, msg: string, meta?: Record<string, unknown>) => log._fmt("INFO",  tag, msg, meta),
  warn:  (tag: string, msg: string, meta?: Record<string, unknown>) => log._fmt("WARN",  tag, msg, meta),
  error: (tag: string, msg: string, meta?: Record<string, unknown>) => log._fmt("ERROR", tag, msg, meta),
};

// ---------------------------------------------------------------------------
// Database — fresh creation, no migration needed
// ---------------------------------------------------------------------------

const DB_PATH = "curator.db";
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

log.info("Database", `Opened ${DB_PATH} (WAL mode, foreign keys ON)`);

// Create all tables from scratch
sqlite.exec(`
  -- Core contacts table (all scalar fields)
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    firstName TEXT,
    lastName TEXT,
    headline TEXT,
    role TEXT,
    company TEXT,
    location TEXT,
    birthday TEXT,
    preferences TEXT,
    avatarUrl TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    updatedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    cadenceDays INTEGER DEFAULT 90,
    lastContactedAt TEXT,
    nextFollowUpAt TEXT,
    themeColor TEXT DEFAULT 'brand',
    about TEXT,
    pronouns TEXT,
    industry TEXT,
    website TEXT,
    lat REAL,
    lng REAL,
    aiBriefing TEXT,
    aiBriefingAt TEXT,
    isGhost INTEGER DEFAULT 0
  );

  -- Normalized child tables
  CREATE TABLE IF NOT EXISTS contact_emails (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    label TEXT DEFAULT 'personal',
    isPrimary INTEGER DEFAULT 0,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_phones (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    label TEXT DEFAULT 'mobile',
    isPrimary INTEGER DEFAULT 0,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_social_links (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    handle TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_education (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    school TEXT NOT NULL,
    degree TEXT,
    fieldOfStudy TEXT,
    startDate TEXT,
    endDate TEXT,
    description TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_experience (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    company TEXT NOT NULL,
    role TEXT,
    startDate TEXT,
    endDate TEXT,
    isCurrent INTEGER DEFAULT 0,
    description TEXT,
    location TEXT,
    source TEXT,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_sources (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    externalId TEXT,
    connectedOn TEXT,
    importedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    rawData TEXT
  );

  CREATE TABLE IF NOT EXISTS contact_tags (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS contact_addresses (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    label TEXT DEFAULT 'home',
    isPrimary INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  -- Interactions / timeline
  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    date TEXT DEFAULT (CURRENT_TIMESTAMP),
    duration TEXT,
    fileUrl TEXT,
    fileName TEXT,
    fileType TEXT,
    source TEXT,
    mentions TEXT
  );

  CREATE TABLE IF NOT EXISTS interaction_mentions (
    interactionId TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    PRIMARY KEY (interactionId, contactId)
  );

  -- Lists (user-created contact groups)
  CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'star',
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (CURRENT_TIMESTAMP)
  );

  CREATE TABLE IF NOT EXISTS list_members (
    listId TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    addedAt TEXT DEFAULT (CURRENT_TIMESTAMP),
    PRIMARY KEY (listId, contactId)
  );
`);

log.info("Database", "All tables verified");

// ---------------------------------------------------------------------------
// Migration: isPremium → Starred list
// ---------------------------------------------------------------------------

try {
  // Check if isPremium column still exists
  const colCheck = sqlite.prepare("PRAGMA table_info(contacts)").all() as { name: string }[];
  const hasPremium = colCheck.some(c => c.name === 'isPremium');

  if (hasPremium) {
    // Ensure a "Starred" list exists
    const starredRow = sqlite.prepare("SELECT id FROM lists WHERE name = 'Starred'").get() as { id: string } | undefined;
    let starredId = starredRow?.id;
    if (!starredId) {
      starredId = crypto.randomUUID();
      sqlite.prepare("INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, 'Starred', 'star', 0)").run(starredId);
      log.info("Migration", `Created default 'Starred' list (${starredId})`);
    }

    // Migrate premium contacts into the Starred list
    const premiums = sqlite.prepare("SELECT id FROM contacts WHERE isPremium = 1").all() as { id: string }[];
    if (premiums.length > 0) {
      const insertMember = sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)");
      for (const p of premiums) {
        insertMember.run(starredId, p.id);
      }
      log.info("Migration", `Migrated ${premiums.length} premium contact(s) into 'Starred' list`);
    }

    // Drop the column (SQLite 3.35+)
    try {
      sqlite.exec("ALTER TABLE contacts DROP COLUMN isPremium");
      log.info("Migration", "Dropped isPremium column from contacts table");
    } catch (dropErr: any) {
      log.warn("Migration", `Could not drop isPremium column (may require SQLite 3.35+): ${dropErr.message}`);
    }
  }
} catch (migErr: any) {
  log.warn("Migration", `isPremium migration check skipped: ${migErr.message}`);
}

// ---------------------------------------------------------------------------
// FTS5 Virtual Table & Synchronization Triggers
// ---------------------------------------------------------------------------

try { sqlite.exec(`DROP TABLE IF EXISTS contacts_fts`); } catch { /* may not exist */ }

sqlite.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS contacts_fts USING fts5(
    contactId UNINDEXED, name, company, role, headline, location, about, industry
  );

  DROP TRIGGER IF EXISTS contacts_ai;
  CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
    VALUES (new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry);
  END;

  DROP TRIGGER IF EXISTS contacts_ad;
  CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
  END;

  DROP TRIGGER IF EXISTS contacts_au;
  CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
    DELETE FROM contacts_fts WHERE contactId = old.id;
    INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
    VALUES (new.id, new.name, new.company, new.role, new.headline, new.location, new.about, new.industry);
  END;

  -- Backfill FTS for any contacts not yet indexed
  INSERT INTO contacts_fts(contactId, name, company, role, headline, location, about, industry)
  SELECT id, name, company, role, headline, location, about, industry FROM contacts
  WHERE id NOT IN (SELECT contactId FROM contacts_fts);
`);

log.info("Database", "FTS5 search index ready");

const db = drizzle(sqlite, { schema });

// ---------------------------------------------------------------------------
// Seed data (only if DB is empty)
// ---------------------------------------------------------------------------

// (Use \`npm run seed\` to populate test data if required)

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));

  // Request ID middleware
  app.use((req, _res, next) => {
    (req as any).requestId = crypto.randomUUID().slice(0, 8);
    next();
  });

  // -----------------------------------------------------------------------
  // Uploads
  // -----------------------------------------------------------------------
  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  app.use("/uploads", express.static(uploadDir));

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
    },
  });
  const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

  // -----------------------------------------------------------------------
  // Geocoding queue — 1 req/s for OpenStreetMap Nominatim
  // -----------------------------------------------------------------------
  const geocodeQueue: { contactId: string; location: string }[] = [];
  let isGeocoding = false;

  async function processGeocodeQueue(): Promise<void> {
    if (isGeocoding || geocodeQueue.length === 0) return;
    isGeocoding = true;

    while (geocodeQueue.length > 0) {
      const task = geocodeQueue.shift()!;
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(task.location)}`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ContrackCRM geocoder; +https://github.com/contrack)",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });
        const data = await response.json();
        if (data?.[0]) {
          const lat = parseFloat(data[0].lat);
          const lng = parseFloat(data[0].lon);
          db.update(schema.contacts).set({ lat, lng }).where(eq(schema.contacts.id, task.contactId)).run();
          log.info("Geocode", `"${task.location}" → ${lat}, ${lng}`);
        } else {
          log.warn("Geocode", `No results for "${task.location}"`);
        }
      } catch (err: any) {
        log.error("Geocode", `Failed for "${task.location}"`, { error: err.message });
      }
      await new Promise(r => setTimeout(r, 1100));
    }
    isGeocoding = false;
  }

  function queueGeocode(contactId: string, location: string): void {
    if (!location) return;
    geocodeQueue.push({ contactId, location });
    processGeocodeQueue();
  }

  // Retroactively geocode existing contacts that have a location but no coordinates
  // (runs once at startup, deferred 2s to let the server finish booting)
  setTimeout(() => {
    const ungeocoded = sqlite.prepare(
      "SELECT id, location FROM contacts WHERE location IS NOT NULL AND location != '' AND (lat IS NULL OR lng IS NULL)"
    ).all() as { id: string; location: string }[];

    if (ungeocoded.length > 0) {
      log.info("Geocode", `Queuing ${ungeocoded.length} existing contact(s) for startup geocoding`);
      for (const c of ungeocoded) {
        queueGeocode(c.id, c.location);
      }
    }
  }, 2000);

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Map request body to contacts table columns. Always stamps updatedAt. */
  function buildContactUpdate(body: Record<string, unknown>) {
    const fields = [
      'name', 'firstName', 'lastName', 'headline', 'role', 'company',
      'location', 'birthday', 'preferences', 'avatarUrl', 'cadenceDays',
      'lastContactedAt', 'nextFollowUpAt', 'themeColor', 'about',
      'pronouns', 'industry', 'website',
    ] as const;

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const f of fields) {
      if (body[f] !== undefined) update[f] = body[f];
    }
    return update;
  }

  /** JOIN all child tables onto a flat contact row to produce the hydrated API shape. */
  function hydrateContact(contact: any): any {
    if (!contact) return contact;
    return {
      ...contact,
      emails: sqlite.prepare("SELECT id, email, label, isPrimary, source FROM contact_emails WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((e: any) => ({ ...e, isPrimary: !!e.isPrimary })),
      phones: sqlite.prepare("SELECT id, phone, label, isPrimary, source FROM contact_phones WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((p: any) => ({ ...p, isPrimary: !!p.isPrimary })),
      socialLinks: sqlite.prepare("SELECT id, platform, url, handle, source FROM contact_social_links WHERE contactId = ?").all(contact.id),
      education: sqlite.prepare("SELECT id, school, degree, fieldOfStudy, startDate, endDate, description FROM contact_education WHERE contactId = ?").all(contact.id),
      experience: sqlite.prepare("SELECT id, company, role, startDate, endDate, isCurrent, description, location FROM contact_experience WHERE contactId = ?").all(contact.id).map((e: any) => ({ ...e, isCurrent: !!e.isCurrent })),
      sources: sqlite.prepare("SELECT id, platform, externalId, connectedOn, importedAt FROM contact_sources WHERE contactId = ?").all(contact.id),
      tags: sqlite.prepare("SELECT id, tag FROM contact_tags WHERE contactId = ?").all(contact.id),
      addresses: sqlite.prepare("SELECT id, address, label, isPrimary, source FROM contact_addresses WHERE contactId = ? ORDER BY isPrimary DESC").all(contact.id).map((a: any) => ({ ...a, isPrimary: !!a.isPrimary })),
      lists: sqlite.prepare(`
        SELECT l.id, l.name, l.icon FROM lists l
        JOIN list_members lm ON l.id = lm.listId
        WHERE lm.contactId = ?
        ORDER BY l.sortOrder ASC
      `).all(contact.id),
    };
  }

  function detectPlatformFromUrl(url: string): string {
    const l = url.toLowerCase();
    if (l.includes('linkedin.com')) return 'linkedin';
    if (l.includes('facebook.com') || l.includes('fb.com')) return 'facebook';
    if (l.includes('twitter.com') || l.includes('x.com')) return 'twitter';
    if (l.includes('github.com')) return 'github';
    if (l.includes('instagram.com')) return 'instagram';
    return 'other';
  }

  function extractHandleFromUrl(url: string): string | null {
    try {
      const segments = new URL(url).pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      return last && last !== 'in' && last !== 'profile.php' ? last : null;
    } catch { return null; }
  }

  /** Insert child records (emails, phones, socialLinks, education, experience, tags, sources) inside a transaction. */
  function insertChildRecords(contactId: string, body: any, sourceName = 'manual'): void {
    if (Array.isArray(body.emails)) {
      for (let i = 0; i < body.emails.length; i++) {
        const e = body.emails[i];
        const email = (typeof e === 'string' ? e : e.email)?.trim();
        if (!email) continue;
        sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId, email,
          (typeof e === 'object' ? e.label : 'personal') || 'personal',
          typeof e === 'object' ? (e.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          sourceName,
        );
      }
    }
    if (Array.isArray(body.phones)) {
      for (let i = 0; i < body.phones.length; i++) {
        const p = body.phones[i];
        const phone = (typeof p === 'string' ? p : p.phone)?.trim();
        if (!phone) continue;
        sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId, phone,
          (typeof p === 'object' ? p.label : 'mobile') || 'mobile',
          typeof p === 'object' ? (p.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          sourceName,
        );
      }
    }
    if (Array.isArray(body.socialLinks)) {
      for (const sl of body.socialLinks) {
        const url = (typeof sl === 'string' ? sl : sl.url)?.trim();
        if (!url) continue;
        const platform = typeof sl === 'object' && sl.platform ? sl.platform : detectPlatformFromUrl(url);
        sqlite.prepare("INSERT INTO contact_social_links (id, contactId, platform, url, handle, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId, platform, url,
          typeof sl === 'object' ? sl.handle || extractHandleFromUrl(url) : extractHandleFromUrl(url),
          sourceName,
        );
      }
    }
    if (Array.isArray(body.education)) {
      for (const edu of body.education) {
        if (!edu?.school) continue;
        sqlite.prepare("INSERT INTO contact_education (id, contactId, school, degree, fieldOfStudy, startDate, endDate, description, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId,
          edu.school, edu.degree || null, edu.fieldOfStudy || null,
          edu.startDate || null, edu.endDate || null,
          edu.description || null, sourceName,
        );
      }
    }
    if (Array.isArray(body.experience)) {
      for (const exp of body.experience) {
        if (!exp?.company) continue;
        sqlite.prepare("INSERT INTO contact_experience (id, contactId, company, role, startDate, endDate, isCurrent, description, location, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId,
          exp.company, exp.role || null,
          exp.startDate || null, exp.endDate || null,
          exp.isCurrent ? 1 : 0, exp.description || null,
          exp.location || null, sourceName,
        );
      }
    }
    if (Array.isArray(body.tags)) {
      for (const tag of body.tags) {
        const val = (typeof tag === 'string' ? tag : tag.tag)?.trim();
        if (!val) continue;
        sqlite.prepare("INSERT INTO contact_tags (id, contactId, tag) VALUES (?, ?, ?)").run(crypto.randomUUID(), contactId, val);
      }
    }
    if (Array.isArray(body.sources)) {
      for (const src of body.sources) {
        const platform = typeof src === 'string' ? src : src.platform;
        if (!platform) continue;
        sqlite.prepare("INSERT INTO contact_sources (id, contactId, platform, externalId, connectedOn, rawData) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId, platform,
          typeof src === 'object' ? src.externalId || null : null,
          typeof src === 'object' ? src.connectedOn || null : null,
          typeof src === 'object' ? src.rawData || null : null,
        );
      }
    }
    if (Array.isArray(body.addresses)) {
      for (let i = 0; i < body.addresses.length; i++) {
        const a = body.addresses[i];
        const address = (typeof a === 'string' ? a : a.address)?.trim();
        if (!address) continue;
        sqlite.prepare("INSERT INTO contact_addresses (id, contactId, address, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), contactId, address,
          (typeof a === 'object' ? a.label : 'home') || 'home',
          typeof a === 'object' ? (a.isPrimary ? 1 : 0) : (i === 0 ? 1 : 0),
          sourceName,
        );
      }
    }
  }

  /** Replace-strategy upsert for child arrays on PUT: delete all + re-insert. */
  function replaceChildArray(contactId: string, table: string, body: any[], inserter: (row: any, i: number) => void): void {
    sqlite.prepare(`DELETE FROM ${table} WHERE contactId = ?`).run(contactId);
    body.forEach((row, i) => inserter(row, i));
  }

  // =======================================================================
  // Dedupe Engine: Levenshtein Distance & Phone Normalization
  // =======================================================================

  /** Classic DP Levenshtein distance. */
  function levenshteinDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  /** Normalized 0→1 similarity score (1 = identical). */
  function nameSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const la = a.toLowerCase().trim();
    const lb = b.toLowerCase().trim();
    if (la === lb) return 1;
    const maxLen = Math.max(la.length, lb.length);
    if (maxLen === 0) return 1;
    return 1 - levenshteinDistance(la, lb) / maxLen;
  }

  /** Strip all non-digits. Returns the last 10 digits to normalize country-code variants. */
  function normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  // =======================================================================
  // API Routes
  // =======================================================================

  // -- Static routes BEFORE parameterised routes to prevent shadowing ------

  app.get("/api/utils/unfurl", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const targetUrl = req.query.url as string;
      if (!targetUrl) return res.status(400).json({ error: "Missing link URL" });

      // Timeout execution natively mapping out hang states 
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const htmlRes = await fetch(targetUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      const htmlText = await htmlRes.text();
      const $ = cheerio.load(htmlText);

      const title = $('meta[property="og:title"]').attr('content') || $('title').text() || targetUrl;
      const description = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';
      let image = $('meta[property="og:image"]').attr('content') || '';
      
      // Map relative URL formats properly mapped 
      if (image && image.startsWith('/')) {
        const urlObj = new URL(targetUrl);
        image = `${urlObj.origin}${image}`;
      }

      log.debug("API", `[${rid}] GET /api/utils/unfurl extracted ${title}`);
      res.json({ title, description, image, url: targetUrl });
    } catch (err: any) {
      log.error("API", `[${rid}] /unfurl failed on ${req.query.url}: ${err.message}`);
      res.status(500).json({ error: "Unfurl failed parsing target host", url: req.query.url });
    }
  });

  app.get("/api/contacts/map", (req, res) => {
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

  app.get("/api/search", (req, res) => {
    const rid = (req as any).requestId;
    try {
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
      res.json(results.map(hydrateContact));
    } catch (err: any) {
      log.error("API", `[${rid}] GET /api/search failed`, { error: err.message });
      res.status(500).json({ error: "Search failed" });
    }
  });

  // ── Lists CRUD ──────────────────────────────────────────────────────────────

  /** GET /api/lists — Fetch all lists with member counts, ordered by sortOrder */
  app.get("/api/lists", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const lists = sqlite.prepare(`
        SELECT l.*, COUNT(lm.contactId) as memberCount
        FROM lists l
        LEFT JOIN list_members lm ON l.id = lm.listId
        GROUP BY l.id
        ORDER BY l.sortOrder ASC, l.createdAt ASC
      `).all();
      log.debug("API", `[${rid}] GET /api/lists → ${lists.length}`);
      res.json(lists);
    } catch (err: any) {
      log.error("API", `[${rid}] GET /api/lists failed`, { error: err.message });
      res.status(500).json({ error: "Failed to fetch lists" });
    }
  });

  /** POST /api/lists — Create a new list */
  app.post("/api/lists", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { name, icon } = req.body;
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: "List name is required" });
      }
      // Get next sortOrder
      const maxOrder = sqlite.prepare("SELECT MAX(sortOrder) as maxOrder FROM lists").get() as { maxOrder: number | null };
      const sortOrder = (maxOrder?.maxOrder ?? -1) + 1;
      const id = crypto.randomUUID();
      sqlite.prepare("INSERT INTO lists (id, name, icon, sortOrder) VALUES (?, ?, ?, ?)").run(
        id, name.trim(), icon || 'star', sortOrder
      );
      const list = sqlite.prepare("SELECT *, 0 as memberCount FROM lists WHERE id = ?").get(id);
      log.info("API", `[${rid}] POST /api/lists → "${name.trim()}" (${id})`);
      res.status(201).json(list);
    } catch (err: any) {
      log.error("API", `[${rid}] POST /api/lists failed`, { error: err.message });
      res.status(500).json({ error: "Failed to create list" });
    }
  });

  /** DELETE /api/lists/:id — Delete a list (cascade removes memberships) */
  app.delete("/api/lists/:id", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { id } = req.params;
      const existing = sqlite.prepare("SELECT id, name FROM lists WHERE id = ?").get(id) as { id: string; name: string } | undefined;
      if (!existing) {
        log.warn("API", `[${rid}] DELETE /api/lists/${id} — not found (idempotent OK)`);
        return res.json({ success: true, message: "List not found (already deleted)" });
      }
      sqlite.prepare("DELETE FROM lists WHERE id = ?").run(id);
      log.info("API", `[${rid}] DELETE /api/lists/${id} → deleted "${existing.name}"`);
      res.json({ success: true, message: `Deleted list "${existing.name}"` });
    } catch (err: any) {
      log.error("API", `[${rid}] DELETE /api/lists/${req.params.id} failed`, { error: err.message });
      res.status(500).json({ error: "Failed to delete list" });
    }
  });

  /** PUT /api/lists/reorder — Reorder lists by providing an ordered array of list IDs */
  app.put("/api/lists/reorder", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { orderedIds } = req.body as { orderedIds?: string[] };
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: "orderedIds array is required" });
      }
      const updateStmt = sqlite.prepare("UPDATE lists SET sortOrder = ? WHERE id = ?");
      const txn = sqlite.transaction(() => {
        for (let i = 0; i < orderedIds.length; i++) {
          updateStmt.run(i, orderedIds[i]);
        }
      });
      txn();
      log.info("API", `[${rid}] PUT /api/lists/reorder → ${orderedIds.length} lists reordered`);
      res.json({ success: true });
    } catch (err: any) {
      log.error("API", `[${rid}] PUT /api/lists/reorder failed`, { error: err.message });
      res.status(500).json({ error: "Failed to reorder lists" });
    }
  });

  /** POST /api/lists/:id/members — Add a contact to a list (idempotent) */
  app.post("/api/lists/:id/members", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { id } = req.params;
      const { contactId } = req.body;
      if (!contactId) return res.status(400).json({ error: "contactId is required" });

      const list = sqlite.prepare("SELECT id FROM lists WHERE id = ?").get(id);
      if (!list) return res.status(404).json({ error: "List not found" });

      const contact = sqlite.prepare("SELECT id FROM contacts WHERE id = ?").get(contactId);
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)").run(id, contactId);
      log.info("API", `[${rid}] POST /api/lists/${id}/members → added ${contactId}`);
      res.json({ success: true });
    } catch (err: any) {
      log.error("API", `[${rid}] POST /api/lists/${req.params.id}/members failed`, { error: err.message });
      res.status(500).json({ error: "Failed to add member" });
    }
  });

  /** DELETE /api/lists/:id/members/:contactId — Remove a contact from a list (idempotent) */
  app.delete("/api/lists/:id/members/:contactId", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { id, contactId } = req.params;
      sqlite.prepare("DELETE FROM list_members WHERE listId = ? AND contactId = ?").run(id, contactId);
      log.info("API", `[${rid}] DELETE /api/lists/${id}/members/${contactId} → removed`);
      res.json({ success: true });
    } catch (err: any) {
      log.error("API", `[${rid}] DELETE /api/lists/${req.params.id}/members/${req.params.contactId} failed`, { error: err.message });
      res.status(500).json({ error: "Failed to remove member" });
    }
  });

  // ── Semantic RAG Search ────────────────────────────────────────────────────
  // POST /api/search/semantic
  // Accepts a natural-language query, compresses active contacts into a slim
  // JSON context, passes to Gemini, returns matched contacts + AI reasons.
  // Falls back to FTS5 keyword search on any AI error (incl. 429 rate-limits).

  app.post("/api/search/semantic", async (req, res) => {
    const rid = (req as any).requestId;
    const startTime = Date.now();
    try {
      const { query } = req.body as { query?: string };
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ error: "query is required" });
      }
      if (query.trim().length > 500) {
        return res.status(400).json({ error: "query must be ≤ 500 characters" });
      }

      // 1. Fetch lightweight contact projection (active/non-ghost only)
      const rawContacts = sqlite.prepare(`
        SELECT id, name, role, company, location, about, industry, preferences
        FROM contacts
        WHERE isGhost = 0
      `).all() as Array<{
        id: string; name: string; role: string | null; company: string | null;
        location: string | null; about: string | null; industry: string | null;
        preferences: string | null;
      }>;

      // 2. Denormalize tags → interests field per contact
      const tagsStmt = sqlite.prepare("SELECT tag FROM contact_tags WHERE contactId = ?");

      // 3. Build null-stripped CompressedContact array (reduces token payload ~50%)
      const rawSize = rawContacts.length;
      const compressed: CompressedContact[] = rawContacts.map(c => {
        const tags = (tagsStmt.all(c.id) as { tag: string }[]).map(t => t.tag);
        const entry: CompressedContact = { id: c.id, name: c.name };
        if (c.role)        entry.role        = c.role;
        if (c.company)     entry.company     = c.company;
        if (c.location)    entry.location    = c.location;
        if (c.about)       entry.about       = c.about;
        if (c.industry)    entry.industry    = c.industry;
        if (c.preferences) entry.preferences = c.preferences;
        if (tags.length)   entry.interests   = tags.join(", ");
        return entry;
      });

      const preBytes  = JSON.stringify(rawContacts).length;
      const postBytes = JSON.stringify(compressed).length;
      log.info("SemanticSearch", `[${rid}] Context: ${rawSize} contacts | ${preBytes}B → ${postBytes}B (${Math.round((1 - postBytes/preBytes) * 100)}% reduction)`);

      // 4. Call Gemini semantic search
      let aiMatches: { contact_id: string; reason: string }[] = [];
      let fallback = false;

      try {
        aiMatches = await semanticContactSearch(query.trim(), compressed);
      } catch (aiErr: any) {
        // Rate-limited (429) or any other AI error → fall back to FTS5
        log.warn("SemanticSearch", `[${rid}] Gemini failed (${aiErr?.message ?? aiErr}), falling back to FTS5`);
        fallback = true;
      }

      // 5. Hydrate AI-matched contacts
      if (!fallback && aiMatches.length > 0) {
        const reasonMap = new Map(aiMatches.map(m => [m.contact_id, m.reason]));
        const hydrated = aiMatches
          .map(m => {
            const row = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(m.contact_id);
            if (!row) return null;
            return { ...hydrateContact(row), aiReason: m.reason };
          })
          .filter(Boolean);

        const elapsed = Date.now() - startTime;
        log.info("SemanticSearch", `[${rid}] "${query}" → ${hydrated.length} AI matches in ${elapsed}ms`);
        return res.json({ matches: hydrated, fallback: false });
      }

      // 6. FTS5 fallback path
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
            // FTS also failed — return empty
            ftsResults = [];
          }
        }
        const matches = ftsResults.map(r => ({ ...hydrateContact(r), aiReason: null }));
        const elapsed = Date.now() - startTime;
        log.info("SemanticSearch", `[${rid}] FTS5 fallback → ${matches.length} results in ${elapsed}ms`);
        return res.json({ matches, fallback: true });
      }

      // No matches — AI returned empty array
      return res.json({ matches: [], fallback: false });
    } catch (err: any) {
      log.error("SemanticSearch", `[${rid}] Unhandled error: ${err.message}`);
      res.status(500).json({ error: "Semantic search failed" });
    }
  });

  // -- Contacts CRUD -------------------------------------------------------

  app.get("/api/contacts", (req, res) => {
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

  app.get("/api/contacts/:id", (req, res) => {
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

  app.post("/api/contacts", (req, res) => {
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
      if (body.location) queueGeocode(id, body.location);

      log.info("API", `[${rid}] POST /api/contacts → "${body.name}" (${id})`);
      res.status(201).json(hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(id)));
    } catch (err: any) {
      log.error("API", `[${rid}] POST /api/contacts failed`, { error: err.message });
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  app.post("/api/contacts/bulk", (req, res) => {
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

  app.post("/api/parse-contact", async (req, res) => {
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

  app.put("/api/contacts/:id", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { id } = req.params;
      const body = req.body;

      const txn = sqlite.transaction(() => {
        // Scalar fields
        db.update(schema.contacts).set(buildContactUpdate(body)).where(eq(schema.contacts.id, id)).run();

        // Child array replacements (only if the key is sent)
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
      if (body.location !== undefined) queueGeocode(id, body.location);
      log.info("API", `[${rid}] PUT /api/contacts/${id} → updated`);
      res.json(updated);
    } catch (err: any) {
      log.error("API", `[${rid}] PUT /api/contacts/${req.params.id} failed`, { error: err.message });
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.delete("/api/contacts/:id", async (req, res) => {
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

  // -- Interactions / Timeline ----------------------------------------------

  app.get("/api/contacts/:id/timeline", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const items = sqlite.prepare(`
        SELECT i.*, 
          CASE WHEN i.contactId != ? THEN original.name ELSE NULL END as isViaName,
          CASE WHEN i.contactId != ? THEN i.contactId ELSE NULL END as isViaId
        FROM interactions i
        LEFT JOIN contacts original ON i.contactId = original.id
        WHERE i.contactId = ? OR i.id IN (SELECT interactionId FROM interaction_mentions WHERE contactId = ?)
        ORDER BY i.date DESC
      `).all(req.params.id, req.params.id, req.params.id, req.params.id);
      res.json(items);
    } catch (err: any) {
      log.error("API", `[${rid}] GET timeline failed`, { error: err.message });
      res.status(500).json({ error: "Failed to fetch timeline" });
    }
  });

  app.post("/api/contacts/:id/interactions", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const contactId = req.params.id;
      const { type, title, content, date, duration, source } = req.body;
      if (!title) return res.status(400).json({ error: "Title is required" });

      const validTypes = ["note", "call", "meeting", "email", "message", "sms", "import", "linkedin", "facebook"];
      if (!type || !validTypes.includes(type)) return res.status(400).json({ error: `Valid type required: ${validTypes.join(', ')}` });

      const id = crypto.randomUUID();
      const now = date || new Date().toISOString();

      const result = db.insert(schema.interactions).values({
        id, contactId, type, title,
        content: content || null, date: now,
        duration: duration || null, source: source || null,
      }).returning().get();

      if (content) {
        const mentionRegex = /data-type="mention"\s+data-id="([^"]+)"/g;
        const explicitMentionIds = [...content.matchAll(mentionRegex)].map(m => m[1]);
        if (explicitMentionIds.length > 0) {
          const insertStmt = sqlite.prepare("INSERT OR IGNORE INTO interaction_mentions (interactionId, contactId) VALUES (?, ?)");
          for (const mId of explicitMentionIds) {
            insertStmt.run(id, mId);
          }
        }
      }

      db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: new Date().toISOString(), aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();

      // Non-blocking async ghost extraction
      if (content) {
        setTimeout(async () => {
          try {
            const mentions = await extractMentions(content);
            if (mentions && mentions.length > 0) {
              const mappedMentions = [];
              for (const m of mentions) {
                let existing = db.select().from(schema.contacts).where(eq(schema.contacts.name, m.name)).get();
                if (!existing) {
                  const ghostId = crypto.randomUUID();
                  const newTheme = ["brand", "indigo", "rose", "emerald", "amber"][Math.floor(Math.random() * 5)];
                  existing = db.insert(schema.contacts).values({
                    id: ghostId,
                    name: m.name,
                    company: m.company || null,
                    isGhost: 1,
                    themeColor: newTheme,
                  }).returning().get();
                  log.info("AI Service", `Inferred ghost contact: ${m.name}`);
                }
                mappedMentions.push({
                  contactId: existing.id,
                  name: existing.name,
                  context: m.context,
                  isGhost: existing.isGhost === 1
                });
              }
              db.update(schema.interactions).set({ mentions: JSON.stringify(mappedMentions) }).where(eq(schema.interactions.id, id)).run();
            }
          } catch(e: any) {
            log.error("AI Service", "Background extraction failed", {error: e.message});
          }
        }, 0);
      }

      log.info("API", `[${rid}] POST interaction → ${type} "${title}"`);
      res.status(201).json(result);
    } catch (err: any) {
      log.error("API", `[${rid}] POST interaction failed`, { error: err.message });
      res.status(500).json({ error: "Failed to create interaction" });
    }
  });

  app.post("/api/contacts/:id/briefing", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const contactId = req.params.id;
      const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      // Fetch the most recent 15 interactions
      const recentInteractions = db.select()
        .from(schema.interactions)
        .where(eq(schema.interactions.contactId, contactId))
        .orderBy(sql`${schema.interactions.date} DESC`)
        .limit(15)
        .all();

      const points = await generateCatchMeUpBriefing(contact, recentInteractions);
      const now = new Date().toISOString();

      // Cache it locally
      db.update(schema.contacts).set({
        aiBriefing: JSON.stringify(points),
        aiBriefingAt: now,
        updatedAt: now
      }).where(eq(schema.contacts.id, contactId)).run();

      log.info("API", `[${rid}] POST briefing generated for ${contactId}`);
      res.json({ points });
    } catch (err: any) {
      log.error("API", `[${rid}] POST briefing failed`, { error: err.message });
      res.status(500).json({ error: "Failed to generate briefing" });
    }
  });

  app.post("/api/contacts/:id/promote", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const contactId = req.params.id;
      const contact = db.select().from(schema.contacts).where(eq(schema.contacts.id, contactId)).get();
      if (!contact) return res.status(404).json({ error: "Contact not found" });

      const updated = db.update(schema.contacts).set({ isGhost: 0, updatedAt: new Date().toISOString() }).where(eq(schema.contacts.id, contactId)).returning().get();
      log.info("API", `[${rid}] Promoted ghost contact: ${contact.name}`);
      res.json(updated);
    } catch (err: any) {
      log.error("API", `[${rid}] POST promote failed`, { error: err.message });
      res.status(500).json({ error: "Failed to promote contact" });
    }
  });

  app.post("/api/contacts/:id/attachments", upload.single("attachment"), async (req, res) => {
    const rid = (req as any).requestId;
    try {
      if (!req.file) return res.status(400).json({ error: "No file" });
      const contactId = req.params.id;
      const now = new Date().toISOString();

      if (req.file.originalname.toLowerCase().endsWith('.eml')) {
        const rawEml = fs.readFileSync(req.file.path, 'utf8');
        const summaryHtml = await summarizeEmlEmail(rawEml);
        
        const result = db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId, type: "email",
          title: `Email Import: ${req.file.originalname.replace('.eml', '')}`, date: now,
          content: summaryHtml,
          fileUrl: `/uploads/${req.file.filename}`,
          fileName: req.file.originalname, fileType: "message/rfc822",
        }).returning().get();

        db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();
        log.info("API", `[${rid}] POST EML thread processed → "${req.file.originalname}"`);
        return res.status(201).json(result);
      }

      const result = db.insert(schema.interactions).values({
        id: crypto.randomUUID(), contactId, type: "note",
        title: `Attached File: ${req.file.originalname}`, date: now,
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: req.file.originalname, fileType: req.file.mimetype,
      }).returning().get();

      db.update(schema.contacts).set({ lastContactedAt: now, updatedAt: now, aiBriefing: null, aiBriefingAt: null }).where(eq(schema.contacts.id, contactId)).run();

      log.info("API", `[${rid}] POST attachment → "${req.file.originalname}"`);
      res.status(201).json(result);
    } catch (err: any) {
      log.error("API", `[${rid}] POST attachment failed`, { error: err.message });
      res.status(500).json({ error: "Failed to upload attachment" });
    }
  });

  app.delete("/api/interactions/:id", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const result = await db.delete(schema.interactions).where(eq(schema.interactions.id, req.params.id)).returning();
      if (!result?.length) return res.status(404).json({ error: "Not found" });
      res.json({ success: true });
    } catch (err: any) {
      log.error("API", `[${rid}] DELETE interaction failed`, { error: err.message });
      res.status(500).json({ error: "Failed to delete interaction" });
    }
  });

  // =======================================================================
  // Dedupe API: The Singularity
  // =======================================================================

  /**
   * GET /api/dedupe/suggestions
   * Two-pass de-duplication engine:
   *   Pass 1 (Deterministic): Exact email or phone matches across contacts.
   *   Pass 2 (AI-Assisted):   Fuzzy name/company matches evaluated by Gemini.
   */
  app.get("/api/dedupe/suggestions", async (req, res) => {
    const rid = (req as any).requestId;
    try {
      const allContacts = sqlite.prepare("SELECT * FROM contacts").all() as any[];
      if (allContacts.length < 2) {
        log.debug("Dedupe", `[${rid}] Not enough contacts to dedupe`);
        return res.json([]);
      }

      const suggestions: any[] = [];
      const seenPairs = new Set<string>();
      const pairKey = (a: string, b: string) => [a, b].sort().join('::');

      // ----- Pass 1: Deterministic — exact email overlap ---------------------
      const emailDupes = sqlite.prepare(`
        SELECT e1.contactId AS id1, e2.contactId AS id2, e1.email AS matchedField
        FROM contact_emails e1
        JOIN contact_emails e2
          ON LOWER(TRIM(e1.email)) = LOWER(TRIM(e2.email))
        WHERE e1.contactId < e2.contactId
        GROUP BY e1.contactId, e2.contactId
      `).all() as any[];

      for (const m of emailDupes) {
        const pk = pairKey(m.id1, m.id2);
        if (seenPairs.has(pk)) continue;
        seenPairs.add(pk);
        suggestions.push({
          id: pk,
          contactA: hydrateContact(allContacts.find((c: any) => c.id === m.id1)),
          contactB: hydrateContact(allContacts.find((c: any) => c.id === m.id2)),
          matchType: 'email',
          confidence: 0.98,
          reasoning: `Both contacts share the email address: ${m.matchedField}`,
          matchedField: m.matchedField,
        });
      }

      // ----- Pass 1b: Deterministic — exact phone overlap (normalized) -------
      // SQLite can't strip non-digits easily, so we do this in JS
      const allPhones = sqlite.prepare("SELECT contactId, phone FROM contact_phones").all() as any[];
      const phoneMap = new Map<string, string[]>(); // normalizedPhone → contactIds
      for (const p of allPhones) {
        const norm = normalizePhone(p.phone);
        if (norm.length < 7) continue; // too short to be meaningful
        if (!phoneMap.has(norm)) phoneMap.set(norm, []);
        phoneMap.get(norm)!.push(p.contactId);
      }
      for (const [normPhone, contactIds] of phoneMap) {
        const unique = [...new Set(contactIds)];
        if (unique.length < 2) continue;
        for (let i = 0; i < unique.length; i++) {
          for (let j = i + 1; j < unique.length; j++) {
            const pk = pairKey(unique[i], unique[j]);
            if (seenPairs.has(pk)) continue;
            seenPairs.add(pk);
            // Find the original phone number for display
            const origPhone = allPhones.find(p => p.contactId === unique[i] && normalizePhone(p.phone) === normPhone)?.phone || normPhone;
            suggestions.push({
              id: pk,
              contactA: hydrateContact(allContacts.find((c: any) => c.id === unique[i])),
              contactB: hydrateContact(allContacts.find((c: any) => c.id === unique[j])),
              matchType: 'phone',
              confidence: 0.95,
              reasoning: `Both contacts share the phone number: ${origPhone}`,
              matchedField: origPhone,
            });
          }
        }
      }

      // ----- Pass 2: Fuzzy name/company matching → AI evaluation -------------
      const fuzzyCandidates: { a: any; b: any; sim: number; sameCompany: boolean }[] = [];
      for (let i = 0; i < allContacts.length; i++) {
        for (let j = i + 1; j < allContacts.length; j++) {
          const a = allContacts[i];
          const b = allContacts[j];
          const pk = pairKey(a.id, b.id);
          if (seenPairs.has(pk)) continue;

          const sim = nameSimilarity(a.name, b.name);
          const sameCompany = !!(a.company && b.company &&
            a.company.toLowerCase().trim() === b.company.toLowerCase().trim());

          // Threshold: high name similarity OR moderate name + same company
          if (sim >= 0.70 || (sim >= 0.45 && sameCompany)) {
            fuzzyCandidates.push({ a, b, sim, sameCompany });
          }
        }
      }

      // Sort by similarity desc, limit AI calls to 15 candidates max
      fuzzyCandidates.sort((x, y) => y.sim - x.sim);
      const aiCandidates = fuzzyCandidates.slice(0, 15);

      // If we have an API key, evaluate with Gemini
      if (process.env.GEMINI_API_KEY && aiCandidates.length > 0) {
        log.info("Dedupe", `[${rid}] AI pass: evaluating ${aiCandidates.length} fuzzy candidates`);

        for (const candidate of aiCandidates) {
          try {
            const aHydrated = hydrateContact(candidate.a);
            const bHydrated = hydrateContact(candidate.b);

            const prompt = `You are a contact de-duplication expert. Determine if these two CRM records represent the SAME real-world person.

Contact A:
  Name: ${candidate.a.name}
  Company: ${candidate.a.company || '(none)'}
  Role: ${candidate.a.role || '(none)'}
  Headline: ${candidate.a.headline || '(none)'}
  Location: ${candidate.a.location || '(none)'}
  Emails: ${aHydrated.emails?.map((e: any) => e.email).join(', ') || '(none)'}
  Phones: ${aHydrated.phones?.map((p: any) => p.phone).join(', ') || '(none)'}

Contact B:
  Name: ${candidate.b.name}
  Company: ${candidate.b.company || '(none)'}
  Role: ${candidate.b.role || '(none)'}
  Headline: ${candidate.b.headline || '(none)'}
  Location: ${candidate.b.location || '(none)'}
  Emails: ${bHydrated.emails?.map((e: any) => e.email).join(', ') || '(none)'}
  Phones: ${bHydrated.phones?.map((p: any) => p.phone).join(', ') || '(none)'}

Flagged because: Name similarity = ${(candidate.sim * 100).toFixed(0)}%${candidate.sameCompany ? ', same company' : ''}

Consider nickname variants (Bob/Robert, Bill/William, J./Julian), abbreviations, and professional context. Be conservative — only confirm duplicates you are confident about.`;

            const response = await genai.models.generateContent({
              model: "gemini-2.0-flash",
              contents: prompt,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    isDuplicate: { type: Type.BOOLEAN },
                    confidence: { type: Type.NUMBER },
                    reasoning: { type: Type.STRING },
                  },
                  required: ["isDuplicate", "confidence", "reasoning"],
                },
              },
            });

            const text = response.text;
            if (!text) continue;
            const parsed = JSON.parse(text);

            if (parsed.isDuplicate && parsed.confidence >= 0.6) {
              const pk = pairKey(candidate.a.id, candidate.b.id);
              seenPairs.add(pk);
              suggestions.push({
                id: pk,
                contactA: aHydrated,
                contactB: bHydrated,
                matchType: 'ai',
                confidence: parsed.confidence,
                reasoning: parsed.reasoning,
              });
              log.info("Dedupe", `[${rid}] AI confirmed: "${candidate.a.name}" ≈ "${candidate.b.name}" (${(parsed.confidence * 100).toFixed(0)}%)`);
            } else {
              log.debug("Dedupe", `[${rid}] AI rejected: "${candidate.a.name}" ≠ "${candidate.b.name}"`);
            }
          } catch (aiErr: any) {
            log.warn("Dedupe", `[${rid}] AI evaluation failed for pair`, { error: aiErr.message });
          }
        }
      } else if (aiCandidates.length > 0) {
        log.info("Dedupe", `[${rid}] Skipping AI pass (no GEMINI_API_KEY). ${aiCandidates.length} fuzzy candidates unresolved.`);
        // Still surface high-similarity fuzzy matches without AI confirmation
        for (const candidate of aiCandidates) {
          if (candidate.sim >= 0.80) {
            const pk = pairKey(candidate.a.id, candidate.b.id);
            suggestions.push({
              id: pk,
              contactA: hydrateContact(candidate.a),
              contactB: hydrateContact(candidate.b),
              matchType: 'ai',
              confidence: candidate.sim * 0.7, // lower confidence without AI
              reasoning: `High name similarity (${(candidate.sim * 100).toFixed(0)}%)${candidate.sameCompany ? ' and same company' : ''}. AI evaluation unavailable — set GEMINI_API_KEY for smarter matching.`,
            });
          }
        }
      }

      // Sort: deterministic first (highest confidence), then AI
      suggestions.sort((a: any, b: any) => b.confidence - a.confidence);

      log.info("Dedupe", `[${rid}] GET /api/dedupe/suggestions → ${suggestions.length} suggestions`);
      res.json(suggestions);
    } catch (err: any) {
      log.error("Dedupe", `[${rid}] Suggestion engine failed`, { error: err.message });
      res.status(500).json({ error: "De-duplication engine failed" });
    }
  });

  /**
   * POST /api/contacts/merge
   * Accepts { primaryId, duplicateId }. Within a single SQLite transaction:
   *   1. Reassign all interactions from duplicate → primary
   *   2. Move non-duplicate child records (emails, phones, etc.)
   *   3. Fill missing scalar fields on primary from duplicate
   *   4. Delete the duplicate (CASCADE cleans remaining children)
   * If ANY step fails, the entire transaction rolls back.
   */
  app.post("/api/contacts/merge", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const { primaryId, duplicateId } = req.body;
      if (!primaryId || !duplicateId) return res.status(400).json({ error: "primaryId and duplicateId are required" });
      if (primaryId === duplicateId) return res.status(400).json({ error: "Cannot merge a contact with itself" });

      const primary = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId) as any;
      const duplicate = sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(duplicateId) as any;
      if (!primary) return res.status(404).json({ error: `Primary contact ${primaryId} not found` });
      if (!duplicate) return res.status(404).json({ error: `Duplicate contact ${duplicateId} not found` });

      log.info("Merge", `[${rid}] Merging "${duplicate.name}" → "${primary.name}"`);

      const mergeTxn = sqlite.transaction(() => {
        // 1. Reassign ALL interactions from duplicate to primary
        const movedInteractions = sqlite.prepare(
          "UPDATE interactions SET contactId = ? WHERE contactId = ?"
        ).run(primaryId, duplicateId);
        log.debug("Merge", `  Moved ${movedInteractions.changes} interactions`);

        // 2. Move non-duplicate emails (by normalized email)
        sqlite.prepare(`
          UPDATE contact_emails SET contactId = ?
          WHERE contactId = ?
          AND LOWER(TRIM(email)) NOT IN (
            SELECT LOWER(TRIM(email)) FROM contact_emails WHERE contactId = ?
          )
        `).run(primaryId, duplicateId, primaryId);

        // 3. Move non-duplicate phones (compare normalized digits in JS)
        const primaryPhones = sqlite.prepare("SELECT phone FROM contact_phones WHERE contactId = ?").all(primaryId) as any[];
        const primaryPhoneNorms = new Set(primaryPhones.map(p => normalizePhone(p.phone)));
        const dupePhones = sqlite.prepare("SELECT id, phone FROM contact_phones WHERE contactId = ?").all(duplicateId) as any[];
        for (const dp of dupePhones) {
          if (!primaryPhoneNorms.has(normalizePhone(dp.phone))) {
            sqlite.prepare("UPDATE contact_phones SET contactId = ? WHERE id = ?").run(primaryId, dp.id);
          }
        }

        // 4. Move non-duplicate social links (by platform + url)
        sqlite.prepare(`
          UPDATE contact_social_links SET contactId = ?
          WHERE contactId = ?
          AND (platform || '::' || LOWER(TRIM(url))) NOT IN (
            SELECT platform || '::' || LOWER(TRIM(url)) FROM contact_social_links WHERE contactId = ?
          )
        `).run(primaryId, duplicateId, primaryId);

        // 5. Move ALL education & experience (unlikely to have exact dupes)
        sqlite.prepare("UPDATE contact_education SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);
        sqlite.prepare("UPDATE contact_experience SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);

        // 6. Move ALL source records
        sqlite.prepare("UPDATE contact_sources SET contactId = ? WHERE contactId = ?").run(primaryId, duplicateId);

        // 7. Move non-duplicate tags
        sqlite.prepare(`
          UPDATE contact_tags SET contactId = ?
          WHERE contactId = ?
          AND LOWER(TRIM(tag)) NOT IN (
            SELECT LOWER(TRIM(tag)) FROM contact_tags WHERE contactId = ?
          )
        `).run(primaryId, duplicateId, primaryId);

        // 8. Fill missing scalar fields on primary from duplicate
        const scalarFields = [
          'firstName', 'lastName', 'headline', 'role', 'company', 'location',
          'birthday', 'preferences', 'avatarUrl', 'about', 'pronouns',
          'industry', 'website',
        ];
        const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
        for (const field of scalarFields) {
          if (!primary[field] && duplicate[field]) {
            updates[field] = duplicate[field];
          }
        }
        // Inherit list memberships from duplicate
        const dupLists = sqlite.prepare("SELECT listId FROM list_members WHERE contactId = ?").all(duplicateId) as { listId: string }[];
        const insertMember = sqlite.prepare("INSERT OR IGNORE INTO list_members (listId, contactId) VALUES (?, ?)");
        for (const dl of dupLists) {
          insertMember.run(dl.listId, primaryId);
        }
        // Use the earlier addedAt
        if (duplicate.addedAt && (!primary.addedAt || duplicate.addedAt < primary.addedAt)) {
          updates.addedAt = duplicate.addedAt;
        }

        db.update(schema.contacts).set(updates).where(eq(schema.contacts.id, primaryId)).run();

        // 9. Delete the duplicate — CASCADE removes any remaining children
        sqlite.prepare("DELETE FROM contacts WHERE id = ?").run(duplicateId);
        log.info("Merge", `[${rid}] Merge complete. Deleted duplicate "${duplicate.name}" (${duplicateId})`);
      });

      mergeTxn();

      // Return the freshly hydrated merged contact
      const merged = hydrateContact(sqlite.prepare("SELECT * FROM contacts WHERE id = ?").get(primaryId));
      res.json({ success: true, contact: merged });
    } catch (err: any) {
      log.error("Merge", `[${rid}] Merge failed — transaction rolled back`, { error: err.message });
      res.status(500).json({ error: "Merge failed. No changes were made." });
    }
  });

  /**
   * POST /api/dev/seed-duplicates  ⚠️  Development only
   * Seeds 3 edge-case duplicate pairs for testing the Singularity engine.
   * This endpoint is disabled in production (NODE_ENV=production).
   */
  if (process.env.NODE_ENV !== 'production') {
  app.post("/api/dev/seed-duplicates", (req, res) => {
    const rid = (req as any).requestId;
    try {
      const seedTxn = sqlite.transaction(() => {
        // --- Edge Case 1: Same email as Julian Thorne ---
        const jt2Id = crypto.randomUUID();
        db.insert(schema.contacts).values({
          id: jt2Id, name: "J. Thorne",
          firstName: "J.", lastName: "Thorne",
          role: "Creative Lead", company: "Nexus",
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=jthorne`,
        }).run();
        sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), jt2Id, "julian@nexus.design", "work", 1, "linkedin"
        );
        db.insert(schema.contactSources).values({ id: crypto.randomUUID(), contactId: jt2Id, platform: "linkedin" }).run();
        db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId: jt2Id, type: "note",
          title: "Met at Design Systems Conf",
          content: "Great conversation about component-driven design. Mentioned he runs a studio in Copenhagen.",
          date: "2024-01-15T09:00:00Z",
        }).run();

        // --- Edge Case 2: Phone match with different name format ---
        const robertId = crypto.randomUUID();
        const bobId = crypto.randomUUID();
        db.insert(schema.contacts).values({
          id: robertId, name: "Robert Chen",
          firstName: "Robert", lastName: "Chen",
          role: "VP Engineering", company: "Quantum Labs",
          location: "San Francisco, CA", industry: "Technology",
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=robertchen`,
        }).run();
        sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), robertId, "r.chen@quantumlabs.io", "work", 1, "manual"
        );
        sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), robertId, "+1 (415) 555-9012", "mobile", 1, "manual"
        );
        db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId: robertId, type: "meeting",
          title: "Series A deep dive",
          content: "Walked through their infrastructure scaling plans. Very impressive team.",
          date: "2024-03-10T14:00:00Z",
        }).run();

        db.insert(schema.contacts).values({
          id: bobId, name: "Bob Chen",
          firstName: "Bob", lastName: "Chen",
          role: "VP Eng", company: "Quantum Labs",
          about: "Quantum computing infrastructure expert.",
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=bobchen`,
        }).run();
        sqlite.prepare("INSERT INTO contact_phones (id, contactId, phone, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), bobId, "415-555-9012", "work", 1, "apple"
        );
        db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId: bobId, type: "call",
          title: "Quick sync on hiring",
          content: "Looking for senior distributed systems engineers. Offered to intro Sarah.",
          date: "2024-04-22T11:00:00Z", duration: "8 mins",
        }).run();

        // --- Edge Case 3: Fuzzy name (Sarah vs Sara) + same company ---
        const sarah1Id = crypto.randomUUID();
        const sarah2Id = crypto.randomUUID();
        db.insert(schema.contacts).values({
          id: sarah1Id, name: "Sarah Mitchell",
          firstName: "Sarah", lastName: "Mitchell",
          role: "Head of Product", company: "Aether Systems",
          location: "Austin, TX", headline: "Building the future of spatial computing",
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=sarahmitchell`,
        }).run();
        sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), sarah1Id, "s.mitchell@aether.systems", "work", 1, "manual"
        );
        db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId: sarah1Id, type: "email",
          title: "Product roadmap follow-up",
          content: "Sent over the competitive analysis deck she requested.",
          date: "2024-02-20T16:00:00Z",
        }).run();

        db.insert(schema.contacts).values({
          id: sarah2Id, name: "Sara Mitchell",
          firstName: "Sara", lastName: "Mitchell",
          role: "Product Lead", company: "Aether Systems",
          location: "Austin, Texas",
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=saramitchell`,
        }).run();
        sqlite.prepare("INSERT INTO contact_emails (id, contactId, email, label, isPrimary, source) VALUES (?, ?, ?, ?, ?, ?)").run(
          crypto.randomUUID(), sarah2Id, "sara.m@gmail.com", "personal", 1, "google"
        );
        db.insert(schema.contactSources).values({ id: crypto.randomUUID(), contactId: sarah2Id, platform: "google" }).run();
        db.insert(schema.interactions).values({
          id: crypto.randomUUID(), contactId: sarah2Id, type: "note",
          title: "Coffee catch-up",
          content: "Met at Houndstooth Coffee on South Congress. She is excited about their AR features launching Q3.",
          date: "2024-05-01T10:00:00Z",
        }).run();
      });

      seedTxn();
      log.info("Seed", `[${rid}] Seeded 3 duplicate edge cases (5 new contacts)`);
      res.json({ success: true, message: "Seeded 3 edge-case duplicate pairs" });
    } catch (err: any) {
      log.error("Seed", `[${rid}] Seed failed`, { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });
  } // end dev-only guard

  // =======================================================================
  // Vite middleware (dev) / Static serving (prod)
  // =======================================================================

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  // Global error handler
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error("Unhandled", `[${(req as any).requestId}] ${err.message}`);
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.listen(PORT, "0.0.0.0", () => {
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log.info("Server", `Contrack CRM running on http://localhost:${PORT}`);
    log.info("Server", `Database: ${DB_PATH} | Uploads: ${uploadDir}`);
    log.info("Server", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  });
}

startServer();
