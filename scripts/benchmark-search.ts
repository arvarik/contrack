import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Each run uses synthetic data in a temporary database, including when comparing branches.
const dataDir = mkdtempSync(path.join(tmpdir(), "contrack-search-bench-"));
process.env.DATA_DIR = dataDir;
process.env.DISABLE_BACKGROUND_JOBS = "true";
process.env.GEMINI_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
const { sqlite } = await import(
  pathToFileURL(path.resolve("server/db.ts")).href
);

try {
  const count = 10_000;
  const insert = sqlite.prepare(
    "INSERT INTO contacts(id, name, company, role) VALUES (?, ?, ?, ?)",
  );
  sqlite.transaction(() => {
    for (let i = 0; i < count; i++)
      insert.run(
        `bench-${i}`,
        `Contact ${i}`,
        `Company ${i % 100}`,
        "Engineer",
      );
  })();
  const update = sqlite.prepare("UPDATE contacts SET role = ? WHERE id = ?");
  const query = sqlite.prepare(
    "SELECT contactId FROM contacts_fts WHERE contacts_fts MATCH ? ORDER BY rank LIMIT 20",
  );
  const edits: number[] = [],
    searches: number[] = [];
  for (let i = 0; i < 100; i++) {
    let start = performance.now();
    update.run(i % 2 ? "Engineer" : "Designer", `bench-${i}`);
    edits.push(performance.now() - start);
    start = performance.now();
    query.all(`"Company ${i % 100}"`);
    searches.push(performance.now() - start);
  }
  const summarize = (values: number[]) => {
    values.sort((a, b) => a - b);
    return { p50Ms: +values[50].toFixed(3), p95Ms: +values[95].toFixed(3) };
  };
  console.log(
    JSON.stringify({
      contacts: count,
      samples: 100,
      edit: summarize(edits),
      search: summarize(searches),
    }),
  );
} finally {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
}
