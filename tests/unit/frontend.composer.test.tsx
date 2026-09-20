// @vitest-environment jsdom
// =============================================================================
// The interaction composer keeps a note until the save that keeps it
// =============================================================================
// The composer cleared its editor the moment a save started. A request that
// failed took the note with it, and a request that succeeded took anything
// typed while it was out. Every case here is one a person on a slow
// connection meets: a 500, a session that expires mid-save, a second click on
// Save, and a sentence finished while the first half was still uploading.
//
// It is also the only composer now. The contact page and the quick
// interaction dialog both draw it, so the controls it shows (a type
// radiogroup, a Save that is never disabled, the message an empty Save gets)
// and its compact form for the dialog are checked here too.
//
// The editor is a real tiptap instance. Typing is done by mutating the
// contenteditable, which is what a browser does, and ProseMirror's DOM
// observer reads it back into the document.
// =============================================================================
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { InteractionComposer } from "../../src/components/InteractionComposer";
import { QuickInteractionModal } from "../../src/components/QuickInteractionModal";
import { draftKey } from "../../src/lib/composerDrafts";

/** The signed-in account, switched per test. Null is an un-gated instance. */
const account = vi.hoisted(() => ({ current: null as { id: string } | null }));
vi.mock("../../src/components/auth/AuthGate", () => ({
  useAuth: () => ({ user: account.current }),
}));

// The composer reads two hooks off the `api` barrel, and the barrel pulls in
// every API module in the app. Coverage instruments what is imported, so
// loading twenty modules this file never exercises lowered the project's
// function coverage under its floor. The two hooks stay real, from their own
// files.
vi.mock("../../src/api", async () => {
  const [interactions, contacts] = await Promise.all([
    import("../../src/api/interactions"),
    import("../../src/api/contacts"),
  ]);
  return {
    useAddInteraction: interactions.useAddInteraction,
    useContactNames: contacts.useContactNames,
  };
});

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

interface SaveRequest {
  url: string;
  body: Record<string, unknown>;
  resolve: (status?: number) => void;
  reject: () => void;
}

/** One row of the slim contact list, the names @ and the dialog read. */
const person = (id: string, name: string) => ({
  id,
  name,
  isGhost: false,
  avatarUrl: null,
});

/** A fetch that serves the contact list and holds every save for the test. */
function stubServer(people: ReturnType<typeof person>[] = []) {
  const saves: SaveRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("view=slim")) {
        return Promise.resolve(Response.json(people));
      }
      if (init?.method === "POST") {
        return new Promise<Response>((resolve, reject) => {
          saves.push({
            url: String(url),
            body: JSON.parse(String(init.body)),
            resolve: (status = 201) =>
              resolve(
                Response.json(
                  status < 300
                    ? { id: "int-1", ...saves[saves.length - 1]?.body }
                    : { error: { message: "no", code: "FAILED" } },
                  { status },
                ),
              ),
            reject: () => reject(new TypeError("Failed to fetch")),
          });
        });
      }
      return Promise.resolve(Response.json({}));
    }),
  );
  return saves;
}

function mount(contactId = "contact-1") {
  render(
    <QueryClientProvider client={client}>
      <InteractionComposer contactId={contactId} />
    </QueryClientProvider>,
  );
}

/** The contenteditable, once tiptap has mounted it. */
async function editorElement(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.querySelector(".ProseMirror");
    if (!el) throw new Error("editor not mounted yet");
    return el as HTMLElement;
  });
}

/** Type into the editor the way a browser does: change the DOM. */
async function type(pm: HTMLElement, text: string): Promise<void> {
  const paragraph = pm.querySelector("p") ?? pm;
  paragraph.textContent = (paragraph.textContent ?? "") + text;
  await waitFor(() => expect(pm.textContent).toContain(text));
  // ProseMirror reads the mutation on a microtask and the button reflects it
  // on the next render.
  await act(async () => {});
}

const saveButton = () =>
  screen.getByRole("button", { name: /^(save|saving…)$/i });
/** One of the four interaction types, a radio by its accessible name. */
const typeButton = (name: "Note" | "Call" | "Meeting" | "Email") =>
  within(
    screen.getByRole("radiogroup", { name: "Interaction type" }),
  ).getByRole("radio", { name });
const followUpInput = () =>
  screen.getByLabelText("Next action") as HTMLInputElement;

