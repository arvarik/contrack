import { useMemo } from 'react';

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 
  'aol.com', 'icloud.com', 'me.com', 'mac.com', 'msn.com', 
  'live.com', 'protonmail.com', 'zoho.com', 'yandex.com'
]);

/**
 * Extracts a business domain from an email address and returns a Google S2 Favicon URL.
 * Silently ignores generic free email providers.
 * 
 * @param email The contact's email address
 * @returns The S2 Favicon URL string, or null if invalid/generic.
 */
export function useCompanyLogo(email: string | null | undefined): string | null {
  return useMemo(() => {
    if (!email) return null;
    
    try {
      const parts = email.split('@');
      if (parts.length !== 2) return null;
      
      const domain = parts[1].toLowerCase().trim();
      
      if (GENERIC_DOMAINS.has(domain)) return null;
      if (!domain.includes('.')) return null; // basic validation
      
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
    } catch (e) {
      return null;
    }
  }, [email]);
}
