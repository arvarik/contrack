// @vitest-environment jsdom
// =============================================================================
// The contact timeline: one column, grouped by week and month, and a delete
// that waits for Undo
// =============================================================================
// The timeline zigzagged, put a red trash on every card, and deleted on the
// first click. Now it is one column under "This week" and month headings,
// each entry has a kebab with Edit and Delete, and Delete asks first.
//
// The server delete is a hard delete with no restore route. So Undo cannot
// put a row back, and the request has to wait for the undo window to end.
// These tests hold that promise: nothing is sent before the window ends, it
// is sent once, Undo sends nothing, and a refetch or leaving the page does
// not bring the entry back.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

/** The toasts, so a test can read the options and press Undo. */
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), {
    success: vi.fn(() => "toast-1"),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

// The modal completes follow-ups through the `api` barrel, and the barrel
// pulls in every API module in the app. A stub keeps this file to the
// timeline.
const completeActionItem = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/api", () => ({
  useCompleteActionItem: () => ({ mutateAsync: completeActionItem }),
}));

// The real composer and note editor are tiptap. The timeline only needs to
// know what it passes.
vi.mock("../../../../src/components/InteractionComposer", async () => {
  const { createElement } = await import("react");
  return {
    InteractionComposer: ({ collapsible }: { collapsible?: boolean }) =>
      createElement("div", {
        "data-testid": "composer",
        "data-collapsible": String(collapsible),
      }),
    NoteEditor: ({
      html,
      onChange,
    }: {
      html: string;
      onChange: (html: string) => void;
    }) =>
      createElement("textarea", {
        "aria-label": "Note",
        value: html,
        onChange: (e: { target: { value: string } }) =>
          onChange(e.target.value),
      }),
  };
});

import {
  TimelineTab,
  type TimelineTabProps,
} from "../../../../src/views/contact-detail/components/TimelineTab";
import {
  FALLBACK_MS,
  resetPendingDeletes,
} from "../../../../src/lib/pendingDeletes";
import type { Interaction } from "../../../../src/types";

/** An ISO instant for a local date and hour, so no test depends on the zone. */
const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).toISOString();

function makeItem(
  id: string,
  title: string,
  date: string,
  overrides: Partial<Interaction> = {},
): Interaction {
  return {
    id,
    contactId: "c1",
    type: "call",
    title,
    content: null,
    date,
    duration: null,
    fileUrl: null,
    fileName: null,
    fileType: null,
    source: null,
    mentions: null,
    updatedAt: date,
    ownerId: "owner-1",
    ...overrides,
  };
}

/** Out of order on purpose: the timeline sorts. */
function makeTimeline(): Interaction[] {
  return [
    makeItem("aug", "Coffee in August", at(2026, 8, 28), {
      type: "email",
      content: "<p>Talked about the launch</p>",
      mentions: JSON.stringify([
        { contactId: "g1", name: "Grace", isGhost: true },
        { contactId: "c2", name: "Alan" },
      ]),
      actionItems: [
        {
          id: "a1",
          title: "Send deck",
          dueAt: at(2026, 9, 20),
          completedAt: null,
        },
      ],
      duration: "30m",
      fileUrl: "/uploads/deck.pdf",
      fileName: "deck.pdf",
      fileType: "application/pdf",
      isViaName: "Alan",
      isViaId: "c2",
    }),
    makeItem("bad", "Undated", "not a date", { type: "note" }),
    makeItem("call", "Call with Ada", at(2026, 9, 15, 10)),
    makeItem("dec", "Year end review", at(2025, 12, 3), { type: "linkedin" }),
    // A date with no time is a calendar day. It is Monday, the first day of
    // this week.
    makeItem("note", "Monday note", "2026-09-14", { type: "note" }),
    // SQLite's own timestamp form, in UTC.
    makeItem("sqlite", "Imported row", "2026-08-19 12:00:00", {
      type: "import",
      fileUrl: "/uploads/photo.png",
      fileName: "photo.png",
      fileType: "image/png",
    }),
    makeItem("oct", "Planning lunch", at(2026, 10, 2), { type: "meeting" }),
  ];
}

function makeProps(overrides: Partial<TimelineTabProps> = {}) {
  return {
    contactId: "c1",
    timeline: makeTimeline(),
    timelineLoading: false,
    isDragActive: false,
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    deleteInteraction: vi.fn(() => Promise.resolve({ success: true })),
    updateInteraction: vi.fn(() => Promise.resolve({})),
    promoteGhost: vi.fn(),
    ...overrides,
  } satisfies TimelineTabProps;
}

type Props = ReturnType<typeof makeProps>;