/**
 * jsdom lays nothing out, so a Range has no rectangles. ProseMirror asks for
 * them when it scrolls the caret into view, which it does for an editor with
 * focus, and the composer now puts focus in the editor after an empty Save
 * and when "Log interaction" asks for it.
 */
beforeAll(() => {
  const noRect = () => new DOMRect(0, 0, 0, 0);
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      ({ length: 0, item: () => null }) as unknown as DOMRectList;
  }
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = noRect;
  }
});

beforeEach(() => {
  account.current = null;
  localStorage.clear();
  // Each test serves its own contact list. A list cached by the test before
  // would be read instead.
  client.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("names", () => {
  it("names the editor and describes it with the placeholder for the type", async () => {
    stubServer();
    mount();
    const pm = await editorElement();

    const editor = screen.getByRole("textbox", { name: "Note" });
    expect(editor).toBe(pm);
    expect(editor.getAttribute("aria-multiline")).toBe("true");
    const description = () =>
      document.getElementById(editor.getAttribute("aria-describedby") ?? "")
        ?.textContent;
    expect(description()).toBe("Write a quick note...");

    // The id is fixed when the editor is created, and the text behind it
    // follows the type.
    fireEvent.click(typeButton("Call"));
    expect(description()).toBe("Summarize the call...");
    expect(typeButton("Call").getAttribute("aria-checked")).toBe("true");
    expect(typeButton("Note").getAttribute("aria-checked")).toBe("false");
  });
});

describe("the controls", () => {
  it("offers the type as one radiogroup with a single Tab stop that the arrows move", async () => {
    stubServer();
    mount();
    await editorElement();

    const group = screen.getByRole("radiogroup", { name: "Interaction type" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Note",
      "Call",
      "Meeting",
      "Email",
    ]);
    // Only the checked type is in the Tab order.
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1, -1]);

    fireEvent.keyDown(typeButton("Note"), { key: "ArrowRight" });
    expect(typeButton("Call").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(typeButton("Call"));
    fireEvent.keyDown(typeButton("Call"), { key: "ArrowLeft" });
    fireEvent.keyDown(typeButton("Note"), { key: "ArrowLeft" });
    expect(typeButton("Email").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps Save enabled, and an empty Save says what is missing and sends nothing", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Write something first");
    // The message is the button's description, and focus goes where the
    // missing text is typed.
    expect(saveButton().getAttribute("aria-describedby")).toBe(alert.id);
    await waitFor(() => expect(pm.contains(document.activeElement)).toBe(true));

    // ⌘ Enter from the editor takes the same path.
    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(saves).toHaveLength(0);

    // Typing takes the message away.
    await type(pm, "Now there is a note");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(saveButton().getAttribute("aria-describedby")).toBeNull();
  });

  it("saves with ⌘ Enter from the next-action line too", async () => {
    const saves = stubServer();
    mount();
    await editorElement();
    fireEvent.change(followUpInput(), {
      target: { value: "Call back next Friday" },
    });

    fireEvent.keyDown(followUpInput(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body.title).toBe("Action Scheduled");
    expect(saves[0].body.content).toBeNull();
    expect(saves[0].body.actionItem).toMatchObject({ title: "Call back" });
    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() => expect(followUpInput().value).toBe(""));
  });

  it("shows the ⌘ Enter hint at the end of the next-action line", async () => {
    stubServer();
    mount();
    await editorElement();
    const hint = screen.getByText("to save").parentElement!;
    expect(
      within(hint)
        .getAllByText(/⌘|Enter/)
        .map((kbd) => kbd.tagName),
    ).toEqual(["KBD", "KBD"]);
  });

  it("focuses the editor when asked, once, and says it did", async () => {
    stubServer();
    const handled = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <InteractionComposer contactId="contact-1" />
      </QueryClientProvider>,
    );
    const pm = await editorElement();
    expect(pm.contains(document.activeElement)).toBe(false);

    rerender(
      <QueryClientProvider client={client}>
        <InteractionComposer
          contactId="contact-1"
          focusRequested
          onFocusHandled={handled}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(pm.contains(document.activeElement)).toBe(true));
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("lets @ mention the people in the network, read when @ is typed", async () => {
    stubServer([person("p-1", "Grace Hopper"), person("p-2", "Ada Lovelace")]);
    mount();
    const pm = await editorElement();
    const editor = (
      pm as HTMLElement & {
        editor: {
          extensionManager: {
            extensions: {
              name: string;
              options: {
                suggestion?: {
                  items: (args: { query: string }) => { name: string }[];
                };
              };
            }[];
          };
        };
      }
    ).editor;
    const mention = editor.extensionManager.extensions.find(
      (extension) => extension.name === "mention",
    );
    expect(mention).toBeDefined();
    // The names arrive after the editor was created, and @ still finds them.
    await waitFor(() =>
      expect(
        mention!.options.suggestion!.items({ query: "gr" }).map((p) => p.name),
      ).toEqual(["Grace Hopper"]),
    );
  });
});

describe("the compact composer", () => {
  function mountCompact(
    props: Partial<React.ComponentProps<typeof InteractionComposer>> = {},
  ) {
    return render(
      <QueryClientProvider client={client}>
        <InteractionComposer compact contactId={null} {...props} />
      </QueryClientProvider>,
    );
  }

  it("asks for a contact when there is text and nobody is chosen", async () => {
    const saves = stubServer();
    const missing = vi.fn();
    mountCompact({ onContactMissing: missing });
    const pm = await editorElement();
    await type(pm, "Lunch at the usual place");

    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a contact first",
    );
    expect(missing).toHaveBeenCalledTimes(1);
    expect(saves).toHaveLength(0);
  });

  it("saves for the chosen contact, reports the save, and keeps no draft", async () => {
    account.current = { id: "user-a" };
    const saves = stubServer();
    const saved = vi.fn();
    const { rerender } = mountCompact({ onSaved: saved });
    const pm = await editorElement();
    await type(pm, "Met for coffee");
    fireEvent.click(typeButton("Meeting"));

    // The contact is chosen after the text was written, and the text stays.
    rerender(
      <QueryClientProvider client={client}>
        <InteractionComposer compact contactId="contact-7" onSaved={saved} />
      </QueryClientProvider>,
    );
    expect(pm.isConnected).toBe(true);
    expect(pm.textContent).toBe("Met for coffee");

    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].url).toContain("/contacts/contact-7/interactions");
    expect(saves[0].body).toMatchObject({
      type: "meeting",
      title: "Logged meeting",
    });
    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        type: "meeting",
        contactId: "contact-7",
      }),
    );
    fireEvent(window, new Event("pagehide"));
    expect(
      Object.keys(localStorage).filter((key) =>
        key.startsWith("contrack:draft:"),
      ),
    ).toEqual([]);
  });
});

