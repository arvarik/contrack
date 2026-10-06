/**
 * The weather, without the weather service.
 *
 * A contact with coordinates shows the temperature where they are, from
 * Open-Meteo. A spec that reached it would depend on the service, and an
 * accessibility scan that starts while the pill fades in reads its text at a
 * tenth of its opacity and fails the contrast. So every test answers the host
 * here, at once, with one fixed reading. The request still leaves the page,
 * which keeps the production CSP honest.
 */
import type { Page } from "@playwright/test";

/** Every URL on the Open-Meteo host. */
export const OPEN_METEO_ROUTE = "**/api.open-meteo.com/**";

/** A mild afternoon, the same one every time. */
export const CURRENT_WEATHER = {
  current_weather: {
    temperature: 16,
    windspeed: 4,
    winddirection: 180,
    weathercode: 1,
    is_day: 1,
    time: "2026-01-01T12:00",
  },
};

/** Answer every Open-Meteo request with {@link CURRENT_WEATHER}. */
export async function stubWeather(page: Page): Promise<void> {
  await page.route(OPEN_METEO_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(CURRENT_WEATHER),
    });
  });
}
