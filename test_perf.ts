import { sqlite } from "./server/db.ts";
import { contactRepo } from "./server/repositories/contactRepository.ts";

const start = performance.now();
const all = sqlite
  .prepare(
    "SELECT * FROM contacts WHERE (isArchived = 0 OR isArchived IS NULL) ORDER BY addedAt DESC",
  )
  .all();
const fetchMs = performance.now() - start;

const hStart = performance.now();
const hydrated = contactRepo.hydrateMany(all);
const hydrateMs = performance.now() - hStart;

console.log(`Fetch: ${fetchMs.toFixed(2)}ms`);
console.log(`Hydrate ${hydrated.length} rows: ${hydrateMs.toFixed(2)}ms`);
