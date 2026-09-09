const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const crypto = require("crypto");
const p = "/tmp/contrack-review/bench.db";
const fs = require("fs"); for (const f of [p, p+"-wal", p+"-shm"]) { try { fs.unlinkSync(f) } catch {} }
const db = new Database(p); sqliteVec.load(db);
db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL"); db.pragma("foreign_keys = ON"); db.pragma("cache_size = -65536");
const OWNERS = 10, PER = 5000, N = OWNERS * PER;
const owners = Array.from({length: OWNERS}, () => crypto.randomUUID());
const tok = (o) => "o" + o.replace(/-/g, "");
const vocab = ["john","smith","acme","design","engineer","berlin","london","director","studio","labs","maria","garcia","chen","wei","product","marketing","founder","partner","analyst","architect","paris","tokyo","nexus","atlas","orbit","quantum","vertex","harbor","summit","prism"];
const pick = () => vocab[Math.floor(Math.random()*vocab.length)];
db.exec(`
CREATE TABLE users(id TEXT PRIMARY KEY);
CREATE TABLE contacts(id TEXT PRIMARY KEY, name TEXT, company TEXT, role TEXT, about TEXT, deletedAt TEXT, ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT);
CREATE TABLE contact_emails(id INTEGER PRIMARY KEY, contactId TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE, email TEXT);
CREATE INDEX idx_contact_emails_contact ON contact_emails(contactId);
CREATE INDEX idx_contacts_owner_deleted ON contacts(ownerId, deletedAt);
CREATE VIRTUAL TABLE contacts_fts USING fts5(contactId UNINDEXED, name, company, role, about, extras, ownerTok);
CREATE TRIGGER contacts_ai AFTER INSERT ON contacts BEGIN
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok) VALUES (new.id,new.name,new.company,new.role,new.about,
    COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=new.id),''), 'o'||replace(new.ownerId,'-',''));
END;
CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN DELETE FROM contacts_fts WHERE contactId=old.id; END;
CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
  DELETE FROM contacts_fts WHERE contactId=old.id;
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok) SELECT new.id,new.name,new.company,new.role,new.about,
    COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=new.id),''), 'o'||replace(new.ownerId,'-','') WHERE new.deletedAt IS NULL;
END;
CREATE TRIGGER fts_emails_ai AFTER INSERT ON contact_emails BEGIN
  DELETE FROM contacts_fts WHERE contactId=new.contactId;
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok) SELECT c.id,c.name,c.company,c.role,c.about,
    COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=c.id),''), 'o'||replace(c.ownerId,'-','') FROM contacts c WHERE c.id=new.contactId AND c.deletedAt IS NULL;
END;
CREATE TRIGGER fts_emails_ad AFTER DELETE ON contact_emails BEGIN
  DELETE FROM contacts_fts WHERE contactId=old.contactId;
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok) SELECT c.id,c.name,c.company,c.role,c.about,
    COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=c.id),''), 'o'||replace(c.ownerId,'-','') FROM contacts c WHERE c.id=old.contactId AND c.deletedAt IS NULL;
END;
-- post-filter variant for comparison (no triggers, populated directly)
CREATE VIRTUAL TABLE fts_unindexed USING fts5(contactId UNINDEXED, name, company, role, about, extras, ownerId UNINDEXED);
CREATE VIRTUAL TABLE se USING vec0(contactId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY, embedding FLOAT[384]);
CREATE VIRTUAL TABLE se_flat USING vec0(contactId TEXT PRIMARY KEY, embedding FLOAT[384]);
`);
const t0 = Date.now();
db.transaction(() => { for (const o of owners) db.prepare("INSERT INTO users VALUES (?)").run(o); })();
const insC = db.prepare("INSERT INTO contacts(id,name,company,role,about,ownerId) VALUES (?,?,?,?,?,?)");
const insE = db.prepare("INSERT INTO contact_emails(contactId,email) VALUES (?,?)");
const insU = db.prepare("INSERT INTO fts_unindexed(contactId,name,company,role,about,extras,ownerId) VALUES (?,?,?,?,?,?,?)");
const ids = [];
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const id = crypto.randomUUID(), o = owners[i % OWNERS];
    const name = pick()+" "+pick(), company = pick()+" "+pick(), role = pick(), about = Array.from({length:8},pick).join(" ");
    insC.run(id, name, company, role, about, o);
    insE.run(id, pick()+"@"+pick()+".com"); insE.run(id, pick()+"@example.com");
    insU.run(id, name, company, role, about, "", o);
    ids.push([id, o]);
  }
})();
console.log(`seeded ${N} contacts + ${2*N} emails with FTS triggers in ${Date.now()-t0} ms`);
const vec = () => Buffer.from(Float32Array.from({length:384}, () => Math.random()-0.5).buffer);
const t1 = Date.now();
db.transaction(() => { const a = db.prepare("INSERT INTO se(contactId,ownerId,embedding) VALUES (?,?,?)"), b = db.prepare("INSERT INTO se_flat(contactId,embedding) VALUES (?,?)"); for (const [id,o] of ids) { const v = vec(); a.run(id,o,v); b.run(id,v); } })();
console.log(`seeded ${N} x 384-dim vectors into partitioned + flat vec0 in ${Date.now()-t1} ms`);
db.exec("ANALYZE");
function bench(label, fn, iters = 100) { const t = []; for (let i = 0; i < iters; i++) { const s = process.hrtime.bigint(); fn(); t.push(Number(process.hrtime.bigint()-s)/1e6); } t.sort((a,b)=>a-b); console.log(`${label.padEnd(58)} p50 ${t[Math.floor(iters*0.5)].toFixed(2).padStart(7)} ms  p95 ${t[Math.floor(iters*0.95)].toFixed(2).padStart(7)} ms`); }
const o0 = owners[0];
const qTok = db.prepare("SELECT contactId, bm25(contacts_fts,10.0,5.0,3.0,1.0,1.0,0.0) AS s FROM contacts_fts WHERE contacts_fts MATCH ? ORDER BY s LIMIT 50");
const qUn = db.prepare("SELECT contactId, bm25(fts_unindexed,10.0,5.0,3.0,1.0,1.0) AS s FROM fts_unindexed WHERE fts_unindexed MATCH ? AND ownerId = ? ORDER BY s LIMIT 50");
const qJoin = db.prepare("SELECT f.contactId, bm25(fts_unindexed,10.0,5.0,3.0,1.0,1.0) AS s FROM fts_unindexed f JOIN contacts c ON c.id = f.contactId WHERE fts_unindexed MATCH ? AND c.ownerId = ? ORDER BY s LIMIT 50");
const qGlobal = db.prepare("SELECT contactId, bm25(fts_unindexed,10.0,5.0,3.0,1.0,1.0) AS s FROM fts_unindexed WHERE fts_unindexed MATCH ? ORDER BY s LIMIT 50");
for (const q of ['"john"', '"john"* OR "smith"*', 'design OR studio OR labs']) {
  console.log(`\nFTS query: ${q}   (owner rows matched: ${qTok.all(`ownerTok:${tok(o0)} AND (${q})`).length}, global matched: ${qGlobal.all(q).length} of limit 50)`);
  bench(`  indexed ownerTok AND (...)`, () => qTok.all(`ownerTok:${tok(o0)} AND (${q})`));
  bench(`  UNINDEXED ownerId post-filter`, () => qUn.all(q, o0));
  bench(`  JOIN contacts c.ownerId`, () => qJoin.all(q, o0));
  bench(`  no owner filter (today)`, () => qGlobal.all(q));
}
console.log("\nEQP indexed:", db.prepare("EXPLAIN QUERY PLAN SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ?").all(`ownerTok:${tok(o0)} AND (john)`).map(r=>r.detail).join(" | "));
console.log("EQP unindexed:", db.prepare("EXPLAIN QUERY PLAN SELECT contactId FROM fts_unindexed WHERE fts_unindexed MATCH ? AND ownerId = ?").all("john", o0).map(r=>r.detail).join(" | "));
console.log("");
const qv = vec();
const kP = db.prepare("SELECT contactId, distance FROM se WHERE embedding MATCH ? AND k = 50 AND ownerId = ? ORDER BY distance");
const kF = db.prepare("SELECT contactId, distance FROM se_flat WHERE embedding MATCH ? AND k = 50 ORDER BY distance");
const kFbig = db.prepare("SELECT contactId, distance FROM se_flat WHERE embedding MATCH ? AND k = 500 ORDER BY distance");
bench(`vec0 KNN k=50 partitioned (owner has ${PER} of ${N})`, () => kP.all(qv, o0), 30);
bench(`vec0 KNN k=50 flat (today, global over ${N})`, () => kF.all(qv), 30);
bench(`vec0 KNN k=500 flat then JS filter (today's preFilter path)`, () => kFbig.all(qv).filter(r => true), 30);
// how many of the global top-100 belong to owner 0? (correctness claim)
const top100 = db.prepare("SELECT contactId FROM se_flat WHERE embedding MATCH ? AND k = 100").all(qv).map(r=>r.contactId);
const ownerSet = new Set(ids.filter(([,o])=>o===o0).map(([id])=>id));
console.log(`global top-100 rows belonging to owner 0 (expected ~10): ${top100.filter(id=>ownerSet.has(id)).length}`);
console.log("");
// FTS rebuild timing
let s = Date.now();
db.exec("DELETE FROM contacts_fts"); db.exec(`INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok) SELECT c.id,c.name,c.company,c.role,c.about,COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=c.id),''),'o'||replace(c.ownerId,'-','') FROM contacts c WHERE c.deletedAt IS NULL`);
console.log(`FTS full backfill of ${N} rows (with email subselect): ${Date.now()-s} ms`);
// claim re-index cost: UPDATE ownerId on one owner's rows (fires contacts_au per row)
s = Date.now(); db.exec(`UPDATE contacts SET ownerId = '${o0}' WHERE ownerId = '${o0}'`); console.log(`UPDATE contacts SET ownerId on ${PER} rows (contacts_au re-index per row): ${Date.now()-s} ms`);
// vec0 copy-rebuild timing
s = Date.now();
db.transaction(() => { const rows = db.prepare("SELECT e.contactId, c.ownerId, e.embedding FROM se_flat e JOIN contacts c ON c.id = e.contactId").all(); db.exec("DROP TABLE se_flat"); db.exec("CREATE VIRTUAL TABLE se_flat USING vec0(contactId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY, embedding FLOAT[384])"); const ins = db.prepare("INSERT INTO se_flat(contactId,ownerId,embedding) VALUES (?,?,?)"); for (const r of rows) ins.run(r.contactId, r.ownerId, r.embedding); })();
console.log(`vec0 copy-rebuild of ${N} x 384-dim rows: ${Date.now()-s} ms`);
// purge one owner
s = Date.now();
const purge = db.transaction((o) => {
  db.prepare("DELETE FROM se WHERE ownerId = ?").run(o);
  const r = db.prepare("DELETE FROM contacts WHERE ownerId = ?").run(o);
  return r.changes;
});
const n = purge(o0);
console.log(`purge one owner: ${n} contacts (+${2*n} cascaded emails, FTS triggers firing): ${Date.now()-s} ms`);
console.log("fts rows left:", db.prepare("SELECT COUNT(*) c FROM contacts_fts").get().c, " contacts left:", db.prepare("SELECT COUNT(*) c FROM contacts").get().c, " vec rows left:", db.prepare("SELECT COUNT(*) c FROM se").get().c);
// purge variant: delete FTS rows in one statement first? (FTS5 delete via MATCH)
const o1 = owners[1];
s = Date.now();
const purge2 = db.transaction((o) => {
  db.prepare("DELETE FROM se WHERE ownerId = ?").run(o);
  db.prepare("DELETE FROM contact_emails WHERE contactId IN (SELECT id FROM contacts WHERE ownerId = ?)").run(o);
  const r = db.prepare("DELETE FROM contacts WHERE ownerId = ?").run(o);
  return r.changes;
});
const n2 = purge2(o1);
console.log(`purge variant (children explicitly first): ${n2} contacts: ${Date.now()-s} ms`);
db.close();
