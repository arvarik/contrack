// @vitest-environment jsdom
// =============================================================================
// The contact header and the briefing card
// =============================================================================
// The header had a palette button, an archive button, a kebab and an unnamed
// sparkle at the same rank as the name. It now has no primary button, only a
// kebab with the rare actions in it, Enrich contact among them: a note starts
// in the composer under the tabs. The avatar carries its own pencil, "Change
// avatar", a button beside the score button and never inside it. Links on
// the meta line say that they open a new tab, and "+ link" after them adds
// one. The weather asks a third party for the contact's coordinates, so it
// must not ask when it is not allowed to.
//
// The briefing moved from a modal behind the sparkle to a card at the top of
// the Dossier tab, with a labelled button, a status line and an error line.
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
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The lists section reads three hooks off the `api` barrel, and the barrel
// pulls in every API module in the app. Stubs keep this file to the header.
vi.mock("../../src/api", () => ({
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
}));
vi.mock("../../src/contexts/AISearchContext", () => ({
  useAISearch: () => aiSearch,
}));

/** Whether AI assistance is on for the account. */
const ai = vi.hoisted(() => ({ allowed: true }));
vi.mock("../../src/hooks/useAiAllowed", () => ({
  useAiAllowed: () => ai.allowed,
}));

import {
  ContactIntro,
  ProfileHeader,
  type ProfileHeaderProps,
} from "../../src/views/contact-detail/components/ProfileHeader";
import {
  basicDetailsText,
  fullDetailsText,
} from "../../src/views/contact-detail/components/ContactActionsMenu";
import { CLIPBOARD_DENIED } from "../../src/lib/clipboard";
import {
  DossierTab,
  type BriefingMutation,
} from "../../src/views/contact-detail/components/DossierTab";
import { LocalTimeWeather } from "../../src/components/LocalTimeWeather";
import type { Contact } from "../../src/types";

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
    archiveContact: { mutate: vi.fn(), isPending: false },
    unarchiveContact: { mutate: vi.fn(), isPending: false },
    updateContact: { mutate: vi.fn() },
    promoteGhost: { mutate: vi.fn(), isPending: false },
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
  const options = toastMock.mock.calls.at(-1)?.[1] as {
    action: { onClick: () => void };
  };
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

  it("shows Track as the glyph and the chevron in the narrow header, with the words in the name", () => {
    mount(
      <ProfileHeader
        {...makeProps({
          layout: "narrow",
          contact: makeContact({ isTracked: true, cadenceDays: 90 }),
        })}
      />,
    );
    const track = screen.getByRole("button", {
      name: "Tracking quarterly, change or stop",
    });
    expect(track.textContent).toBe("");
    expect(track.getAttribute("title")).toBe(
      "Tracking quarterly, change or stop",
    );
  });

  it("offers no Track to a ghost, which cannot be tracked", () => {
    mount(
      <ProfileHeader
        {...makeProps({ contact: makeContact({ isGhost: true }) })}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Track/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Promote to contact" }),
    ).toBeTruthy();
  });

  it("has no top-level colour, archive, enrichment or briefing buttons", () => {
    mount(<ProfileHeader {...makeProps()} />);
    for (const name of [/colou?r/i, /archive/i, /enrich/i, /briefing/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("lists the six contact actions in order, Enrich contact after the colour", () => {
    mount(<ProfileHeader {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    const menu = screen.getByRole("menu", { name: "Contact actions" });
    const items = within(menu).getAllByRole("menuitem");
    const names = [
      "Change colour",
      "Enrich contact",
      "Copy basic details",
      "Copy full details",
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

  it("offers Unarchive for an archived contact", () => {
    mount(
      <ProfileHeader
        {...makeProps({ contact: makeContact({ isArchived: true }) })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    expect(screen.getByRole("menuitem", { name: "Unarchive" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
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
    // The pencil holds the lower right corner, the chip sits under the
    // avatar, and the ghost badge holds the upper right corner.
    expect(pencil.className).toContain("bottom-0");
    expect(pencil.className).toContain("right-0");
    expect(chip.className).toContain("top-full");
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

  it("removes a tag and adds one through the contact update", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    const update = props.updateContact.mutate as ReturnType<typeof vi.fn>;

    fireEvent.click(
      screen.getByRole("button", { name: "Remove tag tech-lead" }),
    );
    expect(update).toHaveBeenLastCalledWith({
      id: "c1",
      data: { tags: [] },
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
    expect(props.updateContact.mutate).toHaveBeenCalledWith({
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
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith(fullDetailsText(withDetails()));
    expect(fullDetailsText(withDetails()).split("\n")).toEqual([
      "Name: Thomas Walker",
      "Role: UX Researcher",
      "Company: Umbrella Corp",
      "Email: thomas@umbrella.com",
      "Phone: 440-434-9585",
      "Birthday: 1974-05-11",
      "Location: Sydney, NSW, Australia",
    ]);
    // Addresses win over the single location when there are any.
    expect(
      fullDetailsText(
        makeContact({
          addresses: [
            { id: "a1", address: "1 Main St", label: "home", isPrimary: true },
            { id: "a2", address: "2 Side St", label: "work", isPrimary: false },
          ] as Contact["addresses"],
        }),
      ),
    ).toContain("Location: 1 Main St | 2 Side St");
    expect(basicDetailsText(makeContact())).toBe("Name: Thomas Walker");
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
    const mutate = props.archiveContact.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith("c1", expect.any(Object));
    const opts = mutate.mock.calls[0][1];
    opts.onSuccess();
    expect(toastMock.success).toHaveBeenCalledWith("Thomas Walker archived");
    opts.onError(new Error("offline"));
    expect(toastMock.error).toHaveBeenCalledWith("Failed: offline");
  });

  it("unarchives an archived contact", () => {
    const props = makeProps({ contact: makeContact({ isArchived: true }) });
    mount(<ProfileHeader {...props} />);
    chooseAction("Unarchive");
    const mutate = props.unarchiveContact.mutate as ReturnType<typeof vi.fn>;
    mutate.mock.calls[0][1].onSuccess();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Thomas Walker restored to network",
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
    fireEvent.click(screen.getByRole("button", { name: "Promote to contact" }));
    const mutate = props.promoteGhost.mutate as ReturnType<typeof vi.fn>;
    expect(mutate).toHaveBeenCalledWith("c1", expect.any(Object));
    mutate.mock.calls[0][1].onSuccess();
    expect(toastMock.success).toHaveBeenCalledWith(
      "Thomas Walker promoted to network!",
    );
  });

  it("copies a link, and removes one with an undo that puts it back", async () => {
    const writeText = stubClipboard();
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    const update = props.updateContact.mutate as ReturnType<typeof vi.fn>;

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

  it("puts a removed tag back from the undo", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove tag tech-lead" }),
    );
    lastUndo()();
    expect(props.updateContact.mutate).toHaveBeenLastCalledWith({
      id: "c1",
      data: { tags: [{ tag: "tech-lead" }] },
    });
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
  });
});

describe("Enrich contact", () => {
  /** The kebab's enrich item, by either of its two names. */
  function enrichItem() {
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    return screen.queryByRole("menuitem", { name: /^Enrich/ });
  }

  it("starts a run for this one contact, with any limit said in a toast", () => {
    mount(<ProfileHeader {...makeProps()} />);
    fireEvent.click(enrichItem()!);
    expect(aiSearch.startSearch).toHaveBeenCalledWith(["c1"], {
      limitAs: "toast",
    });
    // No confirmation for one contact: the run starts on the choice.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

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
    expect(item.textContent).toBe("Enrich contact");
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
    expect(props.updateContact.mutate).toHaveBeenCalledWith({
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
      "This contact already has that link.",
    );
    expect(props.updateContact.mutate).not.toHaveBeenCalled();
  });

  it("is the plus alone in the narrow header, named and titled", () => {
    mount(<ProfileHeader {...makeProps({ layout: "narrow" })} />);
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add.textContent).toBe("");
    expect(add.getAttribute("title")).toBe("Add link");
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
    mount(
      <ProfileHeader
        {...makeProps({
          layout: "narrow",
          contact: makeContact({
            headline: "Researching how teams plan",
            aiSummary: "Runs the research guild.",
          }),
        })}
      />,
    );
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
    const promote = screen.getByRole("button", { name: "Promote to contact" });
    expect(promote.className).toContain("mt-3");
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

  it("counts the days a late follow-up is overdue, in the error tone", () => {
    const text = banner(dueOn(19));
    expect(text?.textContent).toBe("Follow-up 3 days overdue");
    expect(text?.parentElement?.className).toContain("text-error");
    cleanup();
    expect(banner(dueOn(21))?.textContent).toBe("Follow-up 1 day overdue");
  });

  it("says due today all day, in the primary tone", () => {
    // Due at 9 AM, and it is noon: still today, not overdue.
    const text = banner(dueOn(22));
    expect(text?.textContent).toBe("Follow-up due today");
    expect(text?.parentElement?.className).toContain("text-on-primary-wash");
  });

  it("names the day of a follow-up later this week, in the neutral tone", () => {
    const text = banner(dueOn(23));
    expect(text?.textContent).toBe("Follow-up due tomorrow");
    expect(text?.parentElement?.className).toContain("text-on-surface-variant");
    cleanup();
    const friday = new Date(2026, 8, 25).toLocaleDateString(undefined, {
      weekday: "long",
    });
    expect(banner(dueOn(25))?.textContent).toBe(`Follow-up due ${friday}`);
  });

  it("shows the banner a week out, the last day Pulse's This week holds", () => {
    // Pulse's This week takes day 7, and the banner stopped at day 6.
    const text = banner(dueOn(29));
    expect(text?.textContent).toBe("Follow-up due in 7 days");
    expect(text?.parentElement?.className).toContain("text-on-surface-variant");
  });

  it("shows no banner past the week, or with no follow-up, and never the old words", () => {
    expect(banner(dueOn(30))).toBeNull();
    cleanup();
    expect(banner(null)).toBeNull();
    expect(screen.queryByText("Pending follow-up alert")).toBeNull();
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
});

describe("the local time and the weather", () => {
  it("never asks Open-Meteo when the weather is not allowed", async () => {
    mount(<LocalTimeWeather {...SYDNEY} showWeather={false} />);
    expect(screen.getByText(/local time/)).toBeTruthy();
    // Give a query that should not exist the chance to start.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(weatherRequests()).toHaveLength(0);
    expect(screen.queryByText(/°C/)).toBeNull();
  });

  it("asks Open-Meteo and shows the temperature when it is allowed", async () => {
    mount(<LocalTimeWeather {...SYDNEY} showWeather />);
    await waitFor(() => expect(screen.getByText("13°C")).toBeTruthy());
    expect(weatherRequests()).toHaveLength(1);
  });
});

describe("the briefing card", () => {
  const briefing = (
    overrides: Partial<BriefingMutation> = {},
  ): BriefingMutation => ({
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  });

  it("offers to generate a briefing when there is none", () => {
    const generate = briefing();
    mount(<DossierTab contact={makeContact()} generateBriefing={generate} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Briefing" }),
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: "Generate briefing" });
    fireEvent.click(button);
    expect(generate.mutate).toHaveBeenCalledWith("c1", expect.any(Object));
  });

  it("shows an error line when the briefing cannot be written", () => {
    const generate = briefing();
    mount(<DossierTab contact={makeContact()} generateBriefing={generate} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate briefing" }));
    const [, options] = (generate.mutate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    act(() => options.onError(new Error("Failed to generate briefing")));
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not write the briefing. Check that AI is set up in Settings, then try again.",
    );
  });

  it("says it is writing while the request is out", () => {
    mount(
      <DossierTab
        contact={makeContact()}
        generateBriefing={briefing({ isPending: true })}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Writing the briefing…",
    );
    const button = screen.getByRole("button", { name: "Generate briefing" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("shows a recent briefing's points with a Regenerate button", () => {
    mount(
      <DossierTab
        contact={makeContact({
          aiBriefing: JSON.stringify(["Point one", "Point two", "Point three"]),
          aiBriefingAt: new Date().toISOString(),
        })}
        generateBriefing={briefing()}
      />,
    );
    expect(screen.getByText("Point one")).toBeTruthy();
    expect(screen.getByText(/^Generated/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Regenerate briefing" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("treats a briefing older than three days as none", () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    mount(
      <DossierTab
        contact={makeContact({
          aiBriefing: JSON.stringify(["Old point"]),
          aiBriefingAt: fourDaysAgo.toISOString(),
        })}
        generateBriefing={briefing()}
      />,
    );
    expect(screen.queryByText("Old point")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Generate briefing" }),
    ).toBeTruthy();
  });
});
