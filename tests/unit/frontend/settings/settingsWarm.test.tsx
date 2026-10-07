// @vitest-environment jsdom
// Each settings page is its own module. `warm.ts` loads a page's code, and
// its first data, when a person points at its link, and every page's code in
// idle moments. These tests pin what is loaded, when, and for whom.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const idle = vi.hoisted(() => ({
  tasks: [] as Array<() => void>,
  canceled: 0,
}));
vi.mock("../../../../src/lib/idle", () => ({
  whenIdle: (task: () => void) => {
    idle.tasks.push(task);
    return () => {
      idle.canceled += 1;
      const index = idle.tasks.indexOf(task);
      if (index >= 0) idle.tasks.splice(index, 1);
    };
  },
}));

const passkeys = vi.hoisted(() => ({ supported: true }));
vi.mock("../../../../src/api/passkeys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../src/api/passkeys")>()),
  passkeysSupported: () => passkeys.supported,
}));

import {
  settingsPagePreload,
  useWarmSettingsLink,
  warmSettingsPage,
  warmSettingsPages,
  warmSettingsPath,
} from "../../../../src/views/settings/warm";
import {
  findSettingsPage,
  type SettingsPage,
  type SettingsPageModule,
} from "../../../../src/views/settings/registry";
import { prefetchAccount } from "../../../../src/views/settings/AccountSettings";

let pageCount = 0;
/** A page of its own, so the preload cache never carries one test's page into the next. */
function fakePage(prefetch?: SettingsPageModule["prefetch"]) {
  pageCount += 1;
  const module: SettingsPageModule = {
    default: () => <p>page</p>,
    prefetch,
  };
  const load = vi.fn(async () => module);
  const page = {
    id: `fake-${pageCount}`,
    path: `/settings/fake-${pageCount}`,
    title: "Fake",
    description: "",
    icon: () => null,
    group: "you",
    keywords: [],
    load,
  } as unknown as SettingsPage;
  return { page, load, module };
}

/** Lets the promise chains that follow a load run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  idle.tasks.length = 0;
  idle.canceled = 0;
  passkeys.supported = true;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("warmSettingsPage", () => {
  it("loads the page's code once, and starts its data with a query client", async () => {
    const prefetch = vi.fn();
    const { page, load } = fakePage(prefetch);
    const client = new QueryClient();
    warmSettingsPage(page, client);
    warmSettingsPage(page, client);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith(client);
    expect(settingsPagePreload(page).loaded()).not.toBeNull();
  });

  it("loads only the code without a query client, and nothing for no page", async () => {
    const prefetch = vi.fn();
    const { page, load } = fakePage(prefetch);
    warmSettingsPage(page);
    warmSettingsPage(undefined);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it("finds a link's page by its path, with or without a hash", async () => {
    const tags = findSettingsPage("/settings/tags")!;
    const load = vi
      .spyOn(tags, "load")
      .mockResolvedValue({ default: () => null });
    warmSettingsPath("/settings/tags#rename");
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("warmSettingsPages", () => {
  it("loads one page per idle moment, and stops when asked", async () => {
    const first = fakePage();
    const second = fakePage();
    const third = fakePage();
    const stop = warmSettingsPages([first.page, second.page, third.page]);

    expect(idle.tasks).toHaveLength(1);
    expect(first.load).not.toHaveBeenCalled();
    idle.tasks.shift()!();
    await flush();
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(second.load).not.toHaveBeenCalled();

    // The next page waits for the next idle moment.
    expect(idle.tasks).toHaveLength(1);
    stop();
    expect(idle.tasks).toHaveLength(0);
    expect(second.load).not.toHaveBeenCalled();
    expect(third.load).not.toHaveBeenCalled();
  });

  it("starts each page's data with a query client", async () => {
    const prefetch = vi.fn();
    const { page } = fakePage(prefetch);
    const client = new QueryClient();
    warmSettingsPages([page], client);
    idle.tasks.shift()!();
    await flush();
    expect(prefetch).toHaveBeenCalledWith(client);
  });
});

describe("useWarmSettingsLink", () => {
  const Link = ({ to }: { to: string }) => {
    const warm = useWarmSettingsLink(to);
    return (
      <a href={to} {...warm}>
        Open
      </a>
    );
  };

  it("warms the page, code and data, when the link is pointed at, focused or pressed", async () => {
    const lists = findSettingsPage("/settings/lists")!;
    const prefetch = vi.fn();
    vi.spyOn(lists, "load").mockResolvedValue({
      default: () => null,
      prefetch,
    });
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Link to="/settings/lists" />
      </QueryClientProvider>,
    );
    const link = screen.getByRole("link", { name: "Open" });
    fireEvent.pointerEnter(link);
    fireEvent.focus(link);
    fireEvent.pointerDown(link);
    await flush();
    expect(prefetch).toHaveBeenCalledTimes(3);
    expect(prefetch).toHaveBeenCalledWith(client);
  });
});

describe("prefetchAccount", () => {
  it.each([
    [
      true,
      [
        ["auth", "sessions"],
        ["auth", "tokens"],
        ["auth", "passkeys"],
      ],
    ],
    // No passkeys where the browser has none.
    [
      false,
      [
        ["auth", "sessions"],
        ["auth", "tokens"],
      ],
    ],
  ])(
    "asks for what the Account page shows (passkeys %s), kept for 30 s",
    (supported, keys) => {
      passkeys.supported = supported;
      const client = new QueryClient();
      const spy = vi.spyOn(client, "prefetchQuery").mockResolvedValue();
      prefetchAccount(client);
      expect(spy.mock.calls.map(([options]) => options.queryKey)).toEqual(keys);
      // A list read in the last 30 s is not read again.
      for (const [options] of spy.mock.calls) {
        expect(options.staleTime).toBe(30_000);
      }
    },
  );
});
