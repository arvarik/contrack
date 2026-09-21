// @vitest-environment jsdom
// =============================================================================
// The contact header and the briefing card
// =============================================================================
// The header had a palette button, an archive button, a kebab and an unnamed
// sparkle at the same rank as the name. It now has no primary button, only a
// kebab with everything in it: a note starts in the composer under the tabs.
// Links on the meta line say that they open a new tab. The weather asks a third party for the contact's
// coordinates, so it must not ask when it is not allowed to.
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

  it("has no top-level colour, archive, avatar or briefing buttons", () => {
    mount(<ProfileHeader {...makeProps()} />);
    for (const name of [/colou?r/i, /archive/i, "Change avatar", /briefing/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("lists the six contact actions in order", () => {
    mount(<ProfileHeader {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    const menu = screen.getByRole("menu", { name: "Contact actions" });
    const items = within(menu).getAllByRole("menuitem");
    const names = [
      "Change colour",
      "Change avatar",
      "Copy basic details",
      "Copy full details",
      "Archive",
      "Delete",
    ];
    expect(items).toHaveLength(names.length);
    names.forEach((name, index) => {
      expect(within(menu).getByRole("menuitem", { name })).toBe(items[index]);
    });
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

  it("opens the avatar picker from Change avatar", () => {
    const props = makeProps();
    mount(<ProfileHeader {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Contact actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change avatar" }));
    expect(props.onOpenAvatarPicker).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
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