describe("the quick interaction dialog", () => {
  it("opens for a preset contact without the picker, and saves for that contact", async () => {
    const saves = stubServer([person("c-9", "Katherine Johnson")]);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <QuickInteractionModal
          isOpen
          onClose={onClose}
          initialContactId="c-9"
        />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Log an interaction",
    });
    expect(
      within(dialog).queryByRole("textbox", { name: "Search for a contact" }),
    ).toBeNull();
    await waitFor(() =>
      expect(within(dialog).getByText("Katherine Johnson")).toBeTruthy(),
    );

    const pm = await editorElement();
    await type(pm, "Reviewed the numbers");
    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].url).toContain("/contacts/c-9/interactions");
    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("picks a contact with the arrows and Enter, and Change contact brings the search back", async () => {
    stubServer([
      person("c-1", "Grace Hopper"),
      person("c-2", "Grace Kelly"),
      { ...person("c-3", "Grace Ghost"), isGhost: true },
    ]);
    render(
      <QueryClientProvider client={client}>
        <QuickInteractionModal isOpen onClose={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Log an interaction",
    });
    const picker = within(dialog).getByRole("textbox", {
      name: "Search for a contact",
    });
    // Wait for the names, then search. Ghosts are not offered.
    await waitFor(() => {
      fireEvent.change(picker, { target: { value: "gra" } });
      expect(
        within(dialog).getByRole("option", { name: "Grace Kelly" }),
      ).toBeTruthy();
    });
    expect(
      within(dialog).queryByRole("option", { name: "Grace Ghost" }),
    ).toBeNull();

    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "ArrowUp" });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "Enter" });
    await waitFor(() =>
      expect(within(dialog).getByText("Grace Kelly")).toBeTruthy(),
    );
    expect(
      within(dialog).queryByRole("textbox", { name: "Search for a contact" }),
    ).toBeNull();
    // Choosing a contact hands focus to the editor.
    const pm = await editorElement();
    await waitFor(() => expect(pm.contains(document.activeElement)).toBe(true));

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Change contact" }),
    );
    const again = within(dialog).getByRole("textbox", {
      name: "Search for a contact",
    });
    await waitFor(() => expect(document.activeElement).toBe(again));

    // Escape closes the list and keeps the search.
    fireEvent.change(again, { target: { value: "grace" } });
    await waitFor(() =>
      expect(
        within(dialog).getByRole("option", { name: "Grace Hopper" }),
      ).toBeTruthy(),
    );
    fireEvent.keyDown(again, { key: "Escape" });
    // The list leaves once its exit animation has run.
    await waitFor(() =>
      expect(
        within(dialog).queryByRole("option", { name: "Grace Hopper" }),
      ).toBeNull(),
    );
    expect((again as HTMLInputElement).value).toBe("grace");
  });

  it("names the saved kind and the contact in the toast", async () => {
    const toastSuccess = vi.spyOn(toast, "success");
    const saves = stubServer([person("c-5", "Ada Lovelace")]);
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <QuickInteractionModal
          isOpen
          onClose={onClose}
          initialContactId="c-5"
        />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Log an interaction",
    });
    await waitFor(() =>
      expect(within(dialog).getByText("Ada Lovelace")).toBeTruthy(),
    );
    const pm = await editorElement();
    await type(pm, "Rang about the engine");
    fireEvent.click(typeButton("Call"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Call logged for Ada Lovelace"),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the picker without a preset contact, and a Save sends focus to it", async () => {
    stubServer([person("c-1", "Grace Hopper")]);
    render(
      <QueryClientProvider client={client}>
        <QuickInteractionModal isOpen onClose={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Log an interaction",
    });
    const picker = within(dialog).getByRole("textbox", {
      name: "Search for a contact",
    });
    const pm = await editorElement();
    await type(pm, "A note for somebody");

    fireEvent.click(saveButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a contact first",
    );
    expect(document.activeElement).toBe(picker);
  });
});

