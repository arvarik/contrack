const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const path = "/tmp/contrack-review/tx.db";
const fs = require("fs"); for (const f of [path, path+"-wal", path+"-shm", path+".bak"]) { try { fs.unlinkSync(f) } catch {} }
const db = new Database(path); sqliteVec.load(db);
db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY, createdAt TEXT DEFAULT CURRENT_TIMESTAMP)");
db.exec("CREATE TABLE contacts(id TEXT PRIMARY KEY, name TEXT, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT)");
db.exec("CREATE TABLE interactions(id TEXT PRIMARY KEY, contactId TEXT REFERENCES contacts(id) ON DELETE CASCADE, updatedAt TEXT)");
db.exec("INSERT INTO users(id) VALUES ('u1'),('u2')");
db.exec("INSERT INTO contacts VALUES ('c1','A','u1'),('c2','B','u2')");
// 1. VACUUM INTO inside a transaction?
const tx = db.transaction(() => { db.exec(`VACUUM INTO '${path}.bak'`); });
try { tx(); console.log("VACUUM INTO inside transaction: ok"); } catch (e) { console.log("VACUUM INTO inside transaction ERR:", e.message); }
try { db.exec(`VACUUM INTO '${path}.bak'`); console.log("VACUUM INTO outside transaction: ok"); } catch (e) { console.log("VACUUM INTO outside ERR:", e.message); }
// 2. DROP/CREATE vec0 inside transaction
db.exec("CREATE VIRTUAL TABLE se USING vec0(contactId TEXT PRIMARY KEY, embedding FLOAT[4])");
db.prepare("INSERT INTO se(contactId, embedding) VALUES (?,?)").run("c1", Buffer.from(new Float32Array([1,0,0,0]).buffer));
db.prepare("INSERT INTO se(contactId, embedding) VALUES (?,?)").run("c2", Buffer.from(new Float32Array([0,1,0,0]).buffer));
const rebuild = db.transaction(() => {
  const rows = db.prepare("SELECT e.contactId, c.ownerId, e.embedding FROM se e JOIN contacts c ON c.id = e.contactId").all();
  db.exec("DROP TABLE se");
  db.exec("CREATE VIRTUAL TABLE se USING vec0(contactId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY, embedding FLOAT[4])");
  const ins = db.prepare("INSERT INTO se(contactId, ownerId, embedding) VALUES (?,?,?)");
  for (const r of rows) ins.run(r.contactId, r.ownerId, r.embedding);
  return rows.length;
});
try { console.log("vec0 rebuild in tx ok, rows:", rebuild()); } catch (e) { console.log("vec0 rebuild in tx ERR:", e.message); }
console.log("vec0 sql now:", db.prepare("select sql from sqlite_master where name='se'").get().sql);
console.log("vec0 partition detect (LIKE):", db.prepare("select sql LIKE '%PARTITION KEY%' AS p from sqlite_master where name='se'").get().p);
// embedding column read back as blob? 
const r = db.prepare("SELECT contactId, ownerId, embedding FROM se").all(); console.log("readback:", r.map(x => [x.contactId, x.ownerId, x.embedding && x.embedding.length]));
// 3. AFTER INSERT fill trigger + updatedAt trigger interplay
db.exec("ALTER TABLE interactions ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT");
db.exec(`CREATE TRIGGER interactions_updated AFTER UPDATE ON interactions BEGIN UPDATE interactions SET updatedAt = 'touched' WHERE id = NEW.id; END`);
db.exec(`CREATE TRIGGER interactions_owner_fill AFTER INSERT ON interactions WHEN NEW.ownerId IS NULL BEGIN UPDATE interactions SET ownerId = (SELECT ownerId FROM contacts WHERE id = NEW.contactId) WHERE id = NEW.id; END`);
db.exec(`CREATE TRIGGER interactions_owner_check BEFORE INSERT ON interactions WHEN NEW.ownerId IS NOT NULL AND NEW.ownerId != (SELECT ownerId FROM contacts WHERE id = NEW.contactId) BEGIN SELECT RAISE(ABORT, 'interactions.ownerId does not match contact owner'); END`);
db.prepare("INSERT INTO interactions(id, contactId) VALUES ('i1','c1')").run();
console.log("fill trigger:", db.prepare("SELECT ownerId, updatedAt FROM interactions WHERE id='i1'").get());
try { db.prepare("INSERT INTO interactions(id, contactId, ownerId) VALUES ('i2','c1','u2')").run(); console.log("mismatch insert: ALLOWED (bad)"); } catch (e) { console.log("mismatch insert rejected:", e.message); }
// 4. propagate trigger
db.exec(`CREATE TRIGGER contacts_owner_propagate AFTER UPDATE OF ownerId ON contacts WHEN NEW.ownerId IS NOT OLD.ownerId BEGIN UPDATE interactions SET ownerId = NEW.ownerId WHERE contactId = NEW.id; END`);
db.exec("UPDATE contacts SET ownerId = 'u2' WHERE id = 'c1'");
console.log("propagate:", db.prepare("SELECT ownerId FROM interactions WHERE id='i1'").get());
// 5. ON DELETE RESTRICT user with data; cascades fire child triggers?
try { db.exec("DELETE FROM users WHERE id='u2'"); console.log("delete owner with data: ALLOWED (bad)"); } catch (e) { console.log("delete owner with data rejected:", e.message); }
let fired = 0; db.function("bump", () => { fired++; return 1; });
db.exec("CREATE TRIGGER inter_ad AFTER DELETE ON interactions BEGIN SELECT bump(); END");
db.exec("DELETE FROM contacts WHERE id='c1'");
console.log("cascade fired child AFTER DELETE trigger times:", fired, "remaining interactions:", db.prepare("select count(*) c from interactions").get().c);
// 6. user_version
console.log("user_version:", db.pragma("user_version", { simple: true }));
// 7. nested transaction => savepoint
const inner = db.transaction(() => { db.exec("INSERT INTO users(id) VALUES ('u3')"); throw new Error("rollback inner"); });
const outer = db.transaction(() => { db.exec("INSERT INTO users(id) VALUES ('u4')"); try { inner(); } catch {} });
outer(); console.log("users after nested:", db.prepare("select group_concat(id) g from users").get().g);
// 8. FTS with porter tokenizer: does hex owner token survive stemming consistently?
db.exec("CREATE VIRTUAL TABLE f2 USING fts5(name, ownerTok, tokenize='porter unicode61')");
db.prepare("INSERT INTO f2 VALUES (?,?)").run("John", "o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0aed");
console.log("porter token match:", db.prepare("SELECT count(*) c FROM f2 WHERE f2 MATCH ?").get("ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0aed").c);
console.log("porter vocab:", (() => { db.exec("CREATE VIRTUAL TABLE f2v USING fts5vocab(f2, 'row')"); return db.prepare("select term from f2v").all().map(r=>r.term); })());
db.close();
