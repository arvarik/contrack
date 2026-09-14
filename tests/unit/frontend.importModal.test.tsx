// @vitest-environment jsdom
// =============================================================================
// The import modal shows success when the server says so, and not before
// =============================================================================
// The modal read the import stream to its end and showed whatever it had as
// the result. A connection that dropped part way showed "Import Complete"
// over an import the server was still writing, or had never received. And
// the natural response, choosing the file again, made a second copy of every
// contact, because nothing tied the two requests together.
//
// Every request here carries the id the browser made. A dropped stream polls
// the record. A failed import is tried again under the same id. Rows the
// server could not write are listed and retried. The server's word is the
// only thing that turns the modal green.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportModal } from "../../src/components/ImportModal";
import {
  POLLING,
  importKey,
  recallImport,
  rememberImport,
} from "../../src/lib/importRun";
import type { ImportRecord, ImportRow } from "../../src/api/imports";

/** The signed-in account. */
const account = vi.hoisted(() => ({ current: { id: "acct-1" } }));
vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ user: account.current }),
}));

/**
 * Animations are stubbed out. `AnimatePresence mode="wait"` holds the next
 * card back until the previous one has animated off, which is a quarter of
 * a second of real time per phase change and much longer when the whole
 * unit project runs at once. The states here are what is under test, not the
 * crossfade between them.
 */
vi.mock("motion/react", async () => {
  const ReactModule = await import("react");
  const MOTION_PROPS = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "variants",
    "whileHover",
    "whileTap",
  ]);
  const strip = (props: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(props).filter(([key]) => !MOTION_PROPS.has(key)),
    );
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => (props: Record<string, unknown>) =>
          ReactModule.createElement(tag, strip(props)),
      },
    ),
  };
});

const VCF = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ada Twin",
  "N:Twin;Ada;;;",
  "END:VCARD",
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Ben Twin",
  "N:Twin;Ben;;;",
  "END:VCARD",
  "",
].join("\n");

const SUMMARY = {
  imported: 2,
  autoMerged: 0,
  needsReview: 0,
  newUnique: 2,
  failed: 0,
};

