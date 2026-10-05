/**
 * PlatformIcon — Resolves a social platform name to the appropriate icon.
 * Uses Lucide-style icons for known platforms, falls back to the site's icon
 * from this server's logo route, or a globe.
 */
import React, { useState } from "react";
import { Globe } from "lucide-react";
import {
  Facebook,
  Github,
  Instagram,
  Linkedin,
  Twitter,
  Youtube,
} from "../../../components/socialIcons";

// Known platform → icon mapping
const PLATFORM_ICONS: Record<string, React.FC<{ className?: string }>> = {
  linkedin: Linkedin,
  facebook: Facebook,
  github: Github,
  twitter: Twitter,
  instagram: Instagram,
  youtube: Youtube,
};

// Known platform → brand color mapping
export const PLATFORM_COLORS: Record<string, string> = {
  linkedin: "text-[#0A66C2]",
  facebook: "text-[#1877F2]",
  github: "text-[#333] dark:text-[#f0f6fc]",
  twitter: "text-[#1DA1F2]",
  instagram: "text-[#E4405F]",
  youtube: "text-[#FF0000]",
};

/** The host names the logo route accepts (server/routes/logos.ts). */
const LOGO_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/;

/**
 * The site's icon from this server's logo route, or null for a URL with no
 * such host. The server fetches the icon once and keeps it, so the browser
 * never asks a third party about the people in the list.
 */
function faviconUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return LOGO_DOMAIN.test(host) ? `/api/logos/${host}` : null;
}

/**
 * Check if a platform has a known icon.
 */
export function hasKnownIcon(platform: string): boolean {
  return platform.toLowerCase() in PLATFORM_ICONS;
}

interface PlatformIconProps {
  platform: string;
  url?: string;
  className?: string;
  useFavicon?: boolean;
}

export const PlatformIcon = ({
  platform,
  url,
  className,
  useFavicon = false,
}: PlatformIconProps) => {
  const key = platform.toLowerCase();
  const Icon = PLATFORM_ICONS[key];

  if (Icon) {
    return <Icon className={className} />;
  }

  // For unknown platforms with a URL, try to show the site's icon
  const icon = useFavicon && url ? faviconUrl(url) : null;
  if (icon) return <SiteIcon src={icon} alt={platform} className={className} />;

  return <Globe className={className} />;
};

/** The site's icon, or the globe when the server has none. */
function SiteIcon({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className={className} />;
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-4 h-4 rounded-sm"
      onError={() => setFailed(true)}
    />
  );
}
