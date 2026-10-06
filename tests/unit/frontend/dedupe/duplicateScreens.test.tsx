// @vitest-environment jsdom
// =============================================================================
// The places a merge is announced, undone or found again
// =============================================================================
// - The contact page's banner merges and keeps apart with Undo, and a merge
//   that keeps the other contact moves the page to it.
// - A merged contact's old page opens the contact it merged into.
// - A contact a person adds and Contrack then merges says so, with Undo.
// - Merge history tells two entries for one name apart, puts a merge near
//   midnight under the right day, and its Undo keeps the two apart.
// - The check says what it did when it is done.
// =============================================================================
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { toast } from "sonner";
import type { ReactNode } from "react";
import { DupeBanner } from "../../../../src/views/contact-detail/components/DupeBanner";
import { useMergedRedirect } from "../../../../src/views/contact-detail/components/useMergedRedirect";
import { watchNewContact } from "../../../../src/lib/mergeNotice";
import {
  groupByDay,
  MergeHistory,
} from "../../../../src/views/dedupe/components/MergeHistory";
import type { Contact, MergeLogEntry } from "../../../../src/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** Answer each route with what `routes` holds for the first matching part. */
function stubFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        method: init?.method ?? "GET",
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const key = Object.keys(routes).find((part) => url.includes(part));
      return Response.json(key ? routes[key] : { success: true });
    }),
  );
  return calls;
}

function person(id: string, name: string, extra: object = {}) {
  return {
    id,
    name,
    emails: [],
    phones: [],
    socialLinks: [],
    tags: [],
    lists: [],
    sources: [],
    interactionCount: 0,
    ...extra,
  };
}

/** Where the router is: the banner and the redirect move it. */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function withProviders(children: ReactNode, path = "/contact/a") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                {children}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const lastUndo = (spy: unknown) => {
  const calls = (spy as ReturnType<typeof vi.fn>).mock.calls;
  const options = calls.at(-1)?.[1] as { action?: { onClick: () => void } };
  return options.action!.onClick;
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the contact page's banner", () => {
  const suggestion = {
    id: "s1",
    contactIdA: "a",
    contactIdB: "b",
    contactA: person("a", "Ada Quill"),
    contactB: person("b", "Ben Quill"),
    matchType: "phone",
    confidence: 0.85,
    reasoning: "Same phone number",
    caveat: "First names differ: Ada and Ben",
    matchedField: null,
    status: "pending",
  };

  it("shows the reason and the caveat before anything opens", async () => {
    stubFetch({ "/suggestion-for/": { suggestion } });
    withProviders(<DupeBanner contactId="a" />);
    await screen.findByText("First names differ: Ada and Ben");
    screen.getByText("Same phone number");
  });

  it("moves to the other contact's page when the merge keeps it", async () => {
    const calls = stubFetch({
      "/suggestion-for/": { suggestion },
      "/contacts/merge-cluster": {
        success: true,
        merged: 1,
        failed: 0,
        contact: null,
        mergeLogIds: ["log-1"],
      },
    });
    withProviders(<DupeBanner contactId="a" />);
    fireEvent.click(await screen.findByRole("button", { name: "Compare" }));
    fireEvent.click(screen.getByRole("radio", { name: /Ben Quill/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Merge$/ }));

    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/contact/b"),
    );
    expect(calls.find((c) => c.url.endsWith("/merge-cluster"))?.body).toEqual({
      primaryId: "b",
      duplicateIds: ["a"],
    });
    expect(vi.mocked(toast.success).mock.calls[0][0]).toBe(
      "Merged Ada Quill into Ben Quill",
    );
  });

  it("keeps the two separate, with an Undo that brings the pair back", async () => {
    const calls = stubFetch({ "/suggestion-for/": { suggestion } });
    withProviders(<DupeBanner contactId="a" />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Keep separate/ }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalled());
    await act(async () => lastUndo(toast)());
    expect(
      calls.some((c) => c.url.endsWith("/dedupe/suggestions/s1/restore")),
    ).toBe(true);
  });
});

