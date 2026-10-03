// =============================================================================
// Integration: the boot pass that gives old default avatars a pronoun look
// =============================================================================
// Contacts saved before the default face read pronouns carry a URL with no
// `look`. The pass in the baseline migration (§2a-1) adds one, and must leave
// every face somebody chose exactly as it was.
//
// The baseline runs once per database. Each boot below forgets its row in
// schema_migrations first, so the boot runs the baseline over contacts that
// were saved before it, the way the first boot of this code runs it over a
// database from d67c8a9.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type Database from "better-sqlite3";
import { doubleMetaphone } from "../../server/utils/nlp/index.ts";

let first: Database.Database;
let second: Database.Database;

/** Make the next boot run the baseline migration again. */
function forgetBaseline(db: Database.Database): void {
  db.prepare("DELETE FROM schema_migrations WHERE id = '0001_baseline'").run();
}

const rows = [
  {
    id: "c-default-she",
    name: "Jordan Lee",
    pronouns: "she/her",
    avatarUrl: "/api/avatar/avataaars?seed=Jordan+Lee",
  },
  {
    id: "c-default-they",
    name: "James Smith",
    pronouns: "they/them",
    avatarUrl: "/api/avatar/avataaars?seed=James%20Smith",
  },
  {
    id: "c-default-no-pronouns",
    name: "Mary Wilson",
    pronouns: null,
    avatarUrl: "/api/avatar/avataaars?seed=Mary+Wilson",
  },
  {
    id: "c-picked",
    name: "Casey Ng",
    pronouns: "he/him",
    avatarUrl: "/api/avatar/avataaars?seed=Felix&bg=1",
  },
  {
    id: "c-photo",
    name: "Robin Hood",
    pronouns: "she/her",
    avatarUrl: "/uploads/u/owner/avatars/robin.webp",
  },
  {
    id: "c-renamed-long-ago",
    name: "Dana New",
    pronouns: "she/her",
    avatarUrl: "/api/avatar/avataaars?seed=Dana+Old",
  },
];

let updatedAtBefore: Record<string, string>;

beforeAll(async () => {
  ({ sqlite: first } = await import("../../server/db.ts"));
  const owner = (
    first.prepare("SELECT id FROM users LIMIT 1").get() as { id: string }
  ).id;
  // With the phonetic hash filled in, as a saved contact has it. Without one
  // the boot's phonetic backfill would write these rows too, and this file
  // could not tell that write from ours.
  const insert = first.prepare(
    `INSERT INTO contacts (id, ownerId, name, pronouns, avatarUrl, phoneticHash, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, '2026-01-01 00:00:00')`,
  );
  for (const row of rows)
    insert.run(
      row.id,
      owner,
      row.name,
      row.pronouns,
      row.avatarUrl,
      doubleMetaphone(row.name).primary,
    );
  updatedAtBefore = Object.fromEntries(
    (
      first.prepare("SELECT id, updatedAt FROM contacts").all() as {
        id: string;
        updatedAt: string;
      }[]
    ).map((r) => [r.id, r.updatedAt]),
  );
  forgetBaseline(first);
  first.close();

  // A fresh module registry, so server/db.ts boots again over the same file.
  vi.resetModules();
  ({ sqlite: second } = await import("../../server/db.ts"));
});

afterAll(() => second.close());

function avatarOf(id: string): string {
  return (
    second.prepare("SELECT avatarUrl FROM contacts WHERE id = ?").get(id) as {
      avatarUrl: string;
    }
  ).avatarUrl;
}

describe("boot: default avatars take the contact's pronouns", () => {
  it("adds the look to a default avatar", () => {
    expect(avatarOf("c-default-she")).toBe(
      "/api/avatar/avataaars?seed=Jordan+Lee&look=f",
    );
    expect(avatarOf("c-default-they")).toBe(
      "/api/avatar/avataaars?seed=James+Smith&look=n",
    );
  });

  it("leaves a contact with no pronouns alone", () => {
    expect(avatarOf("c-default-no-pronouns")).toBe(
      "/api/avatar/avataaars?seed=Mary+Wilson",
    );
    expect(
      (
        second
          .prepare("SELECT updatedAt FROM contacts WHERE id = ?")
          .get("c-default-no-pronouns") as { updatedAt: string }
      ).updatedAt,
    ).toBe(updatedAtBefore["c-default-no-pronouns"]);
  });

  it("never replaces a face someone chose", () => {
    expect(avatarOf("c-picked")).toBe("/api/avatar/avataaars?seed=Felix&bg=1");
    expect(avatarOf("c-photo")).toBe("/uploads/u/owner/avatars/robin.webp");
    // Seeded on another name: not this contact's default, so not ours to redraw.
    expect(avatarOf("c-renamed-long-ago")).toBe(
      "/api/avatar/avataaars?seed=Dana+Old",
    );
  });

  it("writes nothing on the next boot", async () => {
    const before = second
      .prepare("SELECT id, avatarUrl, updatedAt FROM contacts ORDER BY id")
      .all();
    forgetBaseline(second);
    second.close();
    vi.resetModules();
    ({ sqlite: second } = await import("../../server/db.ts"));
    expect(
      second
        .prepare("SELECT id, avatarUrl, updatedAt FROM contacts ORDER BY id")
        .all(),
    ).toEqual(before);
  });
});
