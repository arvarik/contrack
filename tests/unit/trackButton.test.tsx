// @vitest-environment jsdom
// =============================================================================
// The Track button, the menu behind it, and the `t` key
// =============================================================================
// One control says whether a person keeps up with a contact, and how often.
// It is one menu button, 32 px tall, with no divider: "◎ Track ▾" before the
// contact is tracked and "◎ Quarterly ▾" after, in the selected tint. The
// menu offers four cadences in one word each, Weekly, Monthly, Quarterly and
// Yearly, and while tracked the current one is checked and Stop tracking
// comes last. A cadence saved before 2.0 (60 or 180 days) still shows, as
// one more checked row in its place. Every change toasts, and tracking and
// stopping carry an Undo that puts the contact back as it was, cadence
// included. The `t` key stays a one-key toggle through the same hook, so the
// words and the Undo are tested once here.
//
// The control must not change width when its word changes. The header
// cluster is right-aligned, so every word the button can show sizes the
// label, and the current word is drawn over them. That is checked here, and
// measured for real in tests/e2e/contact.spec.ts.
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
  within,
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

const prefs = vi.hoisted(() => ({
  singleKeyShortcuts: true,
  defaultCadenceDays: 90,
}));
vi.mock("../../src/contexts/PreferencesContext", () => ({
  usePreferences: () => ({ preferences: prefs }),
}));

import {
  TRACK_LABEL,
  TrackButton,
  trackingLabel,
} from "../../src/views/contact-detail/components/TrackButton";
import { useTrackShortcut } from "../../src/views/contact-detail/components/useTrackShortcut";
import type { Contact } from "../../src/types";

const ADA = {
  id: "c1",
  name: "Ada Lovelace",
  isTracked: false,
  cadenceDays: 60,
  isGhost: false,
};
const TRACKED = { ...ADA, isTracked: true, cadenceDays: 90 };

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

/** The word on screen: the layer over the invisible sizers. */
function visibleWord(button: HTMLElement): string {
  const layers = Array.from(button.querySelectorAll("span.grid > span"));
  return layers.find((span) => !span.classList.contains("invisible"))
    ?.textContent as string;
}

/** Open the menu from its button and return it. */
function openMenu(name: string | RegExp): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("menu");
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
  prefs.defaultCadenceDays = 90;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TrackButton", () => {
  it("is one menu button that says Track, and is named for what it does", () => {
    mount(<TrackButton contact={ADA} />);
    const button = screen.getByRole("button", { name: TRACK_LABEL });
    expect(TRACK_LABEL).toBe("Track, choose how often");
    // One control, no divider and no second half.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(visibleWord(button)).toBe("Track");
    // 32 px tall, like `.btn-sm`, with 4 px corners, on the container fill.
    expect(button.className).toContain("h-8");
    expect(button.className).toContain("rounded-md");
    expect(button.className).toContain("bg-surface-container-high");
  });

  it("says the cadence in one word while tracked, in the selected tint", () => {
    const { unmount } = mount(<TrackButton contact={TRACKED} />);
    const button = screen.getByRole("button", {
      name: "Tracking quarterly, change or stop",
    });
    expect(visibleWord(button)).toBe("Quarterly");
    expect(button.className).toContain("bg-primary/10");
    expect(button.className).toContain("text-on-primary-wash");
    // The glyph takes the primary while tracked.
    expect(button.querySelector("svg")?.getAttribute("class")).toContain(
      "text-primary",
    );
    unmount();

    // A cadence off the list, saved before 2.0, in its short form.
    mount(<TrackButton contact={{ ...TRACKED, cadenceDays: 60 }} />);
    const off = screen.getByRole("button", {
      name: trackingLabel(60),
    });
    expect(trackingLabel(60)).toBe("Tracking every 2 months, change or stop");
    expect(visibleWord(off)).toBe("2 months");
  });

  it("sizes the label to every word it can show, so a change cannot move it", () => {
    const words = (button: HTMLElement) =>
      Array.from(button.querySelectorAll("span.grid > span.invisible")).map(
        (span) => span.textContent,
      );
    const all = [
      "Track",
      "Weekly",
      "Monthly",
      "2 months",
      "Quarterly",
      "6 months",
      "Yearly",
    ];
    const { unmount } = mount(<TrackButton contact={ADA} />);
    expect(words(screen.getByRole("button"))).toEqual(all);
    unmount();
    cleanup();

    mount(<TrackButton contact={TRACKED} />);
    expect(words(screen.getByRole("button"))).toEqual(all);
    cleanup();

    // A value no menu offers joins the sizers, so it is never cut off.
    mount(<TrackButton contact={{ ...TRACKED, cadenceDays: 45 }} />);
    const button = screen.getByRole("button");
    expect(words(button)).toEqual([...all, "45 days"]);
    expect(visibleWord(button)).toBe("45 days");
  });

  it("draws the glyph and the chevron alone when compact, with the words in the name and the tooltip", () => {
    mount(<TrackButton contact={TRACKED} compact />);
    const button = screen.getByRole("button", {
      name: "Tracking quarterly, change or stop",
    });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe(
      "Tracking quarterly, change or stop",
    );
    expect(button.querySelectorAll("svg")).toHaveLength(2);
  });
});

