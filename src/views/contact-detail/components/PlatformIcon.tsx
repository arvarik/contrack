/**
 * PlatformIcon — Resolves a social platform name to the appropriate icon.
 * Uses Lucide icons for known platforms, falls back to a favicon proxy or Globe.
 */
import React from 'react';
import { Linkedin, Facebook, Github, Twitter, Instagram, Globe, Youtube, ExternalLink } from 'lucide-react';

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
  linkedin: 'text-[#0A66C2]',
  facebook: 'text-[#1877F2]',
  github: 'text-[#333] dark:text-[#f0f6fc]',
  twitter: 'text-[#1DA1F2]',
  instagram: 'text-[#E4405F]',
  youtube: 'text-[#FF0000]',
  website: 'text-on-surface-variant',
  homepage: 'text-on-surface-variant',
};

/**
 * Extract domain from a URL for favicon resolution.
 */
export function getDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return null;
  }
}

/**
 * Get a favicon URL for a domain using Google's favicon service.
 */
export function getFaviconUrl(url: string): string | null {
  const domain = getDomainFromUrl(url);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
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

export const PlatformIcon = ({ platform, url, className, useFavicon = false }: PlatformIconProps) => {
  const key = platform.toLowerCase();
  const Icon = PLATFORM_ICONS[key];

  if (Icon) {
    return <Icon className={className} />;
  }

  // For unknown platforms with a URL, try to show the favicon
  if (useFavicon && url) {
    const faviconUrl = getFaviconUrl(url);
    if (faviconUrl) {
      return (
        <img
          src={faviconUrl}
          alt={platform}
          className="w-4 h-4 rounded-sm"
          onError={(e) => {
            // Fall back to Globe icon on favicon load failure
            const parent = (e.target as HTMLElement).parentElement;
            if (parent) {
              (e.target as HTMLElement).style.display = 'none';
            }
          }}
        />
      );
    }
  }

  return <Globe className={className} />;
};