describe("a merged contact's old page", () => {
  function Page({ contact }: { contact: Contact }) {
    const redirecting = useMergedRedirect(contact, contact.id);
    return <span>{redirecting ? "redirecting" : "page"}</span>;
  }

  it("goes on to the contact it merged into, and says so with Undo", async () => {
    stubFetch({
      "/merged-into/": {
        merge: {
          mergeLogId: "log-9",
          primaryId: "keeper",
          primaryName: "Ada Quill",
          mergedBy: "auto",
          mergedAt: "2026-10-05 10:00:00",
        },
      },
    });
    const merged = { ...person("gone", "A. Quill"), canonicalId: "keeper" };
    withProviders(
      <Page contact={merged as unknown as Contact} />,
      "/contact/gone",
    );
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/contact/keeper"),
    );
    expect(vi.mocked(toast).mock.calls[0][0]).toBe(
      "A. Quill was merged into Ada Quill",
    );
  });

  it("leaves a live contact's page alone", () => {
    const calls = stubFetch({});
    withProviders(
      <Page contact={person("a", "Ada Quill") as unknown as Contact} />,
    );
    screen.getByText("page");
    expect(calls).toEqual([]);
  });
});

describe("a contact a person just added", () => {
  it("says so when the check merged it into one that existed, with an Undo that keeps them apart", async () => {
    vi.useFakeTimers();
    const calls = stubFetch({
      "/merged-into/": {
        merge: {
          mergeLogId: "log-3",
          primaryId: "old",
          primaryName: "Felix Dunmore",
          mergedBy: "auto",
          mergedAt: "2026-10-05 10:00:00",
        },
      },
    });
    watchNewContact(new QueryClient(), { id: "new", name: "Felix Dunmore" });
    expect(calls).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(vi.mocked(toast).mock.calls[0][0]).toBe(
      "Felix Dunmore was already in your contacts",
    );
    await act(async () => lastUndo(toast)());
    const undo = calls.find((c) => c.url.includes("/merge-log/log-3/undo"));
    expect(undo?.body).toEqual({ keepSeparate: true });
  });
});

describe("Merge history", () => {
  const entry = (id: string, extra: Partial<MergeLogEntry>): MergeLogEntry => ({
    id,
    primaryId: "p",
    duplicateId: "d",
    mergedBy: "auto",
    mergeType: "soft",
    confidence: 0.9,
    reasoning: "Same name",
    mergedAt: "2026-10-05 10:00:00",
    undoneAt: null,
    duplicateSnapshot: null,
    primaryName: "Chris Navarro",
    duplicateName: "Chris Navarro",
    ...extra,
  });

  it("files a merge by its UTC time, so one near midnight lands on the right day", () => {
    // 23:30 UTC on 4 October, read in a zone where it is already the 5th,
    // is today, and read as local time it was yesterday.
    const now = new Date("2026-10-05T12:00:00Z");
    const groups = groupByDay(
      [entry("x", { mergedAt: "2026-10-04 23:30:00" })],
      now,
    );
    const at = new Date("2026-10-04T23:30:00Z");
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    expect(groups[0].label).toBe(at >= today ? "Today" : "Yesterday");
  });

  it("tells two entries for one name apart, and its Undo keeps the two apart", async () => {
    const calls = stubFetch({
      "/merge-log?": {
        entries: [
          entry("log-1", {
            primaryCompany: "Adatum",
            primaryLocation: "Boston, MA",
            duplicateCompany: "Woodgrove Bank",
            duplicateLocation: "Miami, FL",
          }),
        ],
      },
      "/undo": {
        success: true,
        restoredContactId: "d",
        conflicts: [],
        keptSeparate: true,
      },
    });
    withProviders(<MergeHistory />);
    await screen.findByText(/Woodgrove Bank, Miami/);
    screen.getByText(/Adatum, Boston/);
    fireEvent.click(screen.getByRole("button", { name: /Undo the merge/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const undo = calls.find((c) => c.url.includes("/merge-log/log-1/undo"));
    expect(undo?.body).toEqual({ keepSeparate: true });
  });
});
