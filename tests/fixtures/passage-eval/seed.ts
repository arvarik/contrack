import type Database from "better-sqlite3";
import { passageCases, passagePreamble } from "./cases.ts";

export function seedPassageCorpus(
  database: Database.Database,
  ownerId: string,
  count: number,
): void {
  const insert = database.prepare(
    "INSERT INTO contacts (id, ownerId, name, company, about, preferences) VALUES (?, ?, ?, 'CurrentCo', ?, ?)",
  );
  database.transaction(() => {
    for (const [index, item] of passageCases.entries()) {
      const text = passagePreamble + item.fact;
      insert.run(
        item.id,
        ownerId,
        `Specialist ${index + 1}`,
        item.field === "about" ? text : "Coordinates projects.",
        item.field === "preferences" ? text : null,
      );
      if (item.field === "experience")
        database
          .prepare(
            `INSERT INTO contact_experience (id, contactId, company, role, endDate, description) VALUES (?, ?, 'FormerCo', 'Specialist', '2020-01', ?)`,
          )
          .run(`job-${item.id}`, item.id, text);
      if (item.field === "education")
        database
          .prepare(
            `INSERT INTO contact_education (id, contactId, school, description) VALUES (?, ?, 'Research College', ?)`,
          )
          .run(`school-${item.id}`, item.id, text);
    }
    for (let i = passageCases.length; i < count; i++)
      insert.run(
        `filler-${i}`,
        ownerId,
        `Office colleague ${i}`,
        "Office administration and scheduling.",
        null,
      );
  })();
}
