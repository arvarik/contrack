const Database = require("better-sqlite3");
const db = new Database("/tmp/contrack-review/bench.db");
const n = db.prepare("SELECT COUNT(*) c FROM contacts_fts").get().c;
const ids = db.prepare("SELECT contactId FROM contacts_fts LIMIT 200").all().map(r => r.contactId);
function bench(label, fn, iters) { const t = []; for (let i = 0; i < iters; i++) { const s = process.hrtime.bigint(); fn(i); t.push(Number(process.hrtime.bigint()-s)/1e6); } t.sort((a,b)=>a-b); console.log(`${label.padEnd(64)} p50 ${t[Math.floor(iters*0.5)].toFixed(3).padStart(8)} ms  (fts rows: ${n})`); }
// 1. today's trigger shape: DELETE by UNINDEXED contactId (read-only probe: SELECT with same predicate)
bench("SELECT rowid FROM contacts_fts WHERE contactId = ?  (UNINDEXED, today's trigger)", (i) => db.prepare("SELECT rowid FROM contacts_fts WHERE contactId = ?").all(ids[i % ids.length]), 50);
console.log("EQP:", db.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM contacts_fts WHERE contactId = ?").all("x").map(r=>r.detail).join(" | "));
// 2. build a v2-style table with an indexed cidTok column
db.exec("DROP TABLE IF EXISTS fts2");
db.exec("CREATE VIRTUAL TABLE fts2 USING fts5(contactId UNINDEXED, name, company, role, about, extras, ownerTok, cidTok)");
let s = Date.now();
db.exec("INSERT INTO fts2(contactId,name,company,role,about,extras,ownerTok,cidTok) SELECT c.id,c.name,c.company,c.role,c.about,'','o'||replace(c.ownerId,'-',''),'c'||replace(c.id,'-','') FROM contacts c WHERE c.deletedAt IS NULL");
console.log(`bulk backfill with cidTok: ${Date.now()-s} ms`);
bench("SELECT rowid FROM fts2 WHERE fts2 MATCH 'cidTok:...'  (indexed token)", (i) => db.prepare("SELECT rowid FROM fts2 WHERE fts2 MATCH ?").all("cidTok:c" + ids[i % ids.length].replace(/-/g,"")), 50);
// 3. real DELETE cost both ways inside a transaction (rolled back)
const del1 = db.transaction(() => { const st = db.prepare("DELETE FROM contacts_fts WHERE contactId = ?"); const t0 = process.hrtime.bigint(); for (let i = 0; i < 50; i++) st.run(ids[i]); console.log(`50x DELETE FROM contacts_fts WHERE contactId=? : ${(Number(process.hrtime.bigint()-t0)/1e6).toFixed(1)} ms total`); throw new Error("rollback"); });
try { del1(); } catch {}
const del2 = db.transaction(() => { const st = db.prepare("DELETE FROM fts2 WHERE fts2 MATCH ?"); const t0 = process.hrtime.bigint(); for (let i = 0; i < 50; i++) st.run("cidTok:c" + ids[i].replace(/-/g,"")); console.log(`50x DELETE FROM fts2 WHERE fts2 MATCH 'cidTok:...' : ${(Number(process.hrtime.bigint()-t0)/1e6).toFixed(1)} ms total`); throw new Error("rollback"); });
try { del2(); } catch {}
// 4. bulk owner delete from FTS via MATCH on ownerTok
const owner = db.prepare("SELECT ownerId FROM contacts LIMIT 1").get().ownerId;
const del3 = db.transaction(() => { const t0 = process.hrtime.bigint(); const r = db.prepare("DELETE FROM fts2 WHERE fts2 MATCH ?").run("ownerTok:o" + owner.replace(/-/g,"")); console.log(`DELETE FROM fts2 WHERE MATCH 'ownerTok:...' removed ${r.changes} rows in ${(Number(process.hrtime.bigint()-t0)/1e6).toFixed(1)} ms`); throw new Error("rollback"); });
try { del3(); } catch {}
// 5. purge simulation with cidTok-style triggers: replace triggers to use MATCH on cidTok, then delete one owner
db.exec(`
DROP TRIGGER IF EXISTS contacts_ad; DROP TRIGGER IF EXISTS contacts_au; DROP TRIGGER IF EXISTS contacts_ai; DROP TRIGGER IF EXISTS fts_emails_ai; DROP TRIGGER IF EXISTS fts_emails_ad;
DROP TABLE contacts_fts; ALTER TABLE fts2 RENAME TO contacts_fts;
CREATE TRIGGER contacts_ad AFTER DELETE ON contacts BEGIN DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:c' || replace(old.id,'-',''); END;
CREATE TRIGGER fts_emails_ad AFTER DELETE ON contact_emails BEGIN
  DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:c' || replace(old.contactId,'-','');
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok,cidTok) SELECT c.id,c.name,c.company,c.role,c.about,COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=c.id),''),'o'||replace(c.ownerId,'-',''),'c'||replace(c.id,'-','') FROM contacts c WHERE c.id=old.contactId AND c.deletedAt IS NULL;
END;
CREATE TRIGGER contacts_au AFTER UPDATE ON contacts BEGIN
  DELETE FROM contacts_fts WHERE contacts_fts MATCH 'cidTok:c' || replace(old.id,'-','');
  INSERT INTO contacts_fts(contactId,name,company,role,about,extras,ownerTok,cidTok) SELECT new.id,new.name,new.company,new.role,new.about,COALESCE((SELECT GROUP_CONCAT(email,' ') FROM contact_emails WHERE contactId=new.id),''),'o'||replace(new.ownerId,'-',''),'c'||replace(new.id,'-','') WHERE new.deletedAt IS NULL;
END;`);
const owners = db.prepare("SELECT DISTINCT ownerId FROM contacts").all().map(r=>r.ownerId);
s = Date.now(); db.exec(`UPDATE contacts SET ownerId = '${owners[0]}' WHERE ownerId = '${owners[0]}'`); console.log(`UPDATE ownerId on 5000 rows with cidTok triggers: ${Date.now()-s} ms`);
s = Date.now(); const r = db.prepare("DELETE FROM contacts WHERE ownerId = ?").run(owners[1]); console.log(`purge ${r.changes} contacts (+cascades) with cidTok triggers: ${Date.now()-s} ms`);
console.log("fts rows:", db.prepare("SELECT COUNT(*) c FROM contacts_fts").get().c, "contacts:", db.prepare("SELECT COUNT(*) c FROM contacts").get().c);
db.close();
