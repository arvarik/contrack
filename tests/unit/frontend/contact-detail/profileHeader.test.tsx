// @vitest-environment jsdom
// =============================================================================
// The contact header
// =============================================================================
// The header had a palette button, an archive button, a kebab and an unnamed
// sparkle at the same rank as the name. It now has no primary button, only a
// kebab with the rare actions in it, Enrich contact among them: a note starts
// in the composer under the tabs. The avatar carries its own pencil, "Change
// avatar", a button beside the score button and never inside it. Links on
// the meta line say that they open a new tab, and "+ link" after them adds
// one. The weather asks a third party for the contact's coordinates, so the
// narrow header, which has no room for it, must not ask.
// =============================================================================
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// AI is set up unless a test says otherwise.
const aiSetup = vi.hoisted(() => ({
  current: null as null | {
    why: "model";
    state: "setup";
    fix?: { label: string; path: string };
  },
}));
vi.mock("../../../../src/hooks/useAiSetup", () => ({
  useAiSetup: () => aiSetup.current,
  aiSetupLine: () => "No AI model is set up. Ask an admin to set one up",
}));
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The lists section reads three hooks off the `api` barrel, and the barrel
// pulls in every API module in the app. Stubs keep this file to the header.
vi.mock("../../../../src/api", () => ({
  useLists: () => ({ data: [] }),
  useAddToList: () => ({ mutate: vi.fn() }),
  useRemoveFromList: () => ({ mutate: vi.fn() }),
}));

/** The toasts, so a test can read what was offered and press Undo. */
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

/**
 * The enrichment context, which the app provides at its root. A test sets
 * what is running and reads what was started.
 */
const aiSearch = vi.hoisted(() => ({
  startSearch: vi.fn(),
  isStarting: false,
  batch: null as null | {
    status: "processing" | "complete" | "cancelled";
    jobs: { contactId: string; status: string }[];
  },
  depthFiguresApply: true,
}));
vi.mock("../../../../src/contexts/AISearchContext", async (original) => ({
  // The real rule for "this contact is being enriched", over the fake state.
  isEnriching: (
    await original<typeof import("../../../../src/contexts/AISearchContext")>()
  ).isEnriching,
  useAISearch: () => aiSearch,
  useOptionalAISearch: () => aiSearch,
}));

/** Whether AI assistance is on for the account. */
const ai = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => ai.allowed,
}));

/**
 * Whether the account shows the weather. It is off by default, so a test
 * that checks the narrow header sends no request turns it on first.
 */
const weather = vi.hoisted(() => ({ shown: false }));
vi.mock("../../../../src/contexts/PreferencesContext", async (original) => {
  const real =
    await original<
      typeof import("../../../../src/contexts/PreferencesContext")
    >();
  return {
    ...real,
    usePreferences: () => {
      const value = real.usePreferences();
      return {
        ...value,
        preferences: { ...value.preferences, showWeather: weather.shown },
      };
    },
  };
});

import { depthTime } from "../../../../src/lib/researchDepth";
import {
  ContactIntro,
  newInHeadline,
  ProfileHeader,
  type ProfileHeaderProps,
} from "../../../../src/views/contact-detail/components/ProfileHeader";
import { CLIPBOARD_DENIED } from "../../../../src/lib/clipboard";
import type { Contact } from "../../../../src/types";