/** Where the router is, so a test can see where a click went. */
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

/** Render the tab and wait for the lazy composer. */
async function mount(overrides: Partial<Props> = {}, url = "/contact/c1") {
  const props = makeProps(overrides);
  const ui = (next: Props) => (
    <MemoryRouter initialEntries={[url]}>
      <TimelineTab {...next} />
      <Where />
    </MemoryRouter>
  );
  const view = render(ui(props));
  await screen.findByTestId("composer");
  return {
    props,
    view,
    rerender: (next: Partial<Props>) =>
      view.rerender(ui({ ...props, ...next })),
  };
}

const entry = (id: string) => document.getElementById(`interaction-${id}`);

/** Open an entry's kebab and choose an item. */
function chooseAction(title: string, name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/** Delete an entry through its kebab and the confirmation. */
function confirmDelete(title: string) {
  chooseAction(title, "Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete interaction" }));
}

interface UndoToastOptions {
  duration: number;
  action: { label: string; onClick: () => void };
  onAutoClose: () => void;
  onDismiss: () => void;
}

/** The options of the last "Interaction deleted" toast. */
const lastToast = () =>
  (toastMock.success.mock.calls as unknown as [string, UndoToastOptions][]).at(
    -1,
  )![1];

beforeEach(() => {
  // Wednesday 16 September 2026, midday. Only Date is mocked, so React and
  // the dialogs keep their real timers.
  vi.setSystemTime(new Date(2026, 8, 16, 12));
});

afterEach(() => {
  cleanup();
  resetPendingDeletes();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  toastMock.dismiss.mockClear();
  completeActionItem.mockClear();
});

describe("the groups", () => {
  it("heads this week, then each month, with the year only for another year", async () => {
    await mount();
    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual(["October", "This week", "August", "December 2025", "No date"]);

    const titles = (name: string) =>
      within(screen.getByRole("region", { name }))
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);
    // A future entry goes under its month, above this week.
    expect(titles("October")).toEqual(["Planning lunch"]);
    // Newest first, and the week starts on Monday.
    expect(titles("This week")).toEqual(["Call with Ada", "Monday note"]);
    expect(titles("August")).toEqual(["Coffee in August", "Imported row"]);
    expect(titles("December 2025")).toEqual(["Year end review"]);
    expect(titles("No date")).toEqual(["Undated"]);
  });

  it("shows the day and short month in the date column and the full date in the tooltip", async () => {
    await mount();
    const call = entry("call")!;
    expect(call.tagName).toBe("LI");
    expect(call.getAttribute("title")).toBe("Sep 15, 2026");
    const time = call.querySelector("time")!;
    expect(time.textContent).toBe("15 Sep");
    expect(time.getAttribute("datetime")).toBe(at(2026, 9, 15, 10));

    expect(entry("note")!.getAttribute("title")).toBe("Sep 14, 2026");
    expect(entry("note")!.querySelector("time")!.textContent).toBe("14 Sep");

    // An unreadable date shows no date rather than "Invalid Date".
    expect(entry("bad")!.querySelector("time")).toBeNull();
    expect(entry("bad")!.getAttribute("title")).toBe("Unknown");
  });

  it("shows the body, mentions, attachment, follow-ups and duration of an entry", async () => {
    const { props } = await mount();
    const aug = within(entry("aug")!);
    expect(aug.getByText("Talked about the launch")).toBeTruthy();
    expect(aug.getByText("Send deck")).toBeTruthy();
    expect(aug.getByText("Duration: 30m")).toBeTruthy();
    expect(aug.getByRole("link", { name: /deck\.pdf/ })).toBeTruthy();
    expect(within(entry("sqlite")!).getByAltText("photo.png")).toBeTruthy();

    fireEvent.click(aug.getByTitle("Add Grace to Network"));
    expect(props.promoteGhost).toHaveBeenCalledWith("g1", expect.any(Object));
    const [, options] = vi.mocked(props.promoteGhost).mock.calls[0];
    act(() => options?.onSuccess?.());
    // The promoted contact opens.
    expect(screen.getByTestId("where").textContent).toBe("/contact/g1");

    // The via badge is a real button, and opens the contact it names.
    fireEvent.click(
      within(entry("aug")!).getByRole("button", { name: /via Alan/ }),
    );
    expect(screen.getByTestId("where").textContent).toBe("/contact/c2");
  });
});

