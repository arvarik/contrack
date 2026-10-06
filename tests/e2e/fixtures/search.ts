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
  /** The model did not verify the answer, so the local list is unverified. */
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

export interface StreamedAnswer {
  /** The local list the server streams at once, before AI has checked it. */
  instant: Match[];
  /** AI's answer, sent when the test calls {@link releasePeopleSearch}. */
  complete: Match[];
  /** AI did not check the final answer either. */
  fallback?: boolean;
}

/**
 * Answer every People search in two chunks, as the server streams them: the
 * local list at once, unverified, and the final answer only when the test
 * calls {@link releasePeopleSearch}. `page.route` sends a body whole, so
 * this replaces `fetch` in the page for the one path, before the app loads.
 */
export async function streamPeopleSearch(
  page: Page,
  { instant, complete, fallback = false }: StreamedAnswer,
): Promise<void> {
  await page.addInitScript(
    ({ instant, complete, fallback }) => {
      const realFetch = window.fetch.bind(window);
      const held = window as unknown as { __releasePeopleSearch?: () => void };
      window.fetch = (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.includes("/api/search/semantic")) {
          return realFetch(input, init);
        }
        const encoder = new TextEncoder();
        const line = (value: unknown) =>
          encoder.encode(JSON.stringify(value) + "\n");
        const released = new Promise<void>((resolve) => {
          held.__releasePeopleSearch = resolve;
        });
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              line({ phase: "instant", matches: instant, fallback: true }),
            );
            await released;
            controller.enqueue(
              line({ phase: "complete", matches: complete, fallback }),
            );
            controller.close();
          },
        });
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "application/x-ndjson" },
          }),
        );
      };
    },
    { instant, complete, fallback },
  );
}

/** Send the final answer of the People search {@link streamPeopleSearch} holds. */
export async function releasePeopleSearch(page: Page): Promise<void> {
  await page.evaluate(() =>
    (
      window as unknown as { __releasePeopleSearch?: () => void }
    ).__releasePeopleSearch?.(),
  );
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

/**
 * AI settings with every model role served, so a button that needs AI
 * (a briefing, a synthesis, Add from text) is ready. No test has a key, so
 * the answers themselves are scripted at their own routes.
 */
export async function serveAiModels(page: Page): Promise<void> {
  const resolved = {
    providerId: "gemini",
    providerLabel: "Google Gemini",
    model: "gemini-test",
  };
  await page.route("**/api/settings/ai", async (route) => {
    const json = await (await route.fetch()).json();
    for (const capability of ["quick", "deep", "research", "embeddings"]) {
      json.capabilities[capability] = {
        ...json.capabilities[capability],
        resolved,
      };
    }
    await route.fulfill({ json });
  });
}