const SYDNEY = { lat: -33.87, lng: 151.21 };

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    name: "Thomas Walker",
    firstName: "Thomas",
    lastName: "Walker",
    headline: null,
    role: "UX Researcher",
    company: "Umbrella Corp",
    location: "Sydney, NSW, Australia",
    birthday: null,
    preferences: null,
    avatarUrl: null,
    isGhost: false,
    isArchived: false,
    isTracked: false,
    trackedAt: null,
    addedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    cadenceDays: 30,
    lastContactedAt: null,
    nextFollowUpAt: null,
    themeColor: "brand",
    about: null,
    pronouns: "they/them",
    industry: null,
    website: null,
    ...SYDNEY,
    emails: [],
    phones: [],
    socialLinks: [
      {
        id: "s1",
        platform: "linkedin",
        url: "https://www.linkedin.com/in/ThomasWalker",
        handle: "ThomasWalker",
        source: null,
      },
      {
        id: "s2",
        platform: "twitter",
        url: "https://twitter.com/Thomas_Walker",
        handle: "@Thomas_Walker",
        source: null,
      },
    ],
    education: [],
    experience: [],
    sources: [],
    tags: [{ id: "t1", tag: "tech-lead" }],
    lists: [],
    addresses: [],
    interests: [],
    attributes: [],
    aiBriefing: null,
    aiBackground: null,
    aiSummary: null,
    aiHydratedAt: null,
    aiBriefingAt: null,
    aiResearch: null,
    searchExpansion: null,
    deletedAt: null,
    canonicalId: null,
    phoneticHash: null,
    geoSource: null,
    ownerId: "owner-1",
    scoreDirty: 0,
    interactionCount: 0,
    relationshipScore: 50,
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<ProfileHeaderProps> = {},
): ProfileHeaderProps {
  return {
    contact: makeContact(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onOpenAvatarPicker: vi.fn(),
    archiveContact: vi.fn(),
    unarchiveContact: vi.fn(),
    archivePending: false,
    updateContact: vi.fn(),
    promoteGhost: vi.fn(),
    promotePending: false,
    ...overrides,
  };
}

function mount(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every request the page makes, answered with one fixed weather reading. */
let fetchMock: ReturnType<typeof vi.fn>;

const weatherRequests = () =>
  fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("api.open-meteo.com"),
  );

beforeEach(() => {
  fetchMock = vi.fn(() =>
    Promise.resolve(
      Response.json({
        current_weather: { temperature: 13, weathercode: 0 },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  toastMock.mockClear();
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  aiSearch.startSearch.mockClear();
  aiSearch.isStarting = false;
  aiSearch.batch = null;
  ai.allowed = true;
  weather.shown = false;
});

/** A clipboard that records what it was given, or refuses. */
function stubClipboard(refuse = false) {
  const writeText = vi.fn(() =>
    refuse ? Promise.reject(new Error("denied")) : Promise.resolve(),
  );
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  return writeText;
}

/** Open the header kebab and choose an item. */
function chooseAction(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/** The Undo action of the last plain toast. */
function lastUndo(): () => void {
  const call = toastMock.mock.lastCall;
  if (!call) throw new Error("No toast was shown");
  const options = call[1] as { action: { onClick: () => void } };
  return options.action.onClick;
}

describe("the contact header", () => {
  it("names the contact in the page's h1", () => {
    mount(<ProfileHeader {...makeProps()} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("Thomas Walker");
    expect(heading.textContent).toContain("(they/them)");
  });

  it("has no Log interaction button, and keeps the kebab", () => {
    mount(<ProfileHeader {...makeProps()} />);
    expect(
      screen.queryByRole("button", { name: "Log interaction" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Contact actions" }),
    ).toBeTruthy();
  });

  it("puts the one Track menu button beside the kebab, saying the cadence once tracked", () => {
    const { unmount } = mount(<ProfileHeader {...makeProps()} />);
    const track = screen.getByRole("button", {
      name: "Track, choose how often",
    });
    expect(track.getAttribute("aria-haspopup")).toBe("menu");
    // One control: no toggle beside a caret, and no second half.
    expect(screen.queryByRole("button", { name: /^Cadence:/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Track" })).toBeNull();
    // Track comes before the kebab in the cluster.
    const kebab = screen.getByRole("button", { name: "Contact actions" });
    expect(
      track.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    unmount();

    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({ isTracked: true, cadenceDays: 90 }),
        })}
      />,
    );
    const tracked = screen.getByRole("button", {
      name: "Tracking quarterly, change or stop",
    });
    expect(tracked.textContent).toContain("Quarterly");
  });

  it("offers no Track to a ghost, which cannot be tracked", () => {
    mount(
      <ProfileHeader
        {...makeProps({ contact: makeContact({ isGhost: true }) })}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Track/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Add to Network" })).toBeTruthy();
  });

  it("has no top-level colour, archive, enrichment or briefing buttons", () => {
    mount(<ProfileHeader {...makeProps()} />);
    for (const name of [/colou?r/i, /archive/i, /enrich/i, /briefing/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("lists the eight contact actions in order, the two enrich depths after the colour", () => {
    mount(<ProfileHeader {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    const menu = screen.getByRole("menu", { name: "Contact actions" });
    const items = within(menu).getAllByRole("menuitem");
    // Each enrich row says the time a contact takes, to a screen reader too.
    const names = [
      "Change colour",
      `Enrich contact, ${depthTime("standard")}`,
      `Enrich deeply, ${depthTime("deep")}`,
      "Copy basic details",
      "Copy full details",
      "Save contact card",
      "Archive",
      "Delete",
    ];
    expect(items).toHaveLength(names.length);
    names.forEach((name, index) => {
      expect(within(menu).getByRole("menuitem", { name })).toBe(items[index]);
    });
    // Change avatar moved to the pencil on the avatar.
    expect(
      within(menu).queryByRole("menuitem", { name: "Change avatar" }),
    ).toBeNull();
  });

  it("opens the avatar picker from the pencil on the avatar", () => {
    const props = makeProps();
    const pencilRef = React.createRef<HTMLButtonElement>();
    mount(<ProfileHeader {...props} avatarEditRef={pencilRef} />);
    const pencil = screen.getByRole("button", { name: "Change avatar" });
    expect(pencil.getAttribute("title")).toBe("Change avatar");
    // The picker hands focus back to this very button when it closes.
    expect(pencilRef.current).toBe(pencil);
    fireEvent.click(pencil);
    expect(props.onOpenAvatarPicker).toHaveBeenCalledTimes(1);
    // 28 px on the 96 px avatar, with the 44 px tap box.
    expect(pencil.className).toContain("size-7");
    expect(pencil.className).toContain("hit-area");
  });

  it("puts the pencil beside the score button, never inside it", () => {
    // A tracked contact with a score: the ring is the button that explains
    // it, so the pencil has to be a sibling (axe: nested-interactive).
    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({
            isTracked: true,
            relationshipScore: 72,
            lastContactedAt: "2026-09-01T00:00:00.000Z",
          }),
        })}
      />,
    );
    const score = screen.getByRole("button", {
      name: "Relationship score 72 out of 100, explain",
    });
    const pencil = screen.getByRole("button", { name: "Change avatar" });
    expect(score.contains(pencil)).toBe(false);
    expect(pencil.parentElement?.closest("button")).toBeNull();
    // The score first, then the pencil, then the name: the reading order.
    expect(
      score.compareDocumentPosition(pencil) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the Archived chip and the ghost badge clear of the pencil", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({ isArchived: true, isGhost: true }),
        })}
      />,
    );
    const pencil = screen.getByRole("button", { name: "Change avatar" });
    const chip = screen.getByText("Archived");
    // The badge holds the tooltip that names it.
    const badge = screen.getByText("Not in your network").parentElement!
      .parentElement!;
    // The pencil holds the lower right corner, the chip sits under the
    // avatar, and the ghost badge holds the upper right corner.
    expect(pencil.className).toContain("bottom-0");
    expect(pencil.className).toContain("right-0");
    expect(chip.className).toContain("top-full");
    expect(badge.className).toContain("-top-3");
    expect(badge.className).toContain("-right-3");
  });

  it("opens social links in a new tab, and says so", () => {
    mount(<ProfileHeader {...makeProps()} />);
    for (const name of [/ThomasWalker/, /@Thomas_Walker/]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.textContent).toContain("(opens in a new tab)");
    }
    expect(
      screen.getByRole("button", { name: "Actions for ThomasWalker" }),
    ).toBeTruthy();
  });

  it("shows the short place on the meta line", () => {
    mount(<ProfileHeader {...makeProps()} />);
    expect(screen.getByText("Sydney")).toBeTruthy();
  });

  it("removes a tag, puts it back from the undo, and adds one, through the contact update", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    const update = props.updateContact as ReturnType<typeof vi.fn>;

    fireEvent.click(
      screen.getByRole("button", { name: "Remove tag tech-lead" }),
    );
    expect(update).toHaveBeenLastCalledWith({
      id: "c1",
      data: { tags: [] },
    });
    lastUndo()();
    expect(update).toHaveBeenLastCalledWith({
      id: "c1",
      data: { tags: [{ tag: "tech-lead" }] },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const field = screen.getByRole("textbox", { name: "New tag" });
    fireEvent.change(field, { target: { value: "advisor" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(update).toHaveBeenLastCalledWith({
      id: "c1",
      data: { tags: [{ tag: "tech-lead" }, { tag: "advisor" }] },
    });
  });

  it("opens the colour picker from the kebab and returns focus on Escape", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    const kebab = screen.getByRole("button", { name: "Contact actions" });
    fireEvent.click(kebab);
    fireEvent.click(screen.getByRole("menuitem", { name: "Change colour" }));

    const group = screen.getByRole("radiogroup", { name: "Contact colour" });
    const blue = within(group).getByRole("radio", { name: "Blue" });
    expect(blue.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(blue);
    // Only the checked swatch is a Tab stop.
    const tabbable = within(group)
      .getAllByRole("radio")
      .filter((radio) => radio.tabIndex === 0);
    expect(tabbable).toEqual([blue]);

    fireEvent.keyDown(blue, { key: "ArrowRight" });
    const emerald = within(group).getByRole("radio", { name: "Emerald" });
    expect(props.updateContact).toHaveBeenCalledWith({
      id: "c1",
      data: { themeColor: "emerald" },
    });
    expect(emerald.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(emerald);
    // Choosing keeps the picker open, so colours can be compared.
    expect(screen.getByRole("radiogroup", { name: "Contact colour" })).toBe(
      group,
    );

    fireEvent.keyDown(emerald, { key: "Escape" });
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.activeElement).toBe(kebab);
  });
});

describe("the contact actions", () => {
  const withDetails = () =>
    makeContact({
      emails: [
        {
          id: "e1",
          email: "thomas@umbrella.com",
          label: "work",
          isPrimary: true,
        },
      ] as Contact["emails"],
      phones: [
        { id: "p1", phone: "440-434-9585", label: "mobile", isPrimary: true },
      ] as Contact["phones"],
      birthday: "1974-05-11",
    });

  it("copies the basic details: name, emails and phones", async () => {
    const writeText = stubClipboard();
    mount(<ProfileHeader {...makeProps({ contact: withDetails() })} />);
    chooseAction("Copy basic details");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith(
      "Name: Thomas Walker\nEmail: thomas@umbrella.com\nPhone: 440-434-9585",
    );
    expect(toastMock.success).toHaveBeenCalledWith("Basic details copied");
  });

  it("copies the full details, with the role, company, birthday and place", async () => {
    const writeText = stubClipboard();
    mount(<ProfileHeader {...makeProps({ contact: withDetails() })} />);
    chooseAction("Copy full details");
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("All details copied"),
    );
    expect(writeText).toHaveBeenCalledWith(
      [
        "Name: Thomas Walker",
        "Role: UX Researcher",
        "Company: Umbrella Corp",
        "Email: thomas@umbrella.com",
        "Phone: 440-434-9585",
        "Birthday: 1974-05-11",
        "Location: Sydney, NSW, Australia",
      ].join("\n"),
    );
    cleanup();

    // Addresses win over the single location when there are any.
    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({
            addresses: [
              {
                id: "a1",
                address: "1 Main St",
                label: "home",
                isPrimary: true,
              },
              {
                id: "a2",
                address: "2 Side St",
                label: "work",
                isPrimary: false,
              },
            ] as Contact["addresses"],
          }),
        })}
      />,
    );
    chooseAction("Copy full details");
    expect(writeText).toHaveBeenLastCalledWith(
      expect.stringContaining("Location: 1 Main St | 2 Side St"),
    );
    cleanup();

    // With no email and no phone, the basic copy is the name alone.
    mount(<ProfileHeader {...makeProps()} />);
    chooseAction("Copy basic details");
    expect(writeText).toHaveBeenLastCalledWith("Name: Thomas Walker");
  });

  it("says so when the clipboard refuses", async () => {
    stubClipboard(true);
    mount(<ProfileHeader {...makeProps()} />);
    chooseAction("Copy basic details");
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(CLIPBOARD_DENIED),
    );
  });

  it("archives, and reports the result or the failure", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    chooseAction("Archive");
    const mutate = props.archiveContact as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith("c1", expect.any(Object));
    const opts = mutate.mock.calls[0][1];
    opts.onSuccess();
    // With Undo, as the Network list's Archive has.
    expect(toastMock.success).toHaveBeenCalledWith(
      "Thomas Walker archived",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
    opts.onError(new Error("offline"));
    expect(toastMock.error).toHaveBeenCalledWith("Could not save: offline");
  });

  it("unarchives an archived contact, from Unarchive in place of Archive", () => {
    const props = makeProps({ contact: makeContact({ isArchived: true }) });
    mount(<ProfileHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    const mutate = props.unarchiveContact as ReturnType<typeof vi.fn>;
    mutate.mock.calls[0][1].onSuccess();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Thomas Walker is back in Network",
      expect.any(Object),
    );
  });

  it("deletes from the last item", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    chooseAction("Delete");
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it("promotes a ghost with its own button", () => {
    const props = makeProps({ contact: makeContact({ isGhost: true }) });
    mount(<ProfileHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Network" }));
    const mutate = props.promoteGhost as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith("c1", expect.any(Object));
    mutate.mock.calls[0][1].onSuccess();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Thomas Walker added to Network",
    );
  });

  it("copies a link, and removes one with an undo that puts it back", async () => {
    const writeText = stubClipboard();
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    const update = props.updateContact as ReturnType<typeof vi.fn>;

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for ThomasWalker" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Link copied"),
    );
    expect(writeText).toHaveBeenCalledWith(
      "https://www.linkedin.com/in/ThomasWalker",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Actions for ThomasWalker" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove link" }));
    expect(update).toHaveBeenLastCalledWith({
      id: "c1",
      data: {
        socialLinks: [
          {
            platform: "twitter",
            url: "https://twitter.com/Thomas_Walker",
            handle: "@Thomas_Walker",
          },
        ],
      },
    });
    expect(toastMock).toHaveBeenLastCalledWith(
      "Link removed",
      expect.any(Object),
    );
    lastUndo()();
    expect(update.mock.lastCall?.[0].data.socialLinks).toHaveLength(2);
  });

  it("links the website when it is not one of the social links", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({ website: "https://www.umbrella.com" }),
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /umbrella\.com/ });
    expect(link.getAttribute("target")).toBe("_blank");
    // The icon comes from this server, never from a third party.
    expect(link.querySelector("img")?.getAttribute("src")).toBe(
      "/api/logos/www.umbrella.com",
    );
  });
});

