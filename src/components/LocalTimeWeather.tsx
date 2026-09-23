/**
 * LocalTimeWeather: the time where a contact is, and the weather there.
 *
 * Both are facts on the contact's meta line ("Sydney · 2:45 AM · 13°C"), so
 * they render as plain text. They used to wear grey pills, the same pills as
 * the social links, and a fact looked like something to press.
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

const formatLocalTime = (timezone: string, now: Date) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Extract hour to determine day/night accurately for the icon mapping
  const hourFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });

  const currentHour = parseInt(hourFormatter.format(now), 10);
  const isDay = currentHour >= 6 && currentHour < 18;

  const abbrFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "short",
  });

  let timeZoneName =
    abbrFormatter.formatToParts(now).find((p) => p.type === "timeZoneName")
      ?.value || "";
  if (timeZoneName.startsWith("GMT")) {
    const city = timezone.split("/").pop()?.replace(/_/g, " ") || "";
    timeZoneName = city ? `${city} Time` : timeZoneName;
  }

  return {
    timeString: formatter.format(now),
    timeZoneName,
    isDay,
  };
};

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
      <span aria-hidden="true">·</span>
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

  const { timeString, timeZoneName, isDay } = formatLocalTime(timezone, now);

  return (
    <>
      {/*
        Short on screen. The zone name is there for a screen reader, which
        has no location beside it to read the time against.
      */}
      <span>
        {timeString}
        <span className="sr-only">, local time ({timeZoneName})</span>
      </span>
      {showWeather && <Weather lat={lat} lng={lng} isDay={isDay} />}
    </>
  );
};