function record(partial: Partial<ImportRecord> & { id: string }): ImportRecord {
  return {
    status: "running",
    phase: "importing",
    message: null,
    total: 2,
    processed: 1,
    imported: 0,
    failed: 0,
    summary: null,
    error: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    completedAt: null,
    ...partial,
  };
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A controllable SSE body. */
function sse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    frame: (data: unknown) =>
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`),
      ),
    end: () => controller.close(),
  };
}

type Answer =
  | { kind: "record"; record: ImportRecord }
  | { kind: "status"; status: number; body?: unknown }
  | { kind: "network" };

/**
 * A fetch that serves the import routes.
 *
 * Every call is recorded. The bulk POST answers with whatever `onImport`
 * returns. Status polls shift answers off a queue and repeat the last one
 * once it is empty, so a test can say "running, running, complete" and let
 * the modal poll as often as it likes.
 */
function stubServer(options: {
  onImport: (call: Call) => Response | Promise<Response>;
  polls?: Answer[];
  rows?: ImportRow[];
  onRetry?: () => Response;
}) {
  const calls: Call[] = [];
  const polls = [...(options.polls ?? [])];
  let last: Answer | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const headers = Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      );
      const call: Call = {
        method,
        url: String(url),
        headers,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);

      if (method === "POST" && call.url === "/api/contacts/bulk") {
        return options.onImport(call);
      }
      if (method === "POST" && call.url.endsWith("/retry")) {
        return (
          options.onRetry?.() ??
          Response.json({
            importId: "x",
            status: "imported",
            retried: 1,
            imported: 1,
            failed: 0,
          })
        );
      }
      if (method === "GET" && /\/api\/imports\/[^/]+\/rows/.test(call.url)) {
        return Response.json({ rows: options.rows ?? [] });
      }
      if (method === "GET" && /\/api\/imports\/[^/]+$/.test(call.url)) {
        const answer = polls.length > 0 ? (polls.shift() ?? null) : last;
        last = answer;
        if (!answer) throw new TypeError("no poll answer queued");
        if (answer.kind === "network") throw new TypeError("Failed to fetch");
        if (answer.kind === "status") {
          return Response.json(
            answer.body ?? {
              error: { message: "Import not found", code: "NOT_FOUND" },
            },
            { status: answer.status },
          );
        }
        return Response.json(answer.record);
      }
      return Response.json({});
    }),
  );
  return {
    calls,
    /** Queue more poll answers after the test has started. */
    answer: (...more: Answer[]) => {
      polls.push(...more);
    },
    posts: () =>
      calls.filter(
        (c) => c.method === "POST" && c.url === "/api/contacts/bulk",
      ),
    statusPolls: () =>
      calls.filter(
        (c) => c.method === "GET" && /\/api\/imports\/[^/]+$/.test(c.url),
      ),
  };
}

function mount(isOpen = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ImportModal isOpen={isOpen} onClose={onClose} onSuccess={onSuccess} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client, onClose, onSuccess };
}

function chooseFile(name = "friends.vcf") {
  const input = screen.getByLabelText("Choose a file to import");
  fireEvent.change(input, {
    target: { files: [new File([VCF], name, { type: "text/vcard" })] },
  });
}

beforeEach(() => {
  POLLING.intervalMs = 5;
  POLLING.maxMisses = 3;
  localStorage.clear();
  account.current = { id: "acct-1" };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  POLLING.intervalMs = 1500;
  POLLING.maxMisses = 40;
});

describe("a stream that ends without a done frame", () => {
  it("does not show completion, polls the record, and shows the summary the server confirms", async () => {
    const body = sse();
    const server = stubServer({
      onImport: () => body.response,
      polls: [{ kind: "record", record: record({ id: "pending" }) }],
    });
    mount();
    chooseFile();

    await waitFor(() => expect(server.posts()).toHaveLength(1));
    const importId = server.posts()[0].headers["X-Import-Id"];
    expect(importId).toMatch(/^[0-9a-f-]{36}$/);
    body.frame({ phase: "accepted", importId });
    body.frame({ phase: "importing", processed: 1, total: 2 });
    // The connection drops here. No done frame.
    body.end();

    // The modal reconnects rather than announcing anything.
    await waitFor(() =>
      expect(screen.getByText(/reconnecting to your import/i)).toBeTruthy(),
    );
    await waitFor(() => expect(server.statusPolls().length).toBeGreaterThan(1));
    expect(screen.queryByText("Import Complete")).toBeNull();
    expect(server.statusPolls()[0].url).toBe(`/api/imports/${importId}`);

    // The server finishes. Only now is the import complete.
    server.answer({
      kind: "record",
      record: record({
        id: importId,
        status: "complete",
        phase: "done",
        summary: SUMMARY,
        imported: 2,
      }),
    });
    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
    expect(screen.getByText("2 new unique contacts")).toBeTruthy();
    // The remembered import is kept until the person dismisses it.
    expect(recallImport("acct-1")?.importId).toBe(importId);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(recallImport("acct-1")).toBeNull();
  });

  it("polls when the done frame is a repeat with no summary yet", async () => {
    const body = sse();
    const server = stubServer({
      onImport: () => body.response,
      polls: [
        {
          kind: "record",
          record: record({
            id: "imp",
            status: "complete",
            summary: { ...SUMMARY, imported: 1, newUnique: 1 },
          }),
        },
      ],
    });
    mount();
    chooseFile();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    body.frame({ phase: "accepted", importId: "imp" });
    body.frame({
      done: true,
      importId: "imp",
      repeated: true,
      status: "imported",
      count: 1,
      failed: 0,
      summary: null,
    });
    body.end();

    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
    expect(screen.getByText("1 new unique contacts")).toBeTruthy();
    expect(server.statusPolls()).toHaveLength(1);
  });
});

describe("the same import id on every attempt", () => {
  it("sends the id, and Try again after a dead connection sends the same one", async () => {
    let attempt = 0;
    const second = sse();
    const server = stubServer({
      onImport: () => {
        attempt += 1;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return second.response;
      },
      // The poll after the dead connection: the server never got it.
      polls: [{ kind: "status", status: 404 }],
    });
    mount();
    chooseFile();

    await waitFor(() =>
      expect(screen.getByText(/never received this import/i)).toBeTruthy(),
    );
    expect(screen.queryByText("Import Complete")).toBeNull();
    const firstId = server.posts()[0].headers["X-Import-Id"];
    expect(firstId).toMatch(/^[0-9a-f-]{36}$/);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(server.posts()).toHaveLength(2));
    const [first, retry] = server.posts();
    expect(retry.headers["X-Import-Id"]).toBe(firstId);
    // The same contacts, from memory. Nobody chose the file again.
    expect(retry.body).toEqual(first.body);
    expect((retry.body as unknown[]).length).toBe(2);

    second.frame({ phase: "accepted", importId: firstId });
    second.frame({
      done: true,
      importId: firstId,
      status: "complete",
      count: 2,
      failed: 0,
      summary: SUMMARY,
    });
    second.end();
    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
  });

  it("polls when the server says the import is already in progress", async () => {
    const server = stubServer({
      onImport: () =>
        Response.json(
          {
            error: {
              code: "IMPORT_IN_PROGRESS",
              message: "That import is running.",
              details: { importId: "x" },
            },
          },
          { status: 409 },
        ),
      polls: [
        { kind: "record", record: record({ id: "x", status: "imported" }) },
        {
          kind: "record",
          record: record({ id: "x", status: "complete", summary: SUMMARY }),
        },
      ],
    });
    mount();
    chooseFile();

    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
    expect(server.statusPolls().length).toBeGreaterThanOrEqual(2);
  });
});

describe("a failed import", () => {
  it("shows the server's reason and offers Try again", async () => {
    const body = sse();
    const server = stubServer({
      onImport: () => body.response,
      polls: [
        {
          kind: "record",
          record: record({
            id: "imp",
            status: "failed",
            phase: null,
            error: "The import was interrupted before any contact was saved.",
          }),
        },
      ],
    });
    mount();
    chooseFile();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    body.frame({ phase: "accepted", importId: "imp" });
    body.end();

    await waitFor(() =>
      expect(
        screen.getByText(/interrupted before any contact was saved/),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Import did not finish")).toBeTruthy();
    expect(screen.queryByText("Import Complete")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("stops after too many unreachable polls and offers Check again", async () => {
    const body = sse();
    const server = stubServer({
      onImport: () => body.response,
      polls: [{ kind: "network" }, { kind: "network" }, { kind: "network" }],
    });
    mount();
    chooseFile();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    body.end();

    await waitFor(() =>
      expect(screen.getByText("Lost contact with the server")).toBeTruthy(),
    );
    expect(server.statusPolls()).toHaveLength(3);

    server.answer({
      kind: "record",
      record: record({ id: "imp", status: "complete", summary: SUMMARY }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
  });
});

describe("rows the server could not write", () => {
  const failedRows: ImportRow[] = [
    {
      index: 3,
      status: "failed",
      name: "Cal Twin",
      error: "phone number too long",
      contactId: null,
    },
  ];

  it("are listed on the summary and retried through the retry route", async () => {
    const body = sse();
    const server = stubServer({
      onImport: () => body.response,
      rows: failedRows,
      polls: [
        {
          kind: "record",
          record: record({
            id: "imp",
            status: "complete",
            summary: { ...SUMMARY, imported: 3, newUnique: 3, failed: 0 },
          }),
        },
      ],
    });
    mount();
    chooseFile();
    await waitFor(() => expect(server.posts()).toHaveLength(1));
    body.frame({ phase: "accepted", importId: "imp" });
    body.frame({
      done: true,
      importId: "imp",
      status: "complete",
      count: 2,
      failed: 1,
      summary: { ...SUMMARY, failed: 1 },
    });
    body.end();

    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
    expect(screen.getByText("1 row could not be imported")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Cal Twin")).toBeTruthy());
    expect(screen.getByText(/phone number too long/)).toBeTruthy();

    // The retry goes to the id the browser sent, which is the id the server
    // recorded. The frame's `importId` is the same string on a real server.
    const importId = server.posts()[0].headers["X-Import-Id"];
    fireEvent.click(screen.getByRole("button", { name: "Retry failed rows" }));
    await waitFor(() =>
      expect(
        server.calls.some(
          (c) =>
            c.method === "POST" && c.url === `/api/imports/${importId}/retry`,
        ),
      ).toBe(true),
    );
    // The retry finished. The summary is the server's new one and the list
    // is gone.
    await waitFor(() =>
      expect(screen.getByText("3 new unique contacts")).toBeTruthy(),
    );
    expect(screen.queryByText(/could not be imported/)).toBeNull();
  });
});

describe("reopening the modal", () => {
  it("reconnects to the import this account remembers", async () => {
    rememberImport("acct-1", {
      importId: "remembered-1",
      fileName: "everyone.vcf",
      startedAt: Date.now(),
    });
    const server = stubServer({
      onImport: () => {
        throw new Error("no import should start");
      },
      polls: [
        {
          kind: "record",
          record: record({
            id: "remembered-1",
            status: "imported",
            phase: "scanning",
            message: "Looking for duplicates…",
          }),
        },
        {
          kind: "record",
          record: record({
            id: "remembered-1",
            status: "complete",
            summary: SUMMARY,
          }),
        },
      ],
    });
    mount();

    await waitFor(() =>
      expect(screen.getByText(/reconnecting to your import/i)).toBeTruthy(),
    );
    expect(screen.getByText(/everyone\.vcf/)).toBeTruthy();
    expect(server.statusPolls()[0].url).toBe("/api/imports/remembered-1");
    await waitFor(() =>
      expect(screen.getByText("Import Complete")).toBeTruthy(),
    );
    expect(server.posts()).toHaveLength(0);
  });

  it("ignores an import remembered under another account", async () => {
    rememberImport("acct-2", {
      importId: "theirs",
      fileName: "theirs.vcf",
      startedAt: Date.now(),
    });
    const server = stubServer({
      onImport: () => {
        throw new Error("no import should start");
      },
    });
    mount();

    expect(screen.getByText(/click to upload/i)).toBeTruthy();
    expect(server.statusPolls()).toHaveLength(0);
    expect(localStorage.getItem(importKey("acct-2"))).not.toBeNull();
  });

  it("forgets an import the server no longer has, and goes back to the upload area", async () => {
    rememberImport("acct-1", {
      importId: "gone",
      fileName: "old.vcf",
      startedAt: Date.now(),
    });
    stubServer({
      onImport: () => {
        throw new Error("no import should start");
      },
      polls: [{ kind: "status", status: 404 }],
    });
    mount();

    await waitFor(() =>
      expect(screen.getByText(/no longer on the server/i)).toBeTruthy(),
    );
    // The upload area comes back once the reconnect card has animated out.
    await waitFor(() =>
      expect(screen.getByText(/click to upload/i)).toBeTruthy(),
    );
    expect(recallImport("acct-1")).toBeNull();
  });
});