describe("Enrich contact", () => {
  /** The kebab's Standard enrich item, by either of its two names. */
  function enrichItem() {
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    return screen.queryByRole("menuitem", {
      name: /^Enrich contact|^Enriching/,
    });
  }

  it.each([
    ["standard", "Enrich contact"],
    ["deep", "Enrich deeply"],
  ] as const)(
    "starts a %s run for this one contact from %s, with any limit said in a toast",
    (depth, label) => {
      mount(<ProfileHeader {...makeProps()} />);
      fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
      fireEvent.click(
        screen.getByRole("menuitem", { name: new RegExp(`^${label}`) }),
      );
      expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
        limitAs: "toast",
        depth,
      });
      // No confirmation for one contact: the run starts on the choice.
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("is not offered when AI assistance is off, or for a ghost", () => {
    ai.allowed = false;
    const { unmount } = mount(<ProfileHeader {...makeProps()} />);
    expect(enrichItem()).toBeNull();
    unmount();

    ai.allowed = true;
    mount(
      <ProfileHeader
        {...makeProps({ contact: makeContact({ isGhost: true }) })}
      />,
    );
    expect(enrichItem()).toBeNull();
  });

  it("reads Enriching… and waits while a start is on its way", () => {
    aiSearch.isStarting = true;
    mount(<ProfileHeader {...makeProps()} />);
    const item = enrichItem()!;
    expect(item.textContent).toBe("Enriching…");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(aiSearch.startSearch).not.toHaveBeenCalled();
  });

  it("waits while the running batch has an unfinished job for this contact, and only this one", () => {
    aiSearch.batch = {
      status: "processing",
      jobs: [
        { contactId: "c1", status: "searching" },
        { contactId: "c2", status: "queued" },
      ],
    };
    const { unmount } = mount(<ProfileHeader {...makeProps()} />);
    expect(enrichItem()!.getAttribute("aria-disabled")).toBe("true");
    unmount();

    // This contact's job is done, another's is not: the item is free.
    aiSearch.batch = {
      status: "processing",
      jobs: [
        { contactId: "c1", status: "success" },
        { contactId: "c2", status: "searching" },
      ],
    };
    const again = mount(<ProfileHeader {...makeProps()} />);
    const item = enrichItem()!;
    expect(item.textContent).toContain("Enrich contact");
    expect(item.getAttribute("aria-disabled")).toBeNull();
    again.unmount();

    // A batch that has finished holds nothing back.
    aiSearch.batch = {
      status: "cancelled",
      jobs: [{ contactId: "c1", status: "queued" }],
    };
    mount(<ProfileHeader {...makeProps()} />);
    expect(enrichItem()!.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("+ link", () => {
  it("ends the meta line after the last link, with no dot before it", () => {
    mount(<ProfileHeader {...makeProps()} />);
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add.textContent).toBe("link");
    const line = add.parentElement!;
    expect(line.lastElementChild).toBe(add);
    // The item before it is the last link, and nothing sits between them.
    const lastLink = screen.getByRole("link", { name: /@Thomas_Walker/ });
    expect(add.previousElementSibling?.contains(lastLink)).toBe(true);
  });

  it("adds the link as a URL alone, after the links the contact has", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const field = screen.getByRole("textbox", { name: "New link" });
    fireEvent.change(field, { target: { value: "github.com/thomaswalker" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(props.updateContact).toHaveBeenCalledWith({
      id: "c1",
      data: {
        socialLinks: [
          {
            platform: "linkedin",
            url: "https://www.linkedin.com/in/ThomasWalker",
            handle: "ThomasWalker",
          },
          {
            platform: "twitter",
            url: "https://twitter.com/Thomas_Walker",
            handle: "@Thomas_Walker",
          },
          { url: "https://github.com/thomaswalker" },
        ],
      },
    });
    // Closed, with focus back on "+ link" rather than on the page.
    expect(screen.queryByRole("textbox", { name: "New link" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add link" }),
    );
  });

  it("keeps focus on + link while the new link arrives in front of it", () => {
    const client = new QueryClient();
    const wrap = (ui: React.ReactElement) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    );
    const props = makeProps();
    const { rerender } = render(wrap(<ProfileHeader {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const field = screen.getByRole("textbox", { name: "New link" });
    fireEvent.change(field, { target: { value: "github.com/thomaswalker" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const add = screen.getByRole("button", { name: "Add link" });
    expect(document.activeElement).toBe(add);

    // The save answers, and the new link is the last one now.
    const links = makeContact().socialLinks;
    rerender(
      wrap(
        <ProfileHeader
          {...props}
          contact={makeContact({
            socialLinks: [
              ...links,
              {
                id: "s3",
                platform: "github",
                url: "https://github.com/thomaswalker",
                handle: "thomaswalker",
                source: null,
              },
            ],
          })}
        />,
      ),
    );
    expect(
      screen.getByRole("link", { name: /thomaswalker, Github/ }),
    ).toBeTruthy();
    // The same button, still focused: it was not rebuilt.
    expect(screen.getByRole("button", { name: "Add link" })).toBe(add);
    expect(document.activeElement).toBe(add);
  });

  it("refuses the website again, in another spelling", () => {
    const props = makeProps({
      contact: makeContact({ website: "https://www.umbrella.com" }),
    });
    mount(<ProfileHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    const field = screen.getByRole("textbox", { name: "New link" });
    fireEvent.change(field, { target: { value: "umbrella.com/" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(
      "This contact already has that link",
    );
    expect(props.updateContact).not.toHaveBeenCalled();
  });

  it("shows for a contact with no place, time or links yet", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          contact: makeContact({
            socialLinks: [],
            location: null,
            lat: null,
            lng: null,
          }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
  });
});

describe("the narrow header", () => {
  it("names where Back goes, and says Back when it does not know", () => {
    const onClose = vi.fn();
    mount(
      <ProfileHeader
        {...makeProps({ onClose, layout: "narrow", backLabel: "Network" })}
      />,
    );
    const back = screen.getByRole("button", { name: "Back to Network" });
    expect(back.textContent).toBe("Network");
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    mount(<ProfileHeader {...makeProps({ onClose, layout: "narrow" })} />);
    expect(screen.getByRole("button", { name: "Back" }).textContent).toBe(
      "Back",
    );
  });

  it("keeps the name, the role, the meta line and the kebab, and nothing else", async () => {
    // The account shows the weather, so only the layout can leave it out.
    weather.shown = true;
    const contact = makeContact({
      headline: "Researching how teams plan",
      aiSummary: "Runs the research guild.",
    });
    mount(<ProfileHeader {...makeProps({ layout: "narrow", contact })} />);
    expect(screen.getByRole("heading", { level: 1 }).className).toContain(
      "text-2xl",
    );
    expect(screen.getByText("Sydney")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Contact actions" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Log interaction" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Add tag" })).toBeNull();
    expect(screen.queryByText("Researching how teams plan")).toBeNull();
    expect(screen.queryByText("Runs the research guild.")).toBeNull();
    // No weather in the narrow header, so no request for it.
    await act(async () => {});
    expect(weatherRequests()).toHaveLength(0);

    // The wide header asks once in the same wait, so the check above can fail.
    cleanup();
    mount(<ProfileHeader {...makeProps({ contact })} />);
    await act(async () => {});
    expect(weatherRequests()).toHaveLength(1);
  });

  it("draws the avatar in a 56 px box, with no ring for an untracked contact", () => {
    mount(<ProfileHeader {...makeProps({ layout: "narrow" })} />);
    expect(
      screen.queryByRole("img", { name: /score|interactions/i }),
    ).toBeNull();
    const box = document.querySelector("[data-score-band]") as HTMLElement;
    expect(box.getAttribute("data-score-band")).toBe("untracked");
    expect(box.style.width).toBe("56px");
  });

  it("draws the 56 px ring once somebody tracks the contact", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          layout: "narrow",
          contact: makeContact({ isTracked: true }),
        })}
      />,
    );
    const ring = screen.getByRole("img", { name: "No interactions yet" });
    expect(ring.style.width).toBe("56px");
  });

  it("puts a ghost's Promote button under the meta line", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          layout: "narrow",
          contact: makeContact({ isGhost: true }),
        })}
      />,
    );
    const promote = screen.getByRole("button", { name: "Add to Network" });
    expect(promote.className).toContain("mt-3");
    // After the meta line, not in the name row above it.
    expect(
      screen.getByText("Sydney").compareDocumentPosition(promote) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the follow-up banner", () => {
  // The banner read "Pending follow-up alert", which said neither what was
  // due nor when. It says the fact now, in calendar days, in the words and
  // tones Pulse gives a due chip: overdue is the error red, today the
  // primary, and a later day within the week neutral. Past the week the
  // Details card has it.
  const TUESDAY_NOON = new Date(2026, 8, 22, 12, 0);
  /** 9 AM on a day of September 2026, in the reader's zone, as the API sends. */
  const dueOn = (day: number) => new Date(2026, 8, day, 9, 0).toISOString();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(TUESDAY_NOON);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The banner's words, or null when there is no banner. */
  function banner(nextFollowUpAt: string | null) {
    mount(
      <ProfileHeader
        {...makeProps({ contact: makeContact({ nextFollowUpAt }) })}
      />,
    );
    return screen.queryByText(/^Follow-up /);
  }

  // The words come from describeFollowUp, and followUp.test.ts owns them.
  // The banner owns the text it prints, the tone's class and the week.
  it.each([
    ["Follow-up 3 days overdue", 19, "text-error"],
    // Due at 9 AM, and it is noon: still today, not overdue.
    ["Follow-up due today", 22, "text-on-primary-wash"],
    // A week out, the last day Pulse's This week holds. Pulse's This week
    // takes day 7, and the banner stopped at day 6.
    ["Follow-up due in 7 days", 29, "text-on-surface-variant"],
  ])(
    "says %s for a follow-up due on September %i, in %s",
    (words, day, tone) => {
      const text = banner(dueOn(day));
      expect(text?.textContent).toBe(words);
      expect(text?.parentElement?.className).toContain(tone);
    },
  );

  it("shows no banner past the week, or with no follow-up", () => {
    expect(banner(dueOn(30))).toBeNull();
    cleanup();
    expect(banner(null)).toBeNull();
  });
});

describe("the headline and the summary", () => {
  it("shows a headline that says something new, and the summary", () => {
    mount(
      <ContactIntro
        contact={makeContact({
          headline: "Researching how teams plan",
          aiSummary: "Runs the research guild.",
        })}
        onUpdate={vi.fn()}
      />,
    );
    expect(screen.getByText("Researching how teams plan")).toBeTruthy();
    expect(screen.getByText("Runs the research guild.")).toBeTruthy();
  });

  it("renders nothing when the headline repeats the role and there is no summary", () => {
    const { container } = render(
      <ContactIntro
        contact={makeContact({ headline: "UX Researcher at Umbrella Corp" })}
        onUpdate={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows only the part of a headline the role line does not say", () => {
    const at = { role: "Partner", company: "Northwind Partners" };
    expect(
      newInHeadline({
        ...at,
        headline: "Partner at Northwind Partners | Investor",
      }),
    ).toBe("Investor");
    expect(
      newInHeadline({ ...at, headline: "Partner, Northwind Partners" }),
    ).toBeNull();
  });
});