describe("a save that fails", () => {
  it("keeps the note, the type and the follow-up when the server answers 500", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "Met at the conference");
    fireEvent.click(typeButton("Call"));
    fireEvent.change(followUpInput(), {
      target: { value: "Send slides next Tuesday" },
    });

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    // Nothing is cleared while the request is out.
    expect(pm.textContent).toBe("Met at the conference");

    await act(async () => {
      saves[0].resolve(500);
    });

    await waitFor(() => expect(saveButton().textContent).toBe("Save"));
    expect(pm.textContent).toBe("Met at the conference");
    expect(typeButton("Call").getAttribute("aria-checked")).toBe("true");
    expect(followUpInput().value).toBe("Send slides next Tuesday");
  });

  it("keeps the note on the keyboard path too", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "Keyboard note");

    // Mod is Ctrl outside macOS, and jsdom reports no platform.
    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(pm.textContent).toBe("Keyboard note");

    await act(async () => {
      saves[0].reject();
    });
    await waitFor(() => expect(saveButton().textContent).toBe("Save"));
    expect(pm.textContent).toBe("Keyboard note");
  });

  it("has the draft on disk before the session expires mid-save", async () => {
    account.current = { id: "user-a" };
    const saves = stubServer();
    mount("contact-9");
    const pm = await editorElement();
    await type(pm, "Half a note");

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    await act(async () => {
      saves[0].resolve(401);
    });

    await waitFor(() => {
      const raw = localStorage.getItem(draftKey("user-a", "contact-9"));
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).html).toContain("Half a note");
    });
    expect(pm.textContent).toBe("Half a note");
  });
});

