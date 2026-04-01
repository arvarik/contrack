import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import cors from "cors";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("curator.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT,
    company TEXT,
    email TEXT,
    phone TEXT,
    location TEXT,
    birthday TEXT,
    preferences TEXT,
    avatarUrl TEXT,
    isPremium INTEGER DEFAULT 0,
    addedAt TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL,
    title TEXT,
    content TEXT,
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    contactId TEXT NOT NULL,
    type TEXT,
    title TEXT,
    date TEXT DEFAULT CURRENT_TIMESTAMP,
    duration TEXT,
    details TEXT,
    FOREIGN KEY (contactId) REFERENCES contacts(id) ON DELETE CASCADE
  );
`);

// Add sources column if it doesn't exist
try {
  db.prepare("ALTER TABLE contacts ADD COLUMN sources TEXT DEFAULT '[]'").run();
} catch (e) {
  // Column likely already exists
}

// Enable foreign keys for cascading deletes
db.pragma('foreign_keys = ON');

// Seed data if empty
const contactCount = db.prepare("SELECT COUNT(*) as count FROM contacts").get() as { count: number };
if (contactCount.count === 0) {
  const julianId = "julian-thorne";
  db.prepare(`
    INSERT INTO contacts (id, name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    julianId,
    "Julian Thorne",
    "Creative Director",
    "Nexus Design Labs",
    "julian@nexus.design",
    "+1 (555) 012-3456",
    "Copenhagen, Denmark",
    "1985-05-12",
    "Single-origin espresso",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBHMk5ZdBFriHiUZujq7KGt4eWmlY8AJg3NkqVmmbfehPWOpZzOuCrSwtOg3QzxjCuYECSx9OHMdH91lagfdbIQie9TzqTTpYrVlnJeW5UiA2ySfWrk1L0Ynzq2Ws2bM4jeUiUM42vXHz1Frud7ePF4bFb9643_YqYsjS0mlna6yaBj5R--9S4HGEq4G5Khxxq0raILPfdJ66fLRp7NJjbSg1AiAUYKSi_Nsyts0nt5Zno78SMmxUjOCnWmFj4R7iQMV2EDrEdziE4",
    1
  );

  db.prepare(`
    INSERT INTO notes (id, contactId, title, content, date)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    "note-1",
    julianId,
    "Nexus Project Phase 1",
    "Discussed the upcoming rebranding. Julian is particularly concerned about the mobile responsiveness of the typography. He mentioned 'Inter' as a potential base font.",
    "2023-10-12T10:00:00Z"
  );

  db.prepare(`
    INSERT INTO activities (id, contactId, type, title, date, duration)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "activity-1",
    julianId,
    "call",
    "Follow-up Call",
    "2023-10-21T14:30:00Z",
    "14 mins"
  );
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // --- API Routes: Contacts ---

  app.get("/api/contacts", (req, res) => {
    try {
      const contacts = db.prepare("SELECT * FROM contacts ORDER BY addedAt DESC").all();
      res.json(contacts);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  app.get("/api/contacts/:id", (req, res) => {
    try {
      const contact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(req.params.id);
      if (!contact) return res.status(404).json({ error: "Contact not found" });
      res.json(contact);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch contact" });
    }
  });

  app.post("/api/contacts", (req, res) => {
    try {
      const id = crypto.randomUUID();
      const { name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium, sources } = req.body;
      
      if (!name) return res.status(400).json({ error: "Name is required" });

      db.prepare(`
        INSERT INTO contacts (id, name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium, sources)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, name, role || null, company || null, email || null, phone || null, 
        location || null, birthday || null, preferences || null, avatarUrl || null, isPremium ? 1 : 0,
        sources ? JSON.stringify(sources) : '[]'
      );
      
      const newContact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(id);
      res.status(201).json(newContact);
    } catch (err) {
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  app.post("/api/contacts/bulk", (req, res) => {
    try {
      const contacts = req.body;
      if (!Array.isArray(contacts)) {
        return res.status(400).json({ error: "Expected an array of contacts" });
      }

      const insert = db.prepare(`
        INSERT INTO contacts (id, name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium, sources)
        VALUES (@id, @name, @role, @company, @email, @phone, @location, @birthday, @preferences, @avatarUrl, @isPremium, @sources)
      `);

      const insertMany = db.transaction((contactsToInsert) => {
        for (const contact of contactsToInsert) {
          if (!contact.name) continue; // Skip invalid contacts
          
          insert.run({
            id: crypto.randomUUID(),
            name: contact.name,
            role: contact.role || null,
            company: contact.company || null,
            email: contact.email || null,
            phone: contact.phone || null,
            location: contact.location || null,
            birthday: contact.birthday || null,
            preferences: contact.preferences || null,
            avatarUrl: contact.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(contact.name)}`,
            isPremium: contact.isPremium ? 1 : 0,
            sources: JSON.stringify(contact.sources || [])
          });
        }
      });

      insertMany(contacts);
      res.status(201).json({ success: true, count: contacts.length });
    } catch (err) {
      console.error("Bulk import error:", err);
      res.status(500).json({ error: "Failed to import contacts" });
    }
  });

  app.put("/api/contacts/:id", (req, res) => {
    try {
      const { name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium } = req.body;
      
      const result = db.prepare(`
        UPDATE contacts 
        SET name = COALESCE(?, name),
            role = COALESCE(?, role),
            company = COALESCE(?, company),
            email = COALESCE(?, email),
            phone = COALESCE(?, phone),
            location = COALESCE(?, location),
            birthday = COALESCE(?, birthday),
            preferences = COALESCE(?, preferences),
            avatarUrl = COALESCE(?, avatarUrl),
            isPremium = COALESCE(?, isPremium)
        WHERE id = ?
      `).run(
        name, role, company, email, phone, location, birthday, preferences, avatarUrl, isPremium !== undefined ? (isPremium ? 1 : 0) : null, req.params.id
      );

      if (result.changes === 0) return res.status(404).json({ error: "Contact not found" });
      
      const updatedContact = db.prepare("SELECT * FROM contacts WHERE id = ?").get(req.params.id);
      res.json(updatedContact);
    } catch (err) {
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  app.delete("/api/contacts/:id", (req, res) => {
    try {
      const result = db.prepare("DELETE FROM contacts WHERE id = ?").run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: "Contact not found" });
      res.json({ success: true, message: "Contact deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  // --- API Routes: Notes ---

  app.get("/api/contacts/:id/notes", (req, res) => {
    try {
      const notes = db.prepare("SELECT * FROM notes WHERE contactId = ? ORDER BY date DESC").all(req.params.id);
      res.json(notes);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.post("/api/contacts/:id/notes", (req, res) => {
    try {
      const id = crypto.randomUUID();
      const contactId = req.params.id;
      const { title, content, date } = req.body;

      if (!content) return res.status(400).json({ error: "Content is required" });

      db.prepare(`
        INSERT INTO notes (id, contactId, title, content, date)
        VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `).run(id, contactId, title || null, content, date || null);

      const newNote = db.prepare("SELECT * FROM notes WHERE id = ?").get(id);
      res.status(201).json(newNote);
    } catch (err) {
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  app.put("/api/notes/:id", (req, res) => {
    try {
      const { title, content } = req.body;
      const result = db.prepare(`
        UPDATE notes 
        SET title = COALESCE(?, title),
            content = COALESCE(?, content)
        WHERE id = ?
      `).run(title, content, req.params.id);

      if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
      
      const updatedNote = db.prepare("SELECT * FROM notes WHERE id = ?").get(req.params.id);
      res.json(updatedNote);
    } catch (err) {
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:id", (req, res) => {
    try {
      const result = db.prepare("DELETE FROM notes WHERE id = ?").run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: "Note not found" });
      res.json({ success: true, message: "Note deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // --- API Routes: Activities ---

  app.get("/api/contacts/:id/activities", (req, res) => {
    try {
      const activities = db.prepare("SELECT * FROM activities WHERE contactId = ? ORDER BY date DESC").all(req.params.id);
      res.json(activities);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });

  app.post("/api/contacts/:id/activities", (req, res) => {
    try {
      const id = crypto.randomUUID();
      const contactId = req.params.id;
      const { type, title, date, duration, details } = req.body;

      if (!title) return res.status(400).json({ error: "Title is required" });

      db.prepare(`
        INSERT INTO activities (id, contactId, type, title, date, duration, details)
        VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)
      `).run(id, contactId, type || 'meeting', title, date || null, duration || null, details || null);

      const newActivity = db.prepare("SELECT * FROM activities WHERE id = ?").get(id);
      res.status(201).json(newActivity);
    } catch (err) {
      res.status(500).json({ error: "Failed to create activity" });
    }
  });

  app.put("/api/activities/:id", (req, res) => {
    try {
      const { type, title, duration, details } = req.body;
      const result = db.prepare(`
        UPDATE activities 
        SET type = COALESCE(?, type),
            title = COALESCE(?, title),
            duration = COALESCE(?, duration),
            details = COALESCE(?, details)
        WHERE id = ?
      `).run(type, title, duration, details, req.params.id);

      if (result.changes === 0) return res.status(404).json({ error: "Activity not found" });
      
      const updatedActivity = db.prepare("SELECT * FROM activities WHERE id = ?").get(req.params.id);
      res.json(updatedActivity);
    } catch (err) {
      res.status(500).json({ error: "Failed to update activity" });
    }
  });

  app.delete("/api/activities/:id", (req, res) => {
    try {
      const result = db.prepare("DELETE FROM activities WHERE id = ?").run(req.params.id);
      if (result.changes === 0) return res.status(404).json({ error: "Activity not found" });
      res.json({ success: true, message: "Activity deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete activity" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
