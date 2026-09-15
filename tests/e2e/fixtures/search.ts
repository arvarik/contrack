/**
 * A scripted answer for the People search.
 *
 * The real endpoint asks a model, and without a key it waits on the local
 * embedding model, which no CI runner has and no test should download. The
 * response is scripted at the network edge, so everything from the request
 * body to the last render is the real client code. The Notes search needs
 * no script: it is FTS5 on the server, and the specs run it for real.
 */
import type { Page } from "@playwright/test";
import type { SeededContact } from "./seed";

export interface Match {
  id: string;
  name: string;
  role?: string;
  company?: string;
  location?: string;
  avatarUrl?: string | null;
  tags?: { tag: string }[];
}

/** One search result for a seeded person, with whatever a card shows. */
export function personMatch(
  contact: SeededContact,
  extra: Omit<Match, "id" | "name"> = {},
): Match {
  return {
    id: contact.id,
    name: contact.name,
    avatarUrl: null,
    tags: [],
    ...extra,
  };
}

export interface PeopleAnswer {
  /** Milliseconds to hold the answer, so a loading state is observable. */
  delayMs?: number;
  /** The server could not reach AI and answered by keyword. */
  fallback?: boolean;
}

const ndjson = (lines: unknown[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n") + "\n";

/** Answer every People search with these matches. */
export async function answerPeopleSearch(
  page: Page,
  matches: Match[],
  { delayMs = 0, fallback = false }: PeopleAnswer = {},
): Promise<void> {
  await page.route("**/api/search/semantic", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson([{ phase: "complete", matches, fallback }]),
    });
  });
}

/** Fail every People search the way the server reports a failure. */
export async function failPeopleSearch(
  page: Page,
  message: string,
): Promise<void> {
  await page.route("**/api/search/semantic", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: ndjson([{ phase: "error", error: message }]),
    }),
  );
}