describe("a save that succeeds", () => {
  it("clears exactly what was submitted", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "Coffee with Dana");
    fireEvent.change(followUpInput(), {
      target: { value: "Book lunch next Friday" },
    });

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body.content).toContain("Coffee with Dana");
    expect(saves[0].body.actionItem).toMatchObject({ title: "Book lunch" });

    await act(async () => {
      saves[0].resolve();
    });

    await waitFor(() => expect(pm.textContent).toBe(""));
    expect(followUpInput().value).toBe("");
    // Save stays enabled on an empty composer. Pressing it now explains.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps a sentence finished while the save was out", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "hello");

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    // Typed into the same paragraph, after the request left.
    await type(pm, " world");
    expect(pm.textContent).toBe("hello world");

    await act(async () => {
      saves[0].resolve();
    });

    await waitFor(() => expect(pm.textContent).toBe("world"));
    // Only the first note reached the server.
    expect(saves).toHaveLength(1);
    expect(saves[0].body.content).toBe("<p>hello</p>");
  });

  it("keeps a new paragraph started while the save was out", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "first");

    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    const next = document.createElement("p");
    next.textContent = "second";
    pm.appendChild(next);
    await waitFor(() => expect(pm.querySelectorAll("p")).toHaveLength(2));
    await act(async () => {});

    await act(async () => {
      saves[0].resolve();
    });

    await waitFor(() => expect(pm.textContent).toBe("second"));
    expect(pm.querySelectorAll("p")).toHaveLength(1);
  });

  it("starts one request however many times Save is pressed", async () => {
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "Once");

    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    // Give any second request every chance to appear.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(saves).toHaveLength(1);

    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() => expect(pm.textContent).toBe(""));
    expect(saves).toHaveLength(1);
  });

  it("sends the type and the follow-up that are on screen from the keyboard", async () => {
    // The shortcut extension is created once, with the first render's
    // closures, so before this Mod-Enter always sent a "note" with no
    // follow-up whatever the screen showed.
    const saves = stubServer();
    mount();
    const pm = await editorElement();
    await type(pm, "Spoke on the phone");
    fireEvent.click(typeButton("Call"));
    fireEvent.change(followUpInput(), {
      target: { value: "Call again next Monday" },
    });

    fireEvent.keyDown(pm, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].body.type).toBe("call");
    expect(saves[0].body.title).toBe("Logged call");
    expect(saves[0].body.actionItem).toMatchObject({ title: "Call again" });

    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() => expect(pm.textContent).toBe(""));
  });
});

describe("drafts", () => {
  it("restores this account's draft for this contact, and nobody else's", async () => {
    account.current = { id: "user-a" };
    localStorage.setItem(
      draftKey("user-a", "contact-1"),
      JSON.stringify({
        html: "<p>saved earlier</p>",
        followUpText: "Ping next week",
        type: "meeting",
        savedAt: Date.now(),
      }),
    );
    localStorage.setItem(
      draftKey("user-b", "contact-1"),
      JSON.stringify({
        html: "<p>somebody else's note</p>",
        followUpText: "",
        type: "note",
        savedAt: Date.now(),
      }),
    );
    stubServer();
    mount("contact-1");
    const pm = await editorElement();

    await waitFor(() => expect(pm.textContent).toBe("saved earlier"));
    expect(followUpInput().value).toBe("Ping next week");
    expect(typeButton("Meeting").getAttribute("aria-checked")).toBe("true");
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens empty for another contact of the same account", async () => {
    account.current = { id: "user-a" };
    localStorage.setItem(
      draftKey("user-a", "contact-1"),
      JSON.stringify({
        html: "<p>for contact one</p>",
        followUpText: "",
        type: "note",
        savedAt: Date.now(),
      }),
    );
    stubServer();
    mount("contact-2");
    const pm = await editorElement();
    await act(async () => {});
    expect(pm.textContent).toBe("");
  });

  it("writes what is typed, and flushes when the page is hidden", async () => {
    account.current = { id: "user-a" };
    stubServer();
    mount("contact-3");
    const pm = await editorElement();
    await type(pm, "Draft in progress");
    fireEvent.change(followUpInput(), { target: { value: "Follow up" } });
    fireEvent.click(typeButton("Email"));

    // The debounced write, on its own clock.
    const key = draftKey("user-a", "contact-3");
    await waitFor(
      () => {
        const raw = localStorage.getItem(key);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({
          html: "<p>Draft in progress</p>",
          followUpText: "Follow up",
          type: "email",
        });
      },
      { timeout: 2000 },
    );

    // Then a flush that does not wait for the clock.
    localStorage.removeItem(key);
    await type(pm, " continues");
    fireEvent(window, new Event("pagehide"));
    expect(JSON.parse(localStorage.getItem(key)!).html).toBe(
      "<p>Draft in progress continues</p>",
    );
  });

  it("flushes on unmount, and removes the draft once a save empties the composer", async () => {
    account.current = { id: "user-a" };
    const saves = stubServer();
    const key = draftKey("user-a", "contact-4");
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <InteractionComposer contactId="contact-4" />
      </QueryClientProvider>,
    );
    const pm = await editorElement();
    await type(pm, "Leaving the page");
    unmount();
    expect(JSON.parse(localStorage.getItem(key)!).html).toBe(
      "<p>Leaving the page</p>",
    );

    // Back on the page: the draft is restored, then saved, then gone.
    mount("contact-4");
    const again = await editorElement();
    await waitFor(() => expect(again.textContent).toBe("Leaving the page"));
    fireEvent.click(saveButton());
    await waitFor(() => expect(saves).toHaveLength(1));
    await act(async () => {
      saves[0].resolve();
    });
    await waitFor(() => expect(again.textContent).toBe(""));
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull(), {
      timeout: 2000,
    });
  });
});

