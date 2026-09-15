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
// The editor is a real tiptap instance. Typing is done by mutating the
// contenteditable, which is what a browser does, and ProseMirror's DOM
// observer reads it back into the document.
// =============================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { RichInteractionComposer } from "../../src/components/RichInteractionComposer";
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

/** A fetch that serves the contact list and holds every save for the test. */
function stubServer() {
  const saves: SaveRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).includes("view=slim")) {
        return Promise.resolve(Response.json([]));
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
      <RichInteractionComposer contactId={contactId} />
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

const saveButton = () => screen.getByRole("button", { name: /save|saving/i });
/** One of the four interaction type buttons, by its accessible name. */
const typeButton = (name: "Note" | "Call" | "Meeting" | "Email") =>
  within(screen.getByRole("group", { name: "Interaction type" })).getByRole(
    "button",
    { name },
  );
const followUpInput = () =>
  screen.getByLabelText("Next action") as HTMLInputElement;

beforeEach(() => {
  account.current = null;
  localStorage.clear();
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
    expect(typeButton("Call").getAttribute("aria-pressed")).toBe("true");
    expect(typeButton("Note").getAttribute("aria-pressed")).toBe("false");
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
    expect(typeButton("Call").getAttribute("aria-pressed")).toBe("true");
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
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
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
    expect(typeButton("Meeting").getAttribute("aria-pressed")).toBe("true");
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
        <RichInteractionComposer contactId="contact-4" />
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
