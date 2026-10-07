/**
 * The time where a contact is, and the weather there, as plain text on the
 * meta line ("Sydney · 2:45 AM AEST · 13°C"). A fragment, so each part is an
 * item in the caller's flex row.
 *
 * The time carries its zone: the abbreviation when there is one (EDT, AEST),
 * the offset when not (GMT+4). A screen reader and a hover get the long name
 * (`zoneName`).
 *
 * The weather comes from Open-Meteo, a third party, so it renders only when
 * `showWeather` allows, and gets coordinates rounded to about a kilometer.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import tzlookup from "@photostructure/tz-lookup";
import {
  Sun,
  Moon,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudSnow,
  CloudFog,
  CloudSun,
  CloudDrizzle,
} from "lucide-react";
import { motion } from "motion/react";
import { usePreferences } from "../contexts/PreferencesContext";
import { MetaDot } from "./ui/MetaDot";

interface LocalTimeWeatherProps {
  lat: number | null;
  lng: number | null;
  /** True when the weather may show. False sends no request to Open-Meteo. */
  showWeather: boolean;
}

// Maps WMO Weather codes to Lucide components
// https://open-meteo.com/en/docs
const getWeatherIcon = (code: number, isDay: boolean) => {
  if (code === 0)
    return isDay ? (
      <Sun className="w-4 h-4 text-warning" />
    ) : (
      <Moon className="w-4 h-4 text-info" />
    );
  if (code === 1 || code === 2 || code === 3)
    return isDay ? (
      <CloudSun className="w-4 h-4 text-warning" />
    ) : (
      <Cloud className="w-4 h-4 text-info" />
    );
  if (code === 45 || code === 48)
    return <CloudFog className="w-4 h-4 text-on-surface-variant" />;
  if ((code >= 51 && code <= 55) || (code >= 56 && code <= 57))
    return <CloudDrizzle className="w-4 h-4 text-info" />;
  if (
    (code >= 61 && code <= 65) ||
    (code >= 66 && code <= 67) ||
    (code >= 80 && code <= 82)
  )
    return <CloudRain className="w-4 h-4 text-info" />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return <CloudSnow className="w-4 h-4 text-info" />;
  if (code >= 95 && code <= 99)
    return <CloudLightning className="w-4 h-4 text-warning" />;
  return <Cloud className="w-4 h-4 text-on-surface-variant" />;
};

// The zone's name

/**
 * The locales asked for a zone's short name, in order. The first
 * abbreviation wins. No one locale knows them all: "en-US" says "GMT+10" for
 * Sydney, where "en-AU" says AEST. Only "ja-JP" knows JST, so it comes last.
 * In Node 26 (ICU 78.3, tzdata 2026c) the list names the populous half of
 * the IANA zones. The rest, such as Seoul and Moscow, keep the offset.
 */
const ZONE_LOCALES = [
  "en-US",
  "en-GB",
  "en-AU",
  "en-IN",
  "en-NZ",
  "en-CA",
  "en-IE",
  "en-ZA",
  "en-SG",
  "en-HK",
  "ja-JP",
] as const;

/**
 * An abbreviation: two to five capital letters, "GMT" and "UTC" included.
 * Not an offset ("GMT+9", "GMT-3:30") and not a name in another script.
 */
const ABBREVIATION = /^[A-Z]{2,5}$/;

/** A zone's name, short for the screen and long for a screen reader. */
interface ZoneName {
  /** "EDT", "AEST", or the offset when there is no abbreviation: "GMT+4". */
  short: string;
  /** "Eastern Daylight Time", "Gulf Standard Time". */
  long: string;
}

/** The formatters for one zone, made once and kept. */
interface ZoneFormatters {
  time: Intl.DateTimeFormat;
  hour: Intl.DateTimeFormat;
  long: Intl.DateTimeFormat;
  /** One per `ZONE_LOCALES` entry, each made the first time it is asked. */
  short: (Intl.DateTimeFormat | undefined)[];
}

/**
 * The formatters, by zone. A formatter costs far more to make than to use,
 * so each zone's are made once.
 */
const formattersByZone = new Map<string, ZoneFormatters>();

/**
 * The names, by zone and by its "en-US" name at that moment, which changes
 * with daylight saving, so `ZONE_LOCALES` is walked once per half-year.
 */
const namesByZone = new Map<string, ZoneName>();

function formattersFor(timeZone: string): ZoneFormatters {
  let formatters = formattersByZone.get(timeZone);
  if (!formatters) {
    formatters = {
      // The reader's own clock: 15:21 or 3:21 PM.
      time: new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
      }),
      // For day or night. `h23` counts midnight as 0: with `hour12: false`
      // an engine may say "24".
      hour: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }),
      long: new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "long",
      }),
      short: [],
    };
    formattersByZone.set(timeZone, formatters);
  }
  return formatters;
}

/** The zone name part of a formatted date. */
const zonePart = (formatter: Intl.DateTimeFormat, now: Date): string =>
  formatter.formatToParts(now).find((part) => part.type === "timeZoneName")
    ?.value ?? "";

/** What `ZONE_LOCALES[index]` calls the zone at this moment. */
function shortName(
  formatters: ZoneFormatters,
  timeZone: string,
  index: number,
  now: Date,
): string {
  let formatter = formatters.short[index];
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(ZONE_LOCALES[index], {
      timeZone,
      timeZoneName: "short",
    });
    formatters.short[index] = formatter;
  }
  return zonePart(formatter, now);
}