describe("the one-line composer on a narrow contact page", () => {
  /** The composer's root, which says whether it is open. */
  const root = (pm: HTMLElement) =>
    pm.closest("[data-expanded]") as HTMLElement;
  /** True when the element or one of its parents is hidden by class. */
  const hiddenByClass = (el: Element) => !!el.closest(".hidden");

  function mountCollapsible(contactId = "contact-1") {
    render(
      <QueryClientProvider client={client}>
        <InteractionComposer contactId={contactId} collapsible />
        <button type="button">Elsewhere</button>
      </QueryClientProvider>,
    );
  }

  it("shows the editor alone until something in it takes focus", async () => {
    stubServer();
    mountCollapsible();
    const pm = await editorElement();

    expect(root(pm).dataset.expanded).toBe("false");
    expect(hiddenByClass(followUpInput())).toBe(true);
    expect(hiddenByClass(saveButton())).toBe(true);

    fireEvent.focus(pm);
    expect(root(pm).dataset.expanded).toBe("true");
    expect(hiddenByClass(followUpInput())).toBe(false);
    expect(hiddenByClass(saveButton())).toBe(false);
  });

  it("closes when focus leaves with nothing written, and stays open over text", async () => {
    stubServer();
    mountCollapsible();
    const pm = await editorElement();
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });

    // Between the parts of the composer it stays open.
    fireEvent.focus(pm);
    fireEvent.blur(pm, { relatedTarget: followUpInput() });
    expect(root(pm).dataset.expanded).toBe("true");

    fireEvent.blur(followUpInput(), { relatedTarget: elsewhere });
    expect(root(pm).dataset.expanded).toBe("false");

    fireEvent.focus(pm);
    await type(pm, "Half a thought");
    fireEvent.blur(pm, { relatedTarget: elsewhere });
    expect(root(pm).dataset.expanded).toBe("true");
  });

  it("stays open over a next action with no note", async () => {
    stubServer();
    mountCollapsible();
    const pm = await editorElement();
    fireEvent.focus(followUpInput());
    fireEvent.change(followUpInput(), { target: { value: "Call Friday" } });
    fireEvent.blur(followUpInput(), { relatedTarget: null });
    expect(root(pm).dataset.expanded).toBe("true");
  });

  it("opens at once over a draft that came back from disk", async () => {
    localStorage.setItem(
      draftKey(undefined, "contact-1"),
      JSON.stringify({
        html: "<p>kept from before</p>",
        followUpText: "",
        type: "note",
        savedAt: Date.now(),
      }),
    );
    stubServer();
    mountCollapsible();
    const pm = await editorElement();
    await waitFor(() => expect(pm.textContent).toBe("kept from before"));
    expect(root(pm).dataset.expanded).toBe("true");
  });

  it("puts focus in the editor from a tap anywhere on the line", async () => {
    stubServer();
    mountCollapsible();
    const pm = await editorElement();
    const line = pm.closest(".custom-tiptap")!.parentElement!;
    fireEvent.click(line);
    await waitFor(() => expect(root(pm).dataset.expanded).toBe("true"));
  });

  it("is always open without the prop", async () => {
    stubServer();
    mount();
    const pm = await editorElement();
    expect(root(pm).dataset.expanded).toBe("true");
    fireEvent.blur(pm, { relatedTarget: null });
    expect(root(pm).dataset.expanded).toBe("true");
  });
});
