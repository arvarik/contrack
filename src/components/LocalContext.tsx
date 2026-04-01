import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import tzlookup from 'tz-lookup';
import { 
  Sun, Moon, Cloud, CloudRain, CloudLightning, 
  CloudSnow, CloudFog, CloudSun, CloudDrizzle, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LocalContextProps {
  lat: number | null;
  lng: number | null;
}

// Maps WMO Weather codes to Lucide components
// https://open-meteo.com/en/docs
const getWeatherIcon = (code: number, isDay: boolean) => {
  if (code === 0) return isDay ? <Sun className="w-4 h-4 text-amber-500" /> : <Moon className="w-4 h-4 text-indigo-300" />;
  if (code === 1 || code === 2 || code === 3) return isDay ? <CloudSun className="w-4 h-4 text-amber-500" /> : <Cloud className="w-4 h-4 text-indigo-300" />;
  if (code === 45 || code === 48) return <CloudFog className="w-4 h-4 text-slate-400" />;
  if ((code >= 51 && code <= 55) || (code >= 56 && code <= 57)) return <CloudDrizzle className="w-4 h-4 text-sky-400" />;
  if ((code >= 61 && code <= 65) || (code >= 66 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain className="w-4 h-4 text-blue-500" />;
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return <CloudSnow className="w-4 h-4 text-sky-200" />;
  if (code >= 95 && code <= 99) return <CloudLightning className="w-4 h-4 text-yellow-500" />;
  return <Cloud className="w-4 h-4 text-slate-400" />;
};

const formatLocalTime = (timezone: string) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Extract hour to determine day/night accurately for the icon mapping
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false
  });
  
  const currentHour = parseInt(hourFormatter.format(new Date()), 10);
  const isDay = currentHour >= 6 && currentHour < 18;
  
  return {
    timeString: formatter.format(new Date()),
    isDay
  };
};

export const LocalContext: React.FC<LocalContextProps> = ({ lat, lng }) => {
  const [timeData, setTimeData] = useState<{ timeString: string, isDay: boolean } | null>(null);
  
  const timezone = React.useMemo(() => {
    if (lat === null || lng === null) return null;
    try {
      return tzlookup(lat, lng);
    } catch (e) {
      return null; // Oceans or invalid coords
    }
  }, [lat, lng]);

  useEffect(() => {
    if (!timezone) return;
    
    // Initial Tick
    setTimeData(formatLocalTime(timezone));
    
    // Minute-clock tick
    const interval = setInterval(() => {
      setTimeData(formatLocalTime(timezone));
    }, 60000); // once per minute
    
    return () => clearInterval(interval);
  }, [timezone]);

  const { data: weather, isLoading: weatherLoading } = useQuery({
    queryKey: ['weather', lat, lng],
    queryFn: async () => {
      if (lat === null || lng === null) return null;
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
      if (!res.ok) throw new Error("Weather fetch failed");
      const data = await res.json();
      return data.current_weather;
    },
    enabled: lat !== null && lng !== null,
    staleTime: 1000 * 60 * 15, // Cache weather for 15 minutes
  });

  if (!lat || !lng || !timezone || !timeData) return null;

  return (
    <div className="flex items-center gap-3 text-sm font-medium text-on-surface-variant bg-surface-container-low px-3 py-1.5 rounded-full shadow-sm">
      
      {/* Timezone Context */}
      <div className="flex items-center gap-1.5 pr-3" style={{ borderRight: 'none', marginRight: '0' }}>
        {timeData.isDay ? (
          <Sun className="w-3.5 h-3.5 text-amber-500" />
        ) : (
          <Moon className="w-3.5 h-3.5 text-indigo-400" />
        )}
        <span>{timeData.timeString}</span>
      </div>

      {/* Weather Context */}
      <div className="flex items-center gap-1.5">
        <AnimatePresence mode="wait">
          {weatherLoading ? (
            <motion.div 
              key="loading" 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin opacity-50" />
            </motion.div>
          ) : weather ? (
            <motion.div 
              key="weather" 
              initial={{ opacity: 0, scale: 0.8 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0 }}
              className="flex items-center gap-1.5"
            >
              {getWeatherIcon(weather.weathercode, timeData.isDay)}
              <span>{Math.round(weather.temperature)}°</span>
            </motion.div>
          ) : (
            <span className="opacity-50 text-xs">No weather data</span>
          )}
        </AnimatePresence>
      </div>

    </div>
  );
};
