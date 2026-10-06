// @vitest-environment jsdom
// Which keys this computer has, in src/lib/platform.ts
//
// A Mac holds ⌘ ⇧ for the navigation keys. Windows and Linux hold Ctrl Alt,
// because the browser keeps Ctrl ⇧ I, P and M. These checks hold the
// detection to the navigator's platform fields, the chord test to both forms,
// and the shortcuts table to the keys of the platform it runs on.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chordLabel,
  isApplePlatform,
  isNavChord,
  IS_APPLE,
  MOD_KEY,
  NAV_MODIFIERS,
} from "../../../../src/lib/platform";

/** A keydown's modifiers, all up unless named. */
const keys = (
  held: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", true>>,
) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...held,
});

describe("isApplePlatform", () => {
  it("reads a Mac, an iPhone and an iPad as Apple", () => {
    expect(isApplePlatform({ platform: "MacIntel" })).toBe(true);
    expect(isApplePlatform({ platform: "iPhone" })).toBe(true);
    expect(isApplePlatform({ platform: "iPad" })).toBe(true);
    expect(isApplePlatform({ userAgentData: { platform: "macOS" } })).toBe(
      true,
    );
  });

  it("reads Windows, Linux, ChromeOS and Android as not Apple", () => {
    expect(isApplePlatform({ platform: "Win32" })).toBe(false);
    expect(isApplePlatform({ platform: "Linux x86_64" })).toBe(false);
    expect(isApplePlatform({ userAgentData: { platform: "Windows" } })).toBe(
      false,
    );
    expect(isApplePlatform({ userAgentData: { platform: "Chrome OS" } })).toBe(
      false,
    );
    expect(isApplePlatform({ userAgentData: { platform: "Android" } })).toBe(
      false,
    );
  });

  it("prefers the client hint over the older platform field", () => {
    expect(
      isApplePlatform({
        userAgentData: { platform: "Windows" },
        platform: "MacIntel",
      }),
    ).toBe(false);
  });

  it("falls back to the platform field when the client hint is empty", () => {
    expect(
      isApplePlatform({ userAgentData: { platform: "" }, platform: "Win32" }),
    ).toBe(false);
  });

  it("counts an unknown platform as a Mac, so jsdom prints ⌘ everywhere", () => {
    expect(isApplePlatform({ platform: "" })).toBe(true);
    expect(isApplePlatform({})).toBe(true);
    // jsdom's own navigator: an empty platform and no client hint.
    expect(IS_APPLE).toBe(true);
    expect(MOD_KEY).toBe("⌘");
    expect(NAV_MODIFIERS).toEqual(["⌘", "⇧"]);
  });
});

describe("chordLabel", () => {
  it("joins the symbols of a Mac chord with nothing between them", () => {
    expect(chordLabel(["⌘", "⇧", "H"])).toBe("⌘⇧H");
  });
});

describe("isNavChord", () => {
  it("accepts ⌘ ⇧, the Mac form", () => {
    expect(isNavChord(keys({ metaKey: true, shiftKey: true }))).toBe(true);
  });

  it("accepts Ctrl Alt, the Windows and Linux form", () => {
    expect(isNavChord(keys({ ctrlKey: true, altKey: true }))).toBe(true);
  });

  it("refuses Ctrl ⇧, which the browser keeps for itself", () => {
    expect(isNavChord(keys({ ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("refuses one modifier alone, and ⌘ ⌥ ⇧", () => {
    expect(isNavChord(keys({ metaKey: true }))).toBe(false);
    expect(isNavChord(keys({ ctrlKey: true }))).toBe(false);
    expect(isNavChord(keys({ altKey: true }))).toBe(false);
    expect(isNavChord(keys({ shiftKey: true }))).toBe(false);
    expect(
      isNavChord(keys({ metaKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
  });

  it("refuses Ctrl Alt ⇧, an AltGr capital on a European layout", () => {
    // AltGr is Ctrl Alt on Windows. With Shift it types a capital such as
    // "Ś", and that keystroke must stay a character in the field.
    expect(
      isNavChord(keys({ ctrlKey: true, altKey: true, shiftKey: true })),
    ).toBe(false);
  });
});

describe("on Windows and Linux", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** Load the modules again, as a page on this platform would. */
  async function loadOn(platform: string) {
    vi.resetModules();
    vi.stubGlobal("navigator", { platform });
    const platformModule = await import("../../../../src/lib/platform");
    const shortcuts = await import("../../../../src/lib/shortcuts");
    return { platformModule, shortcuts };
  }

  const keysOf = (
    table: readonly { description: string; keys: string[] }[],
    description: string,
  ) => table.find((entry) => entry.description === description)?.keys;

  it("prints Ctrl for ⌘, and joins a chord with plus signs", async () => {
    const { platformModule } = await loadOn("Win32");
    expect(platformModule.IS_APPLE).toBe(false);
    expect(platformModule.MOD_KEY).toBe("Ctrl");
    expect(platformModule.NAV_MODIFIERS).toEqual(["Ctrl", "Alt"]);
    expect(platformModule.chordLabel(["Ctrl", "Alt", "H"])).toBe("Ctrl+Alt+H");
  });

  it("lists Ctrl Alt for the navigation keys and Log an interaction, and Alt for ⌥", async () => {
    const { shortcuts } = await loadOn("Linux x86_64");
    const table = shortcuts.SHORTCUTS;
    expect(keysOf(table, "Go to Network")).toEqual(["Ctrl", "Alt", "H"]);
    expect(keysOf(table, "Go to Pulse")).toEqual(["Ctrl", "Alt", "P"]);
    expect(keysOf(table, "Go to Map")).toEqual(["Ctrl", "Alt", "M"]);
    expect(keysOf(table, "Go to Settings")).toEqual(["Ctrl", "Alt", ","]);
    expect(keysOf(table, "Log an interaction")).toEqual(["Ctrl", "Alt", "I"]);
    expect(keysOf(table, "Move the value up one place")).toEqual(["Alt", "↑"]);
  });

  it("lists Ctrl for the ⌘ shortcuts, and the browser's Alt arrows for Back and Forward", async () => {
    const { shortcuts } = await loadOn("Win32");
    const table = shortcuts.SHORTCUTS;
    expect(keysOf(table, "Open command palette")).toEqual(["Ctrl", "K"]);
    expect(keysOf(table, "Save the interaction you are writing")).toEqual([
      "Ctrl",
      "Enter",
    ]);
    expect(keysOf(table, "Back")).toEqual(["Alt", "←"]);
    expect(keysOf(table, "Forward")).toEqual(["Alt", "→"]);
    // Nothing on this platform still prints a key it does not have.
    for (const entry of table) expect(entry.keys).not.toContain("⌘");
  });

  it("keeps every shortcut a combination where it was one", async () => {
    const { shortcuts } = await loadOn("Win32");
    for (const entry of shortcuts.SHORTCUTS) {
      if (entry.bareLetter) continue;
      if (entry.keys.some((key) => ["Ctrl", "Alt"].includes(key))) {
        expect(shortcuts.isCombination(entry.keys), entry.description).toBe(
          true,
        );
      }
    }
  });
});
