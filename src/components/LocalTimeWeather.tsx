/**
 * LocalTimeWeather: the time where a contact is, and the weather there.
 *
 * Both are facts on the contact's meta line ("Sydney · 2:45 AM AEST ·
 * 13°C"), so they render as plain text. They used to wear grey pills, the
 * same pills as the social links, and a fact looked like something to press.
 *
 * The time carries its zone, short: "2:13 PM EDT". A time alone does not say
 * whether it is ahead of the reader or behind. The zone is the abbreviation
 * people write when there is one (EDT, BST, CEST, AEST, IST, JST), and the
 * offset when there is none (GMT+4). A screen reader hears the long name
 * instead, "2:13 PM, local time, Eastern Daylight Time", because letters
 * read one by one say nothing, and a pointer that rests on the abbreviation
 * shows the long name too. `zoneName` below works the name out.
 *
 * The component renders a fragment, so each part is its own item in the
 * caller's flex row: the time, then a middle dot and the weather.
 *
 * The weather is a request to Open-Meteo with the contact's coordinates. It
 * is a third party, so the weather renders only when `showWeather` allows it,
 * and when it does not, the part that owns the request never mounts.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import tzlookup from "tz-lookup";
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
  /**
   * True when the weather may show. When false, no request goes to
   * Open-Meteo.
   */
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

// ═══════════════════════════════════════════════════════════════════════════
// The zone's name
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The locales asked for a zone's short name, in this order. The first answer
 * that is an abbreviation wins.
 *
 * No one locale knows them all. "en-US" answers EST and PDT but "GMT+10"
 * for Sydney, where "en-AU" answers AEST. "en-GB" knows BST, CET and CEST,
 * "en-IN" knows IST for India and "en-IE" knows IST for Ireland, "en-ZA"
 * SAST and "en-SG" SGT, "en-CA" Newfoundland's NST, and "en-HK" HKT. Japan's
 * JST is known only to "ja-JP", which is why one locale here is not English:
 * it comes last, so it can only fill a gap. Checked in Node 22 against every
 * IANA zone, in January and in July: the list names about half of them, the
 * populous half. The rest, such as Seoul, Shanghai, São Paulo and Moscow,
 * keep the offset.
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
export interface ZoneName {
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
 * and the clock asks every minute, so each zone's are made once. A page
 * meets a handful of zones, so the map stays small.
 */
const formattersByZone = new Map<string, ZoneFormatters>();

/**
 * The names, by zone and by what "en-US" calls it at that moment. The
 * "en-US" name changes with daylight saving ("EST" to "EDT", "GMT+10" to
 * "GMT+11"), so it tells one half of the year from the other, and the walk
 * down `ZONE_LOCALES` runs once for each.
 */
const namesByZone = new Map<string, ZoneName>();

function formattersFor(timeZone: string): ZoneFormatters {
  let formatters = formattersByZone.get(timeZone);
  if (!formatters) {
    formatters = {
      time: new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
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
 * where no locale in `ZONE_LOCALES` has an abbreviation.
 *
 * It used to turn every "GMT+X" into "<City> Time", from the last part of
 * the zone's id, so a reader got "Sao Paulo Time" and no way to tell how far
 * behind São Paulo is. An offset says that.
 *
 * `timeZone` is an IANA id, as `timeZoneAt` returns it.
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
 * The IANA time zone at a point, or null when there is none.
 *
 * Exported so a caller can tell before rendering whether the time will show,
 * and so place a separator only where there is something to separate.
 */
export function timeZoneAt(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return null;
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
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
 * The temperature and a glyph for the sky.
 *
 * Nothing renders while the answer is on its way or when the request fails.
 * A spinner or "No data" in a line of facts is noise, and the separator
 * before the weather comes with it, so the line never ends in a lone dot.
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
  // The unit is an account preference, so the provider re-renders this the
  // moment it changes.
  const { preferences } = usePreferences();
  const tempUnit = preferences.tempUnit;

  const { data: weather } = useQuery({
    queryKey: ["weather", lat, lng],
    queryFn: async () => {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`,
      );
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
        // The temperature arrives at its full colour and grows into
        // place. Text faded in from nothing is text below its
        // contrast for as long as the fade lasts, which WCAG 1.4.3
        // does not excuse and an accessibility scan catches whenever
        // it starts mid-animation.
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
        "2:13 PM EDT" on screen. A screen reader skips the abbreviation and
        hears "2:13 PM, local time, Eastern Daylight Time": it has no place
        beside it to read the time against, and "E D T" read letter by
        letter says nothing. A no-break space keeps the zone on the time's
        line when the meta line wraps. Tabular digits hold the width from one
        minute to the next ("3:09" was wider than "3:10"), so the items after
        the time do not shift, and a full line does not wrap and unwrap as
        the clock moves.
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