/**
 * A time zone's name at a moment: "EDT" and "Eastern Daylight Time" for New
 * York in July, and "GMT-3" and "Brasilia Standard Time" for São Paulo,
 * where no locale in `ZONE_LOCALES` has an abbreviation. `timeZone` is an
 * IANA id, as `timeZoneAt` returns it.
 */
export function zoneName(timeZone: string, now: Date = new Date()): ZoneName {
  const formatters = formattersFor(timeZone);
  // "en-US" first: its answer is the key, and it is the offset when no
  // locale has an abbreviation.
  const first = shortName(formatters, timeZone, 0, now);
  const key = `${timeZone} ${first}`;
  const known = namesByZone.get(key);
  if (known) return known;

  let short = ABBREVIATION.test(first) ? first : null;
  for (let index = 1; short === null && index < ZONE_LOCALES.length; index++) {
    const candidate = shortName(formatters, timeZone, index, now);
    if (ABBREVIATION.test(candidate)) short = candidate;
  }
  const name: ZoneName = {
    short: short ?? first,
    long: zonePart(formatters.long, now) || (short ?? first),
  };
  namesByZone.set(key, name);
  return name;
}

/**
 * The time where a contact is, the zone's name, and whether it is day there
 * (6 AM to 6 PM), which picks the sun or the moon for the weather glyph.
 */
export function describeLocalTime(
  timeZone: string,
  now: Date = new Date(),
): { time: string; zone: ZoneName; isDay: boolean } {
  const formatters = formattersFor(timeZone);
  const hour = Number(formatters.hour.format(now));
  return {
    time: formatters.time.format(now),
    zone: zoneName(timeZone, now),
    isDay: hour >= 6 && hour < 18,
  };
}

/**
 * The IANA time zone at a point, or null. A caller uses it to place a
 * separator only when the time will show.
 */
export function timeZoneAt(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null;
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

/**
 * A coordinate rounded to two decimals, about 1.1 km. A pin can sit on a
 * front door, and the third party only needs the town.
 */
function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The Open-Meteo request for the current weather near a point, rounded. */
function weatherUrl(lat: number, lng: number): string {
  const params = new URLSearchParams({
    latitude: String(roundCoordinate(lat)),
    longitude: String(roundCoordinate(lng)),
    current_weather: "true",
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/** A clock that moves on once a minute. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);
  return now;
}

/**
 * The temperature and a glyph for the sky. Nothing, separator included,
 * renders while loading or after a failure, so the line never ends in a
 * lone dot.
 */
const Weather = ({
  lat,
  lng,
  isDay,
}: {
  lat: number;
  lng: number;
  isDay: boolean;
}) => {
  // The unit is an account preference.
  const { preferences } = usePreferences();
  const tempUnit = preferences.tempUnit;

  // Keyed by the rounded point, the one the request sends, so two contacts
  // in the same town share one answer.
  const { data: weather } = useQuery({
    queryKey: ["weather", roundCoordinate(lat), roundCoordinate(lng)],
    queryFn: async () => {
      const res = await fetch(weatherUrl(lat, lng));
      if (!res.ok) throw new Error("Weather fetch failed");
      const data = await res.json();
      return data.current_weather ?? null;
    },
    staleTime: 1000 * 60 * 15, // Cache weather for 15 minutes
  });

  if (!weather) return null;

  const tempVal = weather.temperature ?? 0;
  const displayTemp =
    tempUnit === "fahrenheit"
      ? Math.round((tempVal * 9) / 5 + 32)
      : Math.round(tempVal);
  const tempLabel = tempUnit === "fahrenheit" ? "°F" : "°C";

  return (
    <>
      <MetaDot />
      <motion.span
        // Full color from the start, and grows into place: faded text is
        // below its contrast while it fades (WCAG 1.4.3).
        initial={{ opacity: 1, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        className="inline-flex items-center gap-1"
      >
        <span aria-hidden="true" className="inline-flex">
          {getWeatherIcon(weather.weathercode, isDay)}
        </span>
        <span>
          {displayTemp}
          {tempLabel}
        </span>
      </motion.span>
    </>
  );
};

export const LocalTimeWeather: React.FC<LocalTimeWeatherProps> = ({
  lat,
  lng,
  showWeather,
}) => {
  const timezone = useMemo(() => timeZoneAt(lat, lng), [lat, lng]);
  const now = useNow();

  if (lat === null || lng === null || !timezone) return null;

  const { time, zone, isDay } = describeLocalTime(timezone, now);

  return (
    <>
      {/*
        "2:13 PM EDT" on screen. A screen reader hears "2:13 PM, local time,
        Eastern Daylight Time" instead of "E D T". A no-break space keeps the
        zone with the time. Tabular digits keep the width as the minutes
        change, so the line does not shift or rewrap.
      */}
      <span className="tabular-nums">
        {time}
        <span aria-hidden="true" title={zone.long}>
          {"\u00a0"}
          {zone.short}
        </span>
        <span className="sr-only">, local time, {zone.long}</span>
      </span>
      {showWeather && <Weather lat={lat} lng={lng} isDay={isDay} />}
    </>
  );
};
