// @vitest-environment jsdom
// =============================================================================
// The Track button, the toggle behind it, and the `t` key
// =============================================================================
// One control says whether a person keeps up with a contact, and how often.
// It is a toggle button with `aria-pressed` and one word, Track or Tracked,
// with a caret at its right end while tracked that opens the cadence menu.
// Pressing the word writes the flag, toasts with an Undo, and the Undo puts
// the contact back as it was, cadence included. The `t` key on the contact
// page does the same through the same hook, so the words and the Undo are
// tested once here.
//
// The word must not move when the state changes. The header cluster is
// right-aligned, so the control has to be the same width in both states: the
// caret's slot is held open while untracked, and the label is sized to the
// longer word. Both are checked here, and measured for real in
// tests/e2e/contact.spec.ts.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

/** Every request the hooks make, answered as the server would. */
const api = vi.hoisted(() => ({
  fetch: vi.fn(),
  /**
   * When set, the next request waits here until `release` is called, so the
   * optimistic state can be read. It must be released before the test ends:
   * writes to one contact queue behind each other.
   */
  hold: false,
  release: null as null | (() => void),
}));
vi.mock("../../src/api/client", () => ({
  apiFetch: (...args: unknown[]) => api.fetch(...args),
}));

const prefs = vi.hoisted(() => ({ singleKeyShortcuts: true }));
vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences: prefs }),
}));

import { TrackButton } from "../../src/views/contact-detail/components/TrackButton";
import { useTrackShortcut } from "../../src/views/contact-detail/components/useTrackShortcut";
import type { Contact } from "../../src/types";

const ADA = {
  id: "c1",
  name: "Ada Lovelace",
  isTracked: false,
  cadenceDays: 60,
  isGhost: false,
};

/** The body of the last PATCH the hooks sent. */
function lastBody(): Record<string, unknown> {
  const call = api.fetch.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

/** The Undo action of the last success toast. */
function lastUndo(): () => void {
  const options = toastMock.success.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => void };
  };
  return options.action.onClick;
}

let client: QueryClient;

