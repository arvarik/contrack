const Database = require("better-sqlite3");
const db = new Database("/Users/arvind/Documents/github/contrack/curator.db", { readonly: true, fileMustExist: true });
const tables = db.prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log("TABLES (" + tables.length + "):");
for (const t of tables) {
  if (/^(contacts_fts_|search_embeddings_|contact_embeddings_)/.test(t.name)) continue; // shadow tables
  let cols = "";
  try { cols = db.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name + (c.notnull ? "!" : "") + (c.pk ? "*" : "")).join(","); } catch {}
  const fks = (() => { try { return db.prepare(`PRAGMA foreign_key_list("${t.name}")`).all().map(f => `${f.from}->${f.table}.${f.to} del:${f.on_delete}`).join("; "); } catch { return ""; } })();
  console.log(`  ${t.name}: [${cols}]` + (fks ? `\n      FK: ${fks}` : ""));
}
console.log("\nINDEXES:");
for (const i of db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY tbl_name, name").all()) console.log("  " + i.name + " ON " + i.sql.replace(/^.*ON\s+/i, ""));
console.log("\nTRIGGERS:");
for (const t of db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='trigger' ORDER BY tbl_name, name").all()) console.log("  " + t.name + " ON " + t.tbl_name);
console.log("\nuser_version:", db.pragma("user_version", { simple: true }), " foreign_keys:", db.pragma("foreign_keys", { simple: true }), " journal_mode:", db.pragma("journal_mode", { simple: true }));
console.log("row counts:", ["users","contacts","lists","interactions","action_items","dedupe_suggestions","dedupe_exclusions","dedupe_merge_log","ai_invocations","app_settings"].map(t => { try { return t + "=" + db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c } catch { return t + "=?" } }).join(" "));
try { console.log("app_settings keys:", db.prepare("SELECT key FROM app_settings").all().map(r => r.key).join(", ")); } catch {}