describe("the menu before the contact is tracked", () => {
  it("lists the four cadences under Keep up, none checked, and marks the default", () => {
    mount(<TrackButton contact={ADA} />);
    const menu = openMenu(TRACK_LABEL);
    expect(within(menu).getByText("Keep up")).toBeTruthy();
    // Plain items, not checkboxes: there is no cadence yet to be checked.
    expect(within(menu).queryAllByRole("menuitemcheckbox")).toHaveLength(0);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Weekly",
      "Monthly",
      "QuarterlyDefault",
      "Yearly",
    ]);
    // The hint is heard too, after a pause.
    expect(
      within(menu).getByRole("menuitem", { name: "Quarterly, Default" }),
    ).toBeTruthy();
    // The stored cadence nobody chose for this contact (60) is not a row.
    expect(
      within(menu).queryByRole("menuitem", { name: /2 months/ }),
    ).toBeNull();
  });

  it("adds the account's default as a row when it is off the list", () => {
    prefs.defaultCadenceDays = 180;
    mount(<TrackButton contact={ADA} />);
    const items = within(openMenu(TRACK_LABEL)).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Weekly",
      "Monthly",
      "Quarterly",
      "Every 6 monthsDefault",
      "Yearly",
    ]);
  });

  it("tracks at the chosen cadence in one press, with the toast and an Undo", async () => {
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(
      within(openMenu(TRACK_LABEL)).getByRole("menuitem", { name: "Weekly" }),
    );

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(api.fetch).toHaveBeenCalledWith(
      "/contacts/c1",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(lastBody()).toEqual({ isTracked: true, cadenceDays: 7 });
    expect(toastMock.success).toHaveBeenCalledWith(
      "Tracking Ada Lovelace, weekly",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );

    await act(async () => lastUndo()());
    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(lastBody()).toEqual({ isTracked: false });
  });
});

describe("the menu while tracked", () => {
  it("checks the current cadence, and ends with Stop tracking", () => {
    mount(<TrackButton contact={TRACKED} />);
    const menu = openMenu(/^Tracking/);
    expect(within(menu).getByText("Keep up")).toBeTruthy();
    const rows = within(menu).getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Weekly",
      "Monthly",
      "Quarterly",
      "Yearly",
    ]);
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    const actions = within(menu).getAllByRole("menuitem");
    expect(actions.map((item) => item.textContent)).toEqual(["Stop tracking"]);
    // Last in the menu, after the cadences.
    expect(
      rows[3].compareDocumentPosition(actions[0]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows a cadence off the list as one more checked row, in its place", () => {
    mount(<TrackButton contact={{ ...TRACKED, cadenceDays: 60 }} />);
    const rows = within(openMenu(/^Tracking/)).getAllByRole("menuitemcheckbox");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Weekly",
      "Monthly",
      "Every 2 months",
      "QuarterlyDefault",
      "Yearly",
    ]);
    expect(rows[2].getAttribute("aria-checked")).toBe("true");
    expect(
      rows
        .filter((_, index) => index !== 2)
        .every((row) => row.getAttribute("aria-checked") === "false"),
    ).toBe(true);
  });

  it("writes another cadence and toasts the contact and the word", async () => {
    mount(<TrackButton contact={TRACKED} />);
    fireEvent.click(
      within(openMenu(/^Tracking/)).getByRole("menuitemcheckbox", {
        name: "Monthly",
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(api.fetch).toHaveBeenCalledWith(
      "/contacts/c1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ cadenceDays: 30 }),
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith("Ada Lovelace, monthly");
  });

  it("does nothing when the current cadence is chosen again", async () => {
    mount(<TrackButton contact={TRACKED} />);
    fireEvent.click(
      within(openMenu(/^Tracking/)).getByRole("menuitemcheckbox", {
        name: "Quarterly",
      }),
    );
    await Promise.resolve();
    expect(api.fetch).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("stops tracking, and Undo tracks again with the cadence the contact had", async () => {
    mount(<TrackButton contact={{ ...TRACKED, cadenceDays: 60 }} />);
    fireEvent.click(
      within(openMenu(/^Tracking/)).getByRole("menuitem", {
        name: "Stop tracking",
      }),
    );

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
});

describe("a change on its way", () => {
  it("writes the flag into both caches before the server answers, and holds the rows", async () => {
    api.hold = true;
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(
      within(openMenu(TRACK_LABEL)).getByRole("menuitem", {
        name: /^Quarterly/,
      }),
    );

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

    // The rows wait, so a second press cannot race the first.
    const rows = within(openMenu(TRACK_LABEL)).getAllByRole("menuitem");
    expect(
      rows.every((row) => row.getAttribute("aria-disabled") === "true"),
    ).toBe(true);

    await waitFor(() => expect(api.release).toBeTruthy());
    await act(async () => api.release?.());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
  });

  it("puts both caches back and says so when the write fails", async () => {
    api.fetch.mockImplementation(async () => {
      throw new Error("offline");
    });
    mount(<TrackButton contact={ADA} />);
    fireEvent.click(
      within(openMenu(TRACK_LABEL)).getByRole("menuitem", { name: "Yearly" }),
    );

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

  it("tracks the open contact at the default cadence, toast and Undo included", async () => {
    renderHook(() => useTrackShortcut(ADA), {
      wrapper: wrapper("/contact/c1"),
    });
    const event = press();
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(lastBody()).toEqual({ isTracked: true });
    expect(toastMock.success.mock.calls[0][0]).toBe(
      "Tracking Ada Lovelace, quarterly",
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
