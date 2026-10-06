// @vitest-environment jsdom
/**
 * Settings navigation: the back link's rule, the page a path belongs to, who
 * sees which page, the header's actions slot, and the slide between the
 * list and a page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useEffect } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  SETTINGS_PAGES,
  findRows,
  findSettingsPage,
  isSettingsPageVisible,
} from "../../../../src/views/settings/registry";
import { SettingsHeaderActions } from "../../../../src/views/settings/SettingsHeader";
import {
  SlideLink,
  holdSlide,
  settleSlide,
  useSlideNavigate,
} from "../../../../src/views/settings/slide";

const page = (id: string) => SETTINGS_PAGES.find((p) => p.id === id)!;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.settingsSlide;
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe("findSettingsPage", () => {
  it("picks the longest path, so Correspondents is not Connectors", () => {
    expect(findSettingsPage("/settings/connectors/people")?.id).toBe(
      "correspondents",
    );
    expect(findSettingsPage("/settings/connectors")?.id).toBe("connectors");
  });

  it("finds the page a deeper path sits under, and nothing for the list", () => {
    expect(findSettingsPage("/settings/admin/users/new")?.id).toBe(
      "admin-users",
    );
    expect(findSettingsPage("/settings")).toBeUndefined();
    expect(findSettingsPage("/settings/nowhere")).toBeUndefined();
  });
});

describe("isSettingsPageVisible", () => {
  it.each([
    ["admin-users", {}, false],
    ["admin-users", { isAdmin: true }, true],
    // An admin has the instance's AI usage instead of the member's.
    ["ai-usage", { isAdmin: false }, true],
    ["ai-usage", { isAdmin: true }, false],
    // No account to show while the instance asks no one to sign in.
    ["account", { authRequired: false }, false],
    ["account", { authRequired: true }, true],
  ] as const)("shows %s to %j: %s", (id, viewer, shown) => {
    expect(isSettingsPageVisible(page(id), viewer)).toBe(shown);
  });

  it("gives the search the same answer as the rail", () => {
    const admin = findRows("ai usage", { isAdmin: true });
    expect(admin.map((hit) => hit.page.id)).toEqual(["admin-ai-usage"]);
    const member = findRows("ai usage", { isAdmin: false });
    expect(member.map((hit) => hit.page.id)).toEqual(["ai-usage"]);
    expect(findRows("password", { authRequired: false })).toEqual([]);
  });
});

describe("SettingsHeaderActions", () => {
  it("renders where it stands outside the shell", () => {
    render(
      <SettingsHeaderActions>
        <button type="button">Invite</button>
      </SettingsHeaderActions>,
    );
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
  });
});

describe("useSlideNavigate", () => {
  /** The hook, and the path it has taken the router to. */
  const Probe = ({
    onReady,
  }: {
    onReady: (go: ReturnType<typeof useSlideNavigate>) => void;
  }) => {
    const go = useSlideNavigate();
    const location = useLocation();
    useEffect(() => {
      onReady(go);
    }, [go, onReady]);
    return <p data-testid="path">{location.pathname}</p>;
  };

  let go: ReturnType<typeof useSlideNavigate>;
  const renderProbe = () =>
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Probe
          onReady={(fn) => {
            go = fn;
          }}
        />
      </MemoryRouter>,
    );

  /** A window this wide, on a system that does not reduce motion. */
  const stubMedia = ({ wide = false } = {}) =>
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("min-width") && wide,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );

  /** A View Transitions API that runs the update and lets the test finish it. */
  const stubTransitions = () => {
    const calls: Array<{ update: Promise<void>; finish: () => void }> = [];
    (document as { startViewTransition?: unknown }).startViewTransition = (
      update: () => Promise<void>,
    ) => {
      let finish = () => {};
      const finished = new Promise<void>((resolve) => (finish = resolve));
      calls.push({ update: update(), finish });
      return { finished };
    };
    return calls;
  };

  beforeEach(() => stubMedia());

  it("navigates at once where the browser has no View Transitions", () => {
    renderProbe();
    act(() => go("/settings/appearance", "forward"));
    expect(screen.getByTestId("path").textContent).toBe("/settings/appearance");
    expect(document.documentElement.dataset.settingsSlide).toBeUndefined();
  });

  it("slides forward below lg, and holds the picture until the page is drawn", async () => {
    const calls = stubTransitions();
    renderProbe();

    act(() => go("/settings/keyboard#single-key-shortcuts", "forward"));
    expect(calls).toHaveLength(1);
    expect(document.documentElement.dataset.settingsSlide).toBe("forward");
    expect(screen.getByTestId("path").textContent).toBe("/settings/keyboard");

    // A page still on its way holds the picture, even once the route is in.
    let settled = false;
    void calls[0].update.then(() => (settled = true));
    const release = holdSlide();
    settleSlide("/settings/keyboard");
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await calls[0].update;
    expect(settled).toBe(true);

    calls[0].finish();
    await act(async () => {});
    expect(document.documentElement.dataset.settingsSlide).toBeUndefined();
  });

  it("does not wait forever for a page that never arrives", async () => {
    vi.useFakeTimers();
    try {
      const calls = stubTransitions();
      renderProbe();
      act(() => go("/settings/tags", "back"));
      expect(document.documentElement.dataset.settingsSlide).toBe("back");
      let settled = false;
      void calls[0].update.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(400);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("navigates at once when the Motion row asks for reduced motion", () => {
    const calls = stubTransitions();
    document.documentElement.dataset.motion = "reduced";
    renderProbe();
    act(() => go("/settings/appearance", "forward"));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId("path").textContent).toBe("/settings/appearance");
  });

  it("keeps a newer slide's direction when the browser skips the older one", async () => {
    const calls = stubTransitions();
    renderProbe();
    act(() => go("/settings/appearance", "forward"));
    act(() => go("/settings", "back"));
    expect(document.documentElement.dataset.settingsSlide).toBe("back");
    // The browser skips the first transition: its `finished` settles first.
    await act(async () => {
      calls[0].finish();
      await Promise.resolve();
    });
    expect(document.documentElement.dataset.settingsSlide).toBe("back");
    await act(async () => {
      calls[1].finish();
      await Promise.resolve();
    });
    expect(document.documentElement.dataset.settingsSlide).toBeUndefined();
  });

  it("slides to Tracked contacts like every other settings page", () => {
    const calls = stubTransitions();
    const tracked = SETTINGS_PAGES.find((p) => p.id === "tracked")!;
    renderProbe();
    act(() => go(tracked.path, "forward"));
    expect(calls).toHaveLength(1);
    expect(document.documentElement.dataset.settingsSlide).toBe("forward");
  });

  it("does not slide from lg, where the rail is on screen", () => {
    const calls = stubTransitions();
    stubMedia({ wide: true });
    renderProbe();
    act(() => go("/settings/appearance", "forward"));
    expect(calls).toHaveLength(0);
    expect(screen.getByTestId("path").textContent).toBe("/settings/appearance");
  });
});

describe("SlideLink", () => {
  const Path = () => <p data-testid="path">{useLocation().pathname}</p>;
  const renderLink = (to: string) =>
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <SlideLink to={to}>Appearance</SlideLink>
        <Path />
      </MemoryRouter>,
    );

  it("leaves a modified click to the browser, for a new tab or window", () => {
    renderLink("/settings/appearance");
    const link = screen.getByRole("link", { name: "Appearance" });
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      fireEvent.click(link, { [modifier]: true });
    }
    fireEvent.click(link, { button: 1 });
    expect(screen.getByTestId("path").textContent).toBe("/settings");
  });

  it("starts loading nothing for a path no page owns when it is pressed", () => {
    renderLink("/settings/nowhere");
    // A press asks the registry for the page's code. No page, no import,
    // and the click still navigates.
    const link = screen.getByRole("link", { name: "Appearance" });
    expect(() => fireEvent.pointerDown(link)).not.toThrow();
    fireEvent.click(link);
    expect(screen.getByTestId("path").textContent).toBe("/settings/nowhere");
  });
});
