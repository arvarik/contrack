// @vitest-environment jsdom
// =============================================================================
// The navigation keys, in src/hooks/useGlobalNavShortcuts.ts
// =============================================================================
// The keys used to read `metaKey` alone, so on Windows and Linux they
// answered only to the Windows key or the Super key. Ctrl Alt is the form
// there, because the browser keeps Ctrl ⇧ P and Ctrl ⇧ M. Both forms work
// everywhere, and a character typed with AltGr (Ctrl Alt on a European
// Windows layout) never moves the page.
// =============================================================================
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/views/pages", () => ({ warmPage: vi.fn() }));

const { useGlobalNavShortcuts, NAV_SHORTCUTS } =
  await import("../../../../src/hooks/useGlobalNavShortcuts");
const { clearPendingNav } = await import("../../../../src/lib/pendingNav");

afterEach(() => {
  clearPendingNav();
});

/** The hook, and the path it leads to. */
function Harness() {
  useGlobalNavShortcuts();
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

function mount() {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Harness />
    </MemoryRouter>,
  );
  return () => screen.getByTestId("path").textContent;
}

/** Press a key on the window, the way the browser delivers it. */
function press(key: string, held: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...held,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("useGlobalNavShortcuts", () => {
  it("goes to Pulse on ⌘ ⇧ P, the Mac form", () => {
    const path = mount();
    press("p", { metaKey: true, shiftKey: true });
    expect(path()).toBe("/pulse");
  });

  it("goes to Pulse and to Map on Ctrl Alt, the Windows and Linux form", () => {
    const path = mount();
    const event = press("p", { ctrlKey: true, altKey: true });
    expect(path()).toBe("/pulse");
    expect(event.defaultPrevented).toBe(true);
    press("m", { ctrlKey: true, altKey: true });
    expect(path()).toBe("/map");
  });

  it("leaves Ctrl ⇧ P to the browser", () => {
    const path = mount();
    const event = press("P", { ctrlKey: true, shiftKey: true });
    expect(path()).toBe("/");
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a character typed with AltGr in a field, and reads the key elsewhere", () => {
    // Polish AltGr+S types "ś". Windows reports AltGr as Ctrl Alt, so the
    // modifiers match and only the key tells the two apart.
    const path = mount();
    const field = document.body.appendChild(document.createElement("input"));
    field.focus();
    const typed = press("ś", { ctrlKey: true, altKey: true, code: "KeyS" });
    expect(path()).toBe("/");
    expect(typed.defaultPrevented).toBe(false);
    field.remove();
    press("µ", { ctrlKey: true, altKey: true, code: "KeyM" });
    expect(path()).toBe("/map");
  });

  it("goes to Settings on ⌘ ⇧ , where Shift turns the comma into <", () => {
    const path = mount();
    press("<", { metaKey: true, shiftKey: true, code: "Comma" });
    expect(path()).toBe("/settings");
  });

  it("labels the chords with the keys of this platform", () => {
    // jsdom reports no platform, which counts as a Mac.
    expect(NAV_SHORTCUTS["/"].keys).toBe("⌘⇧H");
    expect(NAV_SHORTCUTS["/settings"].keys).toBe("⌘⇧,");
  });
});
