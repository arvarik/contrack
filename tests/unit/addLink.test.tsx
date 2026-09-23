// @vitest-environment jsdom
// =============================================================================
// "+ link": a new link from the contact header's meta line
// =============================================================================
// A button with the "+ tag" look opens a field in its place. Enter adds and
// closes, Escape closes, leaving with text adds, leaving empty closes. The
// text is tidied (https:// in front when it has none) and has to be a web
// address whose host has a dot, and a link the contact already has, in any
// spelling, is refused. A refusal says why beside the field and keeps the
// field open with the text in it. Focus never falls to the page.
// =============================================================================
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  ALREADY_LINKED,
  AddLink,
  NOT_A_LINK,
  linkKey,
  normaliseLink,
} from "../../src/views/contact-detail/components/AddLink";
import { ADD_BUTTON_SMALL } from "../../src/lib/styles";

afterEach(() => {
  cleanup();
});

describe("normaliseLink", () => {
  it("puts https:// in front of text with no scheme, and keeps the rest as written", () => {
    expect(normaliseLink("github.com/ada")).toBe("https://github.com/ada");
    expect(normaliseLink("  www.linkedin.com/in/Ada  ")).toBe(
      "https://www.linkedin.com/in/Ada",
    );
    expect(normaliseLink("example.com:8080/x")).toBe(
      "https://example.com:8080/x",
    );
  });

  it("keeps a link that has its scheme", () => {
    expect(normaliseLink("http://ada.dev")).toBe("http://ada.dev");
    expect(normaliseLink("https://x.com/ada?ref=1")).toBe(
      "https://x.com/ada?ref=1",
    );
  });

  it.each([
    ["nothing", ""],
    ["spaces", "   "],
    ["a word", "ada"],
    ["a host with no dot", "localhost:3000"],
    ["a name with a space", "Ada Lovelace"],
    ["a path with a space", "github.com/ada lovelace"],
    ["a host that ends in a dot", "example."],
    ["a mail address", "mailto:ada@example.com"],
    ["a script", "javascript:alert(1)"],
    ["another scheme", "ftp://example.com/file"],
    ["a user name in the address", "https://ada:secret@example.com"],
  ])("refuses %s", (_label, text) => {
    expect(normaliseLink(text)).toBeNull();
  });
});

describe("linkKey", () => {
  it("is the same for one link in its usual spellings", () => {
    const key = linkKey("https://www.linkedin.com/in/ada");
    for (const spelling of [
      "http://linkedin.com/in/ada",
      "linkedin.com/in/ada/",
      "HTTPS://WWW.LINKEDIN.COM/in/ada#about",
      "  www.linkedin.com/in/ada  ",
    ]) {
      expect(linkKey(spelling), spelling).toBe(key);
    }
  });

  it("tells apart links that go to different places", () => {
    expect(linkKey("github.com/ada")).not.toBe(linkKey("github.com/Ada"));
    expect(linkKey("github.com/ada")).not.toBe(linkKey("gitlab.com/ada"));
    expect(linkKey("example.com/?a=1")).not.toBe(linkKey("example.com/?a=2"));
  });
});

describe("AddLink", () => {
  const LINKS = ["https://www.linkedin.com/in/ada", "https://ada.dev"];

  function mount(onAdd = vi.fn(), links = LINKS) {
    render(
      <div>
        <AddLink links={links} onAdd={onAdd} />
        <button type="button">Elsewhere</button>
      </div>,
    );
    return onAdd;
  }

  const open = () => {
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    return screen.getByRole("textbox", { name: "New link" });
  };

  it("is a button with the + tag look that opens a focused field in its place", () => {
    mount();
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add.textContent).toBe("link");
    expect(add.className).toContain("text-xs");
    for (const token of ADD_BUTTON_SMALL.split(" ")) {
      expect(add.className).toContain(token);
    }
    const field = open();
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute("placeholder")).toBe("Paste a link");
    expect(field.getAttribute("type")).toBe("url");
    expect(screen.queryByRole("button", { name: "Add link" })).toBeNull();
    // 44 px tall with 16 px text on a phone, as the "+ tag" field is.
    expect(field.className).toContain("min-h-[44px]");
    expect(field.className).toContain("text-base");
  });

  it("adds on Enter, closes, and puts focus back on + link", () => {
    const onAdd = mount();
    const field = open();
    fireEvent.change(field, { target: { value: "github.com/ada" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("https://github.com/ada");
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add link" }),
    );
  });

  it("closes on Escape without adding, and puts focus back on + link", () => {
    const onAdd = mount();
    const field = open();
    fireEvent.change(field, { target: { value: "github.com/ada" } });
    // Handled: `fireEvent` answers false when the default was prevented, so
    // a page-level Escape (the contact over the map) does not also run.
    expect(fireEvent.keyDown(field, { key: "Escape" })).toBe(false);
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add link" }),
    );
  });

  it("closes on Enter with nothing typed", () => {
    const onAdd = mount();
    fireEvent.keyDown(open(), { key: "Enter" });
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("adds on leaving with text, and leaves focus where it went", () => {
    const onAdd = mount();
    const field = open();
    fireEvent.change(field, { target: { value: "x.com/ada" } });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    expect(onAdd).toHaveBeenCalledWith("https://x.com/ada");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("closes on leaving empty", () => {
    const onAdd = mount();
    open();
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("says why it refuses text that is not a web address, and keeps the text", () => {
    const onAdd = mount();
    const field = open();
    fireEvent.change(field, { target: { value: "ada" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(NOT_A_LINK);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect((field as HTMLInputElement).value).toBe("ada");
    expect(onAdd).not.toHaveBeenCalled();
    // Typing again clears the message.
    fireEvent.change(field, { target: { value: "ada.dev/blog" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a link the contact already has, in another spelling, and stays open on leaving", () => {
    const onAdd = mount();
    const field = open();
    fireEvent.change(field, { target: { value: "linkedin.com/in/ada/" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(ALREADY_LINKED);
    // Leaving does not throw the text away either.
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(screen.getByRole("textbox", { name: "New link" })).toBeTruthy();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("draws the plus alone when icon-only, with the words in the name and the tooltip", () => {
    render(<AddLink links={[]} onAdd={vi.fn()} iconOnly />);
    const add = screen.getByRole("button", { name: "Add link" });
    expect(add.textContent).toBe("");
    expect(add.getAttribute("title")).toBe("Add link");
    expect(add.className).toContain("size-6");
  });
});
