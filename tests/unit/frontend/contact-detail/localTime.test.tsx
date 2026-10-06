// @vitest-environment jsdom
// The local time on a contact's meta line, its zone, and the weather:
// "New York · 2:13 PM EDT". The zone is the abbreviation people write when one
// exists, found by asking a short list of locales, else the short offset
// ("GMT+4"), never "<City> Time". A screen reader hears the long name. The
// formatters are made once per zone, because the clock asks every minute.
//
// Every case names a fixed moment, so daylight saving is pinned: January is
// winter in the north, July is winter in the south.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LocalTimeWeather,
  describeLocalTime,
  zoneName,
} from "../../../../src/components/LocalTimeWeather";

const JANUARY = new Date("2026-01-15T12:00:00Z");
const JULY = new Date("2026-07-15T12:00:00Z");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("zoneName", () => {
  it.each([
    ["America/New_York", JANUARY, "EST", "Eastern Standard Time"],
    ["America/New_York", JULY, "EDT", "Eastern Daylight Time"],
    ["America/Los_Angeles", JULY, "PDT", "Pacific Daylight Time"],
    ["Europe/London", JANUARY, "GMT", "Greenwich Mean Time"],
    ["Europe/London", JULY, "BST", "British Summer Time"],
    ["Europe/Paris", JANUARY, "CET", "Central European Standard Time"],
    ["Europe/Paris", JULY, "CEST", "Central European Summer Time"],
    ["Australia/Sydney", JANUARY, "AEDT", "Australian Eastern Daylight Time"],
    ["Australia/Sydney", JULY, "AEST", "Australian Eastern Standard Time"],
    ["Pacific/Auckland", JULY, "NZST", "New Zealand Standard Time"],
    ["Asia/Kolkata", JULY, "IST", "India Standard Time"],
    ["Asia/Singapore", JULY, "SGT", "Singapore Standard Time"],
    ["Asia/Tokyo", JULY, "JST", "Japan Standard Time"],
    ["Asia/Dubai", JULY, "GST", "Gulf Standard Time"],
  ])("names %s in %s %s", (zone, when, short, long) => {
    expect(zoneName(zone, when)).toEqual({ short, long });
  });

  it("falls back to the short offset where no locale has an abbreviation", () => {
    // "en-US" says "GMT-3" for São Paulo, and so does every other locale on
    // the list. "Sao Paulo Time" would tell nobody how far away that is.
    expect(zoneName("America/Sao_Paulo", JULY)).toEqual({
      short: "GMT-3",
      long: "Brasilia Standard Time",
    });
    expect(zoneName("Asia/Seoul", JULY).short).toBe("GMT+9");
    expect(zoneName("Asia/Kathmandu", JULY).short).toBe("GMT+5:45");
    expect(zoneName("Etc/GMT-4", JULY).short).toBe("GMT+4");
  });

  it("never gives a city name, and never an empty one", () => {
    for (const zone of [
      "Asia/Dubai",
      "America/Sao_Paulo",
      "Asia/Shanghai",
      "Europe/Moscow",
      "UTC",
    ]) {
      const { short, long } = zoneName(zone, JULY);
      expect(short, zone).not.toMatch(/Time$/);
      expect(short.length, zone).toBeGreaterThan(0);
      expect(long.length, zone).toBeGreaterThan(0);
    }
    expect(zoneName("UTC", JULY).short).toBe("UTC");
  });

  it("makes a zone's formatters once, and answers the next minute from them", () => {
    const zone = "America/Chicago";
    const first = zoneName(zone, JULY);
    const make = vi.spyOn(Intl, "DateTimeFormat");
    const later = zoneName(zone, new Date(JULY.getTime() + 60_000));
    expect(later).toBe(first);
    expect(make).not.toHaveBeenCalled();
    // A new half of the year is a new name, from the same formatters.
    expect(zoneName(zone, JANUARY).short).toBe("CST");
    expect(make).not.toHaveBeenCalled();
  });
});