function mount(ui: React.ReactElement, path = "/contact/c1") {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["contacts", "c1"], ADA as unknown as Contact);
  client.setQueryData(["contacts"], [ADA] as unknown as Contact[]);
  api.hold = false;
  api.release = null;
  api.fetch.mockImplementation(async (_url: string, init: RequestInit) => {
    if (api.hold) {
      await new Promise<void>((resolve) => {
        api.release = resolve;
      });
    }
    const body = JSON.parse(init.body as string) as Partial<Contact>;
    // A flip to tracked takes the default cadence unless the body names one.
    const cadenceDays =
      body.isTracked && body.cadenceDays === undefined
        ? 90
        : (body.cadenceDays ?? ADA.cadenceDays);
    return { json: async () => ({ ...ADA, ...body, cadenceDays }) };
  });
  prefs.singleKeyShortcuts = true;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackButton", () => {
  it("is a pressed toggle that says Tracked, and an unpressed one that says Track", () => {
    const { unmount } = mount(<TrackButton contact={ADA} />);
    const off = screen.getByRole("button", { name: "Track" });
    expect(off.getAttribute("aria-pressed")).toBe("false");
    unmount();

    mount(<TrackButton contact={{ ...ADA, isTracked: true }} />);
    const on = screen.getByRole("button", { name: "Tracked" });
    expect(on.getAttribute("aria-pressed")).toBe("true");
  });

  it("is a split button in both states: the word, then the caret", () => {
    const { unmount } = mount(<TrackButton contact={ADA} />);
    // Untracked, the caret says what it is for rather than naming a cadence
    // nobody has set. No empty slot, and no control that arrives on press.
    const off = screen.getByRole("button", { name: "Track" });
    const offCaret = screen.getByRole("button", {
      name: "Track, and choose how often",
    });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(offCaret.getAttribute("aria-haspopup")).toBe("menu");
    expect(offCaret.getAttribute("aria-expanded")).toBe("false");
    expect(
      off.compareDocumentPosition(offCaret) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(off.parentElement).toBe(offCaret.closest("div")?.parentElement);
    unmount();
    cleanup();

    // Tracked, the same two halves, and the caret now names the cadence.
    mount(<TrackButton contact={{ ...ADA, isTracked: true }} />);
    const on = screen.getByRole("button", { name: "Tracked" });
    const onCaret = screen.getByRole("button", {
      name: "Cadence: every 2 months",
    });
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(onCaret.textContent).toBe("");
    expect(on.parentElement).toBe(onCaret.closest("div")?.parentElement);
  });

  it("sizes the label to the longer word, so the shorter one cannot shift", () => {
    // "Track" is drawn over an invisible "Tracked": the text box is the same
    // width whichever word it is.
    const { unmount } = mount(<TrackButton contact={ADA} />);
    expect(screen.getByRole("button", { name: "Track" }).textContent).toBe(
      "TrackedTrack",
    );
    unmount();
    cleanup();

    mount(<TrackButton contact={{ ...ADA, isTracked: true }} />);
    expect(screen.getByRole("button", { name: "Tracked" }).textContent).toBe(
      "TrackedTracked",
    );
  });

  it("keeps the word in the name and the tooltip when compact", () => {
    mount(<TrackButton contact={ADA} compact />);
    const button = screen.getByRole("button", { name: "Track" });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Track");
  });

  it("tracks on press, says the cadence the server chose, and Undo untracks", async () => {
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(screen.getByRole("button", { name: "Track" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(api.fetch).toHaveBeenCalledWith(
      "/contacts/c1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(lastBody()).toEqual({ isTracked: true });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Tracking Ada Lovelace, every 3 months",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );

    await act(async () => lastUndo()());
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(lastBody()).toEqual({ isTracked: false });
  });

  it("untracks on press, and Undo tracks again with the cadence the contact had", async () => {
    mount(<TrackButton contact={{ ...ADA, isTracked: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "Tracked" }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ isTracked: false });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Stopped tracking Ada Lovelace",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );

    await act(async () => lastUndo()());
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(lastBody()).toEqual({ isTracked: true, cadenceDays: 60 });
  });

  it("writes the flag into both caches before the server answers", async () => {
    api.hold = true;
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(screen.getByRole("button", { name: "Track" }));

    await waitFor(() =>
      expect(client.getQueryData<Contact>(["contacts", "c1"])?.isTracked).toBe(
        true,
      ),
    );
    expect(client.getQueryData<Contact[]>(["contacts"])?.[0].isTracked).toBe(
      true,
    );
    expect(
      client.getQueryData<Contact>(["contacts", "c1"])?.trackedAt,
    ).toBeTruthy();
    expect(toastMock.success).not.toHaveBeenCalled();

    await waitFor(() => expect(api.release).toBeTruthy());
    await act(async () => api.release?.());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
  });

  it("puts both caches back and says so when the write fails", async () => {
    api.fetch.mockImplementation(async () => {
      throw new Error("offline");
    });
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(screen.getByRole("button", { name: "Track" }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      "Could not change tracking: offline",
    );
    expect(client.getQueryData<Contact>(["contacts", "c1"])?.isTracked).toBe(
      false,
    );
    expect(client.getQueryData<Contact[]>(["contacts"])?.[0].isTracked).toBe(
      false,
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe("the t key", () => {
  function press(key = "t", target: EventTarget = document.body) {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  function wrapper(path: string) {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  it("tracks the open contact, toast and Undo included", async () => {
    renderHook(() => useTrackShortcut(ADA), {
      wrapper: wrapper("/contact/c1"),
    });
    const event = press();
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ isTracked: true });
    expect(toastMock.success.mock.calls[0][0]).toBe(
      "Tracking Ada Lovelace, every 3 months",
    );
  });

  it("untracks a tracked contact, over the map as well", async () => {
    renderHook(() => useTrackShortcut({ ...ADA, isTracked: true }), {
      wrapper: wrapper("/map/contact/c1"),
    });
    press();
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ isTracked: false });
  });

  it("steps aside in a field, with a modifier, for a ghost, off the page, and when single keys are off", async () => {
    const field = document.createElement("input");
    document.body.appendChild(field);

    const cases: [string, () => ReturnType<typeof renderHook>][] = [
      [
        "a field",
        () => {
          const hook = renderHook(() => useTrackShortcut(ADA), {
            wrapper: wrapper("/contact/c1"),
          });
          field.focus();
          press("t", field);
          return hook;
        },
      ],
      [
        "a modifier",
        () => {
          const hook = renderHook(() => useTrackShortcut(ADA), {
            wrapper: wrapper("/contact/c1"),
          });
          act(() => {
            document.body.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "t",
                metaKey: true,
                bubbles: true,
              }),
            );
          });
          return hook;
        },
      ],
      [
        "a ghost",
        () => {
          const hook = renderHook(
            () => useTrackShortcut({ ...ADA, isGhost: true }),
            { wrapper: wrapper("/contact/c1") },
          );
          press();
          return hook;
        },
      ],
      [
        "the archived page",
        () => {
          const hook = renderHook(() => useTrackShortcut(ADA), {
            wrapper: wrapper("/settings/archived"),
          });
          press();
          return hook;
        },
      ],
      [
        "single keys off",
        () => {
          prefs.singleKeyShortcuts = false;
          const hook = renderHook(() => useTrackShortcut(ADA), {
            wrapper: wrapper("/contact/c1"),
          });
          press();
          return hook;
        },
      ],
    ];

    for (const [name, run] of cases) {
      const hook = run();
      field.blur();
      await Promise.resolve();
      expect(api.fetch, name).not.toHaveBeenCalled();
      hook.unmount();
      prefs.singleKeyShortcuts = true;
    }
    field.remove();
  });
});