describe("an entry", () => {
  it("opens the detail modal from its title", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Call with Ada" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Call with Ada" }),
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Call with Ada" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Title" })).toBe(null);
    // Date and time, from the one formatter.
    expect(screen.getByText(/Sep 15, 2026/)).toBeTruthy();

    // The modal's own Edit switches to the note editor in place.
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const notes = await screen.findByRole("textbox", { name: "Note" });
    fireEvent.change(notes, { target: { value: "Agreed on dates" } });

    // A close with unsaved changes asks first, and keeps the edit.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("alert").textContent).toBe("Discard your changes?");
    expect((notes as HTMLTextAreaElement).value).toBe("Agreed on dates");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 2, name: "Call with Ada" }),
      ).toBeNull(),
    );
  });

  it("marks a follow-up done with Undo, and sends nothing until Undo is gone", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Coffee in August" }));
    expect(screen.getByText("Due Sep 20, 2026")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Mark done: Send deck" }),
    );
    expect(toastMock.success).toHaveBeenCalledWith(
      "Follow-up done",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Send deck, done" }),
    ).toHaveProperty("disabled", true);
    expect(completeActionItem).not.toHaveBeenCalled();
  });

  it("has a kebab with Edit then Delete, hidden at rest but never removed", async () => {
    await mount();
    const trigger = screen.getByRole("button", {
      name: "Actions for Call with Ada",
    });
    for (const name of [
      "opacity-0",
      "group-hover/entry:opacity-100",
      "group-focus-within/entry:opacity-100",
      "aria-expanded:opacity-100",
      "pointer-coarse:opacity-100",
    ]) {
      expect(trigger.classList.contains(name)).toBe(true);
    }
    expect(trigger.className).not.toMatch(/\bhidden\b/);
    // No red icon at rest.
    expect(entry("call")!.querySelector(".text-error")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(entry("call")!.classList.contains("z-10")).toBe(true);
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Edit", "Delete"]);
  });

  it("opens the modal in edit mode from Edit, and saves the change", async () => {
    const { props } = await mount();
    chooseAction("Coffee in August", "Edit");
    const field = screen.getByRole("textbox", { name: "Title" });
    expect((field as HTMLInputElement).value).toBe("Coffee in August");

    fireEvent.change(field, { target: { value: "Coffee with Alan" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.updateInteraction).toHaveBeenCalledWith({
      id: "aug",
      contactId: "c1",
      data: {
        title: "Coffee with Alan",
        content: "<p>Talked about the launch</p>",
      },
    });
  });
});

describe("delete", () => {
  it("asks first, and Cancel keeps the entry", async () => {
    const { props } = await mount();
    chooseAction("Call with Ada", "Delete");
    const dialog = screen.getByRole("dialog", {
      name: "Delete this interaction?",
    });
    expect(dialog.textContent).toContain(
      "“Call with Ada” leaves the timeline, and a toast offers Undo for a few seconds.",
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(entry("call")).not.toBeNull();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(props.deleteInteraction).not.toHaveBeenCalled();
  });

  it("hides the entry on confirm, offers Undo, sends nothing yet, and focuses the next title", async () => {
    const { props } = await mount();
    confirmDelete("Call with Ada");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(entry("call")).toBeNull();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Interaction deleted",
      expect.objectContaining({
        duration: 10_000,
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    expect(props.deleteInteraction).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Monday note" }),
    );
  });

  it("focuses the previous title when the last entry goes", async () => {
    await mount();
    confirmDelete("Undated");
    expect(entry("bad")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Year end review" }),
    );
  });

  it("shows the entry again on Undo and never sends the delete", async () => {
    const { props } = await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    confirmDelete("Call with Ada");
    const options = lastToast();

    act(() => options.action.onClick());
    expect(entry("call")).not.toBeNull();
    // A close after Undo ends nothing, and neither does the fallback timer.
    act(() => options.onDismiss());
    act(() => options.onAutoClose());
    act(() => vi.advanceTimersByTime(FALLBACK_MS));
    expect(props.deleteInteraction).not.toHaveBeenCalled();
  });

  it("sends the delete once when the toast closes, even after the page has closed", async () => {
    const { props, view } = await mount();
    confirmDelete("Call with Ada");
    const options = lastToast();
    view.unmount();

    await act(async () => options.onAutoClose());
    act(() => options.onDismiss());
    expect(props.deleteInteraction).toHaveBeenCalledTimes(1);
    expect(props.deleteInteraction).toHaveBeenCalledWith({
      id: "call",
      contactId: "c1",
    });

    // Back on the contact, the deleted entry stays gone before the refetch.
    await mount();
    expect(entry("call")).toBeNull();
    expect(entry("note")).not.toBeNull();
  });

  it("keeps the entry hidden through a refetch during the window", async () => {
    const { rerender } = await mount();
    confirmDelete("Call with Ada");
    rerender({ timeline: makeTimeline() });
    expect(entry("call")).toBeNull();
    expect(entry("note")).not.toBeNull();
  });

  it("shows the entry again with an error when the delete fails", async () => {
    await mount({
      deleteInteraction: vi.fn(() => Promise.reject(new Error("HTTP 500"))),
    });
    confirmDelete("Call with Ada");
    act(() => lastToast().onAutoClose());
    await waitFor(() => expect(entry("call")).not.toBeNull());
    expect(toastMock.error).toHaveBeenCalledWith(
      "Could not delete the interaction. It is back on the timeline",
    );
  });

  it("sends the delete when the fallback timer runs out, and closes the toast", async () => {
    const { props } = await mount();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    confirmDelete("Call with Ada");

    act(() => vi.advanceTimersByTime(FALLBACK_MS - 1));
    expect(props.deleteInteraction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(props.deleteInteraction).toHaveBeenCalledTimes(1);
    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1");

    // The toast's own close then comes too late to send a second request.
    act(() => lastToast().onDismiss());
    expect(props.deleteInteraction).toHaveBeenCalledTimes(1);
  });

  it("sends every waiting delete with keepalive when the page is hidden", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { props } = await mount();
    confirmDelete("Call with Ada");
    const options = lastToast();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/interactions/call", {
      method: "DELETE",
      keepalive: true,
    });
    expect(toastMock.dismiss).toHaveBeenCalledWith("toast-1");

    act(() => options.onDismiss());
    expect(props.deleteInteraction).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(entry("call")).toBeNull();
  });

  it("shows the entry again when the pagehide request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    await mount();
    confirmDelete("Call with Ada");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() => expect(entry("call")).not.toBeNull());
    expect(toastMock.error).toHaveBeenCalledTimes(1);
  });

  it("starts the same confirmation from the modal's Delete button", async () => {
    const { props } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Call with Ada" }));
    const remove = screen.getByRole("button", { name: "Delete" });
    expect(remove.className).not.toContain("text-error");
    remove.focus();
    fireEvent.click(remove);

    const dialog = screen.getByRole("dialog", {
      name: "Delete this interaction?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    // The confirmation opens over the note, and Cancel goes back to it.
    await waitFor(() => expect(document.activeElement).toBe(remove));
    expect(entry("call")).not.toBeNull();
    expect(props.deleteInteraction).not.toHaveBeenCalled();
  });
});

describe("the entrance", () => {
  // The contact page is built anew on each return to the Network page. The
  // tab faded in and every entry slid in again each time, so the page went
  // on moving for 400 ms after it had drawn.
  it("draws the tab and the entries already there at once", async () => {
    const { view } = await mount();
    expect(view.container.querySelector(".timeline-enter")).toBeNull();
    expect(entry("call")!.classList.contains("timeline-entry")).toBe(false);
  });

  it("slides in an entry that arrives after the tab has drawn", async () => {
    const { rerender } = await mount();
    rerender({
      timeline: [
        ...makeTimeline(),
        makeItem("new", "Just logged", at(2026, 9, 29)),
      ],
    });
    expect(entry("new")!.classList.contains("timeline-entry")).toBe(true);
    expect(entry("call")!.classList.contains("timeline-entry")).toBe(false);
  });

  it("slides in the entries that arrive after the timeline loads", async () => {
    const { rerender } = await mount({ timeline: [], timelineLoading: true });
    rerender({ timeline: makeTimeline(), timelineLoading: false });
    expect(entry("call")!.classList.contains("timeline-entry")).toBe(true);
  });
});

describe("the tab", () => {
  it("shows the empty state once every entry is waiting to be deleted", async () => {
    await mount({
      timeline: [makeItem("only", "Only entry", at(2026, 9, 15))],
    });
    expect(screen.queryByText("No interactions yet")).toBeNull();
    confirmDelete("Only entry");
    expect(screen.getByText("No interactions yet")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("says it is loading instead of showing the empty state", async () => {
    await mount({ timeline: [], timelineLoading: true });
    expect(screen.getByText("Loading timeline...")).toBeTruthy();
    expect(screen.queryByText("No interactions yet")).toBeNull();
  });

  it("passes the collapsible layout to the composer", async () => {
    await mount({ composerCollapsible: true });
    expect(
      screen.getByTestId("composer").getAttribute("data-collapsible"),
    ).toBe("true");
  });

  it("opens and scrolls to the entry that ?interaction= names", async () => {
    // jsdom lays nothing out and has no scrollIntoView.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      await mount({}, "/contact/c1?interaction=aug");
      expect(
        await screen.findByRole("heading", {
          level: 2,
          name: "Coffee in August",
        }),
      ).toBeTruthy();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