describe("describeLocalTime", () => {
  it("gives the time in the zone, its name, and whether it is day there", () => {
    // 18:13 UTC is 2:13 PM in New York in July.
    const afternoon = describeLocalTime(
      "America/New_York",
      new Date("2026-07-15T18:13:00Z"),
    );
    expect(afternoon.time).toMatch(/^2:13\sPM$/);
    expect(afternoon.zone.short).toBe("EDT");
    expect(afternoon.isDay).toBe(true);

    const night = describeLocalTime(
      "America/New_York",
      new Date("2026-07-15T06:13:00Z"),
    );
    expect(night.time).toMatch(/^2:13\sAM$/);
    expect(night.isDay).toBe(false);
  });

  it("counts midnight as night, not as hour 24", () => {
    const midnight = describeLocalTime("UTC", new Date("2026-07-15T00:30:00Z"));
    expect(midnight.time).toMatch(/^12:30\sAM$/);
    expect(midnight.isDay).toBe(false);
  });
});

describe("LocalTimeWeather", () => {
  const SYDNEY = { lat: -33.87, lng: 151.21 };

  it("shows the short zone after the time, and says the long one to a screen reader", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 04:13 UTC in July is 2:13 PM in Sydney, on standard time.
    vi.setSystemTime(new Date("2026-07-15T04:13:00Z"));
    const { container } = render(
      <LocalTimeWeather {...SYDNEY} showWeather={false} />,
    );

    const time = container.firstElementChild as HTMLElement;
    const visible = Array.from(time.childNodes)
      .filter(
        (node) =>
          !(node instanceof HTMLElement && node.classList.contains("sr-only")),
      )
      .map((node) => node.textContent)
      .join("");
    expect(visible).toMatch(/^2:13\sPM\u00a0AEST$/);

    // The abbreviation is decoration for a screen reader, and a tooltip for
    // a pointer.
    const abbreviation = screen.getByText("AEST", { exact: false });
    expect(abbreviation.getAttribute("aria-hidden")).toBe("true");
    expect(abbreviation.getAttribute("title")).toBe(
      "Australian Eastern Standard Time",
    );
    expect(
      screen.getByText(", local time, Australian Eastern Standard Time"),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("Sydney Time");
  });

  it("renders nothing without coordinates", () => {
    const { container } = render(
      <LocalTimeWeather lat={null} lng={null} showWeather={false} />,
    );
    expect(container.textContent).toBe("");
  });
});

// Open-Meteo is a third party. It is asked only when the weather is allowed,
// and it gets the town, not the contact's front door: both coordinates
// rounded to two decimals, about 1.1 km.
describe("the weather", () => {
  /** A pin on a front door in Sydney, finer than the town. */
  const DOOR = { lat: -33.868819, lng: 151.209295 };

  /** Draw the time and the weather, with every request answered 13°C. */
  function mount(showWeather: boolean) {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(
        Response.json({
          current_weather: { temperature: 13, weathercode: 0 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <LocalTimeWeather {...DOOR} showWeather={showWeather} />
      </QueryClientProvider>,
    );
    return fetchMock;
  }

  it("never asks Open-Meteo when the weather is not allowed", async () => {
    const fetchMock = mount(false);
    expect(screen.getByText(/local time/)).toBeTruthy();
    // Give a query that should not exist the chance to start.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/°C/)).toBeNull();
  });

  it("asks Open-Meteo once for the current weather at the rounded point, and shows the temperature", async () => {
    const fetchMock = mount(true);
    await waitFor(() => expect(screen.getByText("13°C")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.pathname).toBe("/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("-33.87");
    expect(url.searchParams.get("longitude")).toBe("151.21");
    expect(url.searchParams.get("current_weather")).toBe("true");
    // Nothing finer than the rounded point is in the address.
    expect(url.href).not.toContain("868819");
    expect(url.href).not.toContain("209295");
  });
});
