const Database = require("better-sqlite3");
const sqliteVec = require("sqlite-vec");
const db = new Database(":memory:");
sqliteVec.load(db);
console.log("vec_version:", db.prepare("select vec_version() as v").get().v);
console.log("sqlite_version:", db.prepare("select sqlite_version() as v").get().v);
console.log("fts5:", db.prepare("select fts5(?)").pluck().get("version") ?? "n/a");
// partition key smoke
db.exec(`CREATE VIRTUAL TABLE t USING vec0(contactId TEXT PRIMARY KEY, ownerId TEXT PARTITION KEY, embedding FLOAT[4])`);
const ins = db.prepare("INSERT INTO t(contactId, ownerId, embedding) VALUES (?, ?, ?)");
const f = (a) => Buffer.from(new Float32Array(a).buffer);
ins.run("a1", "owner-a-uuid", f([1,0,0,0]));
ins.run("a2", "owner-a-uuid", f([0.9,0.1,0,0]));
ins.run("b1", "owner-b-uuid", f([1,0,0,0]));
ins.run("b2", "owner-b-uuid", f([0.99,0.01,0,0]));
const knn = db.prepare("SELECT contactId, distance FROM t WHERE embedding MATCH ? AND k = 10 AND ownerId = ? ORDER BY distance").all(f([1,0,0,0]), "owner-a-uuid");
console.log("knn owner-a:", JSON.stringify(knn));
const knnB = db.prepare("SELECT contactId, distance FROM t WHERE embedding MATCH ? AND k = 10 AND ownerId = ? ORDER BY distance").all(f([1,0,0,0]), "owner-b-uuid");
console.log("knn owner-b:", JSON.stringify(knnB));
// sqlite_master sql
console.log("master sql:", db.prepare("select sql from sqlite_master where name='t'").get().sql);
// delete by partition key
try { const r = db.prepare("DELETE FROM t WHERE ownerId = ?").run("owner-a-uuid"); console.log("delete by partition ok, changes:", r.changes); } catch (e) { console.log("delete by partition ERR:", e.message); }
console.log("count after:", db.prepare("select count(*) as c from t").get().c);
// count with partition filter
try { console.log("count by partition:", db.prepare("select count(*) as c from t where ownerId = ?").get("owner-b-uuid").c); } catch (e) { console.log("count by partition ERR:", e.message); }
// bare select with partition filter (non-KNN)
try { console.log("select by partition:", JSON.stringify(db.prepare("select contactId from t where ownerId = ?").all("owner-b-uuid"))); } catch (e) { console.log("select by partition ERR:", e.message); }
// update partition key?
try { db.prepare("UPDATE t SET ownerId = ? WHERE contactId = ?").run("owner-c", "b1"); console.log("update partition ok"); } catch (e) { console.log("update partition ERR:", e.message); }
// ALTER TABLE RENAME on vec0
try { db.exec("ALTER TABLE t RENAME TO t2"); console.log("rename vec0 ok"); } catch (e) { console.log("rename vec0 ERR:", e.message); }
// FTS5 owner token test
db.exec(`CREATE VIRTUAL TABLE fts USING fts5(contactId UNINDEXED, name, company, ownerTok)`);
const fi = db.prepare("INSERT INTO fts(contactId, name, company, ownerTok) VALUES (?,?,?,?)");
fi.run("a1", "John Smith", "Acme", "o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9");
fi.run("b1", "John Smith", "Acme", "oaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
const q = (m) => { try { return JSON.stringify(db.prepare("SELECT contactId, bm25(fts, 10.0, 5.0, 0.0) AS s FROM fts WHERE fts MATCH ? ORDER BY s").all(m)); } catch (e) { return "ERR " + e.message; } };
console.log("fts and-wrap:", q('ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9 AND ("john smith")'));
console.log("fts prefix strategy:", q('ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9 AND ("john"* OR "smith"*)'));
console.log("fts column-set:", q('ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9 AND ({name company} : (john OR acme))'));
console.log("fts NOT strategy:", q('ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9 AND (john NOT acme)'));
console.log("fts wrong owner:", q('ownerTok:oaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa AND ("john smith")'));
// token tokenization test: does unicode61 keep 'o3f2...' as one token?
console.log("fts token as-is:", q('ownerTok:o3f2c1d0e9a84b7c8d6e5f4a3b2c1d0e9'));
// explain query plan for fts
console.log("eqp fts:", JSON.stringify(db.prepare("EXPLAIN QUERY PLAN SELECT contactId FROM fts WHERE fts MATCH ?").all('ownerTok:x AND (john)')));
// ALTER TABLE ADD COLUMN with REFERENCES while foreign_keys on
db.exec("PRAGMA foreign_keys = ON");
db.exec("CREATE TABLE users(id TEXT PRIMARY KEY)");
db.exec("CREATE TABLE inter(id TEXT PRIMARY KEY, contactId TEXT)");
try { db.exec("ALTER TABLE inter ADD COLUMN ownerId TEXT REFERENCES users(id) ON DELETE RESTRICT"); console.log("add fk column ok"); } catch (e) { console.log("add fk column ERR:", e.message); }
try { db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"); console.log("add not null default ok"); } catch (e) { console.log("add not null default ERR:", e.message); }
try { db.exec("ALTER TABLE users ADD COLUMN createdBy TEXT REFERENCES users(id) ON DELETE SET NULL"); console.log("add self fk ok"); } catch (e) { console.log("add self fk ERR:", e.message); }
// VACUUM INTO on memory db
try { db.exec("VACUUM INTO '/tmp/contrack-review/vac.db'"); console.log("vacuum into ok"); } catch (e) { console.log("vacuum into ERR:", e.message); }
// fs.statfs
const fs = require("fs"); console.log("fs.statfsSync:", typeof fs.statfsSync);
