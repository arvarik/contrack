/**
 * Contact Import Parsers — Converts platform-specific data exports into
 * normalized Contrack `Contact` objects.
 *
 * Supported formats:
 * - Apple Contacts (vCard / .vcf)
 * - LinkedIn Connections (CSV)
 * - Facebook Friends (JSON)
 * - Google Contacts (CSV)
 * - Generic CSV (fallback)
 *
 * @module lib/importers
 */
import Papa from 'papaparse';
import { Contact } from '../types';

// ===========================================================================
// Social Profile Helpers
// ===========================================================================

/**
 * Known social platform URL templates. Used to:
 * 1. Resolve incomplete URLs (e.g., GitHub "x-apple:arvarik" → "https://github.com/arvarik")
 * 2. Extract handles from full URLs for display
 */
const SOCIAL_PLATFORM_URLS: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/in/{handle}',
  twitter: 'https://twitter.com/{handle}',
  github: 'https://github.com/{handle}',
  facebook: 'https://www.facebook.com/{handle}',
  instagram: 'https://www.instagram.com/{handle}',
  youtube: 'https://www.youtube.com/@{handle}',
  tiktok: 'https://www.tiktok.com/@{handle}',
  mastodon: 'https://mastodon.social/@{handle}',
  threads: 'https://www.threads.net/@{handle}',
};

/**
 * Resolve a social profile entry into a proper URL and handle.
 * Apple Contacts sometimes stores profiles as:
 * - Full URL: "http://www.linkedin.com/in/arvarik"
 * - Apple-prefixed handle: "x-apple:arvarik"
 * - Just a handle: "arvarik"
 */
function resolveSocialProfile(platform: string, rawUrl: string): { url: string; handle: string | null } {
  const platformKey = platform.toLowerCase();
  let url = rawUrl.trim();
  let handle: string | null = null;

  // Strip "x-apple:" prefix (Apple Contacts uses this for non-URL social handles)
  if (url.startsWith('x-apple:')) {
    url = url.replace('x-apple:', '');
  }

  // If it's already a valid URL, extract the handle from it
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const parsed = new URL(url);
      // Extract handle from path (e.g., /in/arvarik → arvarik)
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      handle = pathParts[pathParts.length - 1] || null;
    } catch { /* not a valid URL, treat as handle */ }
    return { url, handle };
  }

  // It's a bare handle — construct the full URL from our templates
  handle = url;
  const template = SOCIAL_PLATFORM_URLS[platformKey];
  if (template) {
    url = template.replace('{handle}', handle);
  } else {
    // Unknown platform, keep as-is but note it's not a URL
    url = handle;
  }

  return { url, handle };
}

// ===========================================================================
// Apple Contacts (vCard) Parser
// Handles multi-value TEL/EMAIL entries with labels, addresses, social
// profiles (including x-apple: handle format), and grouped item properties.
// ===========================================================================
export const parseVCard = (vcardData: string, sourcePlatform: string): Partial<Contact>[] => {
  const contacts: Partial<Contact>[] = [];
  const cards = vcardData.split(/BEGIN:VCARD/i);
  
  for (const card of cards) {
    if (!card.trim()) continue;
    
    const nameMatch = card.match(/^FN:(.*)$/m);
    if (!nameMatch) continue;

    const orgMatch = card.match(/^ORG:(.*)$/m);
    const titleMatch = card.match(/^TITLE:(.*)$/m);
    const bdayMatch = card.match(/^BDAY:(.*)$/m);
    const noteMatch = card.match(/^NOTE:(.*)$/m);

    // Extract ALL emails — handles both standard and Apple grouped properties:
    //   EMAIL;type=INTERNET;type=HOME:email@example.com
    //   item1.EMAIL;type=INTERNET:email@example.com
    const emailRegex = /^(?:item\d+\.)?EMAIL(?:[;][^:]*)*:(.+)$/gmi;
    const emails: any[] = [];
    let emailMatch;
    while ((emailMatch = emailRegex.exec(card)) !== null) {
      const fullLine = emailMatch[0];
      const emailValue = emailMatch[1].trim();
      if (!emailValue) continue;

      // Parse label from type parameters
      let label = 'personal';
      const typeMatch = fullLine.match(/type=(\w+)/gi);
      if (typeMatch) {
        const types = typeMatch.map(t => t.replace(/type=/i, '').toLowerCase());
        // Find the meaningful type (skip 'internet', 'pref')
        const meaningful = types.find(t => !['internet', 'pref'].includes(t));
        if (meaningful) label = meaningful;
      }

      // Skip duplicate emails
      if (emails.some(e => e.email.toLowerCase() === emailValue.toLowerCase())) continue;

      emails.push({
        email: emailValue,
        label,
        isPrimary: emails.length === 0,
      });
    }

    // Extract ALL phone numbers — handles Apple format:
    //   TEL;type=IPHONE;type=CELL;type=VOICE;type=pref:(732) 423-3295
    const phoneRegex = /^(?:item\d+\.)?TEL(?:[;][^:]*)*:(.+)$/gmi;
    const phones: any[] = [];
    let phoneMatch;
    while ((phoneMatch = phoneRegex.exec(card)) !== null) {
      const fullLine = phoneMatch[0];
      const phoneValue = phoneMatch[1].trim();
      if (!phoneValue) continue;

      let label = 'mobile';
      const typeMatch = fullLine.match(/type=(\w+)/gi);
      if (typeMatch) {
        const types = typeMatch.map(t => t.replace(/type=/i, '').toLowerCase());
        const meaningful = types.find(t => !['voice', 'pref', 'iphone'].includes(t));
        if (meaningful) label = meaningful;
      }

      phones.push({
        phone: phoneValue,
        label,
        isPrimary: phones.length === 0,
      });
    }

    // Extract ALL addresses (ADR) — handles:
    //   ADR;type=WORK:;;222 2nd St;San Francisco;CA;94105;United States
    //   item3.ADR;type=pref:;;15 Kinglet Dr S;Cranbury;NJ;08512;United States
    //   item4.ADR;type=HOME:;;1 Brady St\nApt A-625;San Francisco;CA;94103;United States
    const adrRegex = /^(?:item\d+\.)?ADR(?:[;][^:]*)*:(.+)$/gmi;
    const addresses: any[] = [];
    let adrMatch;
    while ((adrMatch = adrRegex.exec(card)) !== null) {
      const fullLine = adrMatch[0];
      const adrValue = adrMatch[1].trim();
      if (!adrValue) continue;

      // ADR format: PO Box;Extended;Street;City;State;Zip;Country
      const parts = adrValue.split(';');
      const street = (parts[2] || '').replace(/\\n/g, ', ').trim();
      const city = (parts[3] || '').trim();
      const state = (parts[4] || '').trim();
      const zip = (parts[5] || '').trim();
      const country = (parts[6] || '').trim();

      // Compose a readable address, skipping empty parts
      const addressParts = [street, city, [state, zip].filter(Boolean).join(' '), country].filter(Boolean);
      const addressStr = addressParts.join(', ');
      if (!addressStr) continue;

      // Parse label
      let label = 'home';
      const typeMatch = fullLine.match(/type=(\w+)/gi);
      if (typeMatch) {
        const types = typeMatch.map(t => t.replace(/type=/i, '').toLowerCase());
        const meaningful = types.find(t => !['pref'].includes(t));
        if (meaningful) label = meaningful;
      }

      // Also check for X-ABLabel on the same item group
      const itemPrefix = fullLine.match(/^(item\d+)\./i);
      if (itemPrefix) {
        const labelMatch = card.match(new RegExp(`^${itemPrefix[1]}\\.X-ABLabel:(.+)$`, 'mi'));
        if (labelMatch) {
          const customLabel = labelMatch[1].replace(/_\$!<|>!\$_/g, '').trim().toLowerCase();
          if (customLabel && customLabel !== 'other') label = customLabel;
        }
      }

      addresses.push({
        address: addressStr,
        label,
        isPrimary: addresses.length === 0,
      });
    }

    // Extract social profile URLs — handles:
    //   X-SOCIALPROFILE;type=linkedin:http://www.linkedin.com/in/arvarik
    //   X-SOCIALPROFILE;type=GitHub:x-apple:arvarik
    const socialRegex = /^X-SOCIALPROFILE(?:;[^:]*)*:(.+)$/gmi;
    const socialLinks: any[] = [];
    let socialMatch;
    while ((socialMatch = socialRegex.exec(card)) !== null) {
      const fullLine = socialMatch[0];
      const rawUrl = socialMatch[1].trim();

      // Extract platform from type= parameter
      let platform = 'other';
      const typeMatch = fullLine.match(/type=([^;:]+)/i);
      if (typeMatch) platform = typeMatch[1].toLowerCase();

      const resolved = resolveSocialProfile(platform, rawUrl);
      socialLinks.push({
        platform,
        url: resolved.url,
        handle: resolved.handle,
      });
    }

    // Extract URLs — handles both standard and Apple grouped properties:
    //   URL:https://example.com
    //   item5.URL;type=pref:https://www.arvarik.com
    const urlRegex = /^(?:item\d+\.)?URL(?:[;][^:]*)*:(.+)$/gmi;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(card)) !== null) {
      const url = urlMatch[1].trim();
      if (!url) continue;

      // Check the X-ABLabel for this item group to determine if it's a homepage
      const fullLine = urlMatch[0];
      const itemPrefix = fullLine.match(/^(item\d+)\./i);
      let label = 'website';
      if (itemPrefix) {
        const labelMatch = card.match(new RegExp(`^${itemPrefix[1]}\\.X-ABLabel:(.+)$`, 'mi'));
        if (labelMatch) {
          const customLabel = labelMatch[1].replace(/_\$!<|>!\$_/g, '').trim().toLowerCase();
          if (customLabel) label = customLabel;
        }
      }

      // Don't add duplicate URLs that are already in social links
      if (!socialLinks.some(sl => sl.url.toLowerCase() === url.toLowerCase())) {
        socialLinks.push({
          platform: label === 'homepage' ? 'website' : label,
          url,
          handle: null,
        });
      }
    }

    // Extract PHOTO as base64 data URL
    let avatarUrl: string | null = null;
    // Match multi-line PHOTO property (base64 data continues on indented lines)
    const photoMatch = card.match(/^PHOTO;ENCODING=b;TYPE=(\w+):(.+(?:\r?\n[ \t]+.+)*)/mi);
    if (photoMatch) {
      const mimeType = photoMatch[1].toLowerCase();
      const base64Data = photoMatch[2].replace(/\r?\n[ \t]+/g, '').trim();
      avatarUrl = `data:image/${mimeType};base64,${base64Data}`;
    }

    // Parse structured name for firstName/lastName
    const nMatch = card.match(/^N:([^;]*);([^;]*)(?:;.*)?$/m);
    let firstName = null;
    let lastName = null;
    if (nMatch) {
      lastName = nMatch[1].trim() || null;
      firstName = nMatch[2].trim() || null;
    }

    // Build location from the primary address
    let location: string | null = null;
    if (addresses.length > 0) {
      const primary = addresses.find((a: any) => a.isPrimary) || addresses[0];
      location = primary.address;
    }

    // Extract website from social links (prefer homepage-labeled URL)
    const websiteLink = socialLinks.find(sl => sl.platform === 'website' || sl.platform === 'homepage');
    const website = websiteLink?.url || null;

    contacts.push({
      name: nameMatch[1].trim(),
      firstName,
      lastName,
      company: orgMatch ? orgMatch[1].split(';')[0].trim() : null,
      role: titleMatch ? titleMatch[1].trim() : null,
      birthday: bdayMatch ? bdayMatch[1].trim() : null,
      about: noteMatch ? noteMatch[1].trim() : null,
      location,
      website,
      avatarUrl,
      emails,
      phones,
      addresses,
      socialLinks,
      sources: [{ platform: sourcePlatform }],
      _sourcePlatform: sourcePlatform,
    } as any);
  }
  return contacts;
};

// ===========================================================================
// LinkedIn CSV Parser
// Columns: First Name, Last Name, URL, Email Address, Company, Position, Connected On
// ===========================================================================
export const parseLinkedInCSV = (csvData: string): Promise<Partial<Contact>[]> => {
  return new Promise((resolve, reject) => {
    // LinkedIn CSVs may have introductory lines before the real header
    // Strip any lines before the actual header row
    const lines = csvData.split('\n');
    let headerIndex = lines.findIndex(line => 
      line.includes('First Name') && line.includes('Last Name')
    );
    if (headerIndex === -1) headerIndex = 0;
    const cleanedCSV = lines.slice(headerIndex).join('\n');

    Papa.parse(cleanedCSV, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data
            .map((row: any) => {
              const firstName = (row['First Name'] || '').trim();
              const lastName = (row['Last Name'] || '').trim();
              const fullName = `${firstName} ${lastName}`.trim();
              if (!fullName) return null;

              const email = (row['Email Address'] || '').trim();
              const company = (row['Company'] || '').trim();
              const position = (row['Position'] || '').trim();
              const profileUrl = (row['URL'] || '').trim();
              const connectedOn = (row['Connected On'] || '').trim();

              const emails: any[] = email ? [{ email, label: 'work', isPrimary: true }] : [];
              const socialLinks: any[] = profileUrl ? [{ platform: 'linkedin', url: profileUrl }] : [];

              return {
                name: fullName,
                firstName: firstName || null,
                lastName: lastName || null,
                company: company || null,
                role: position || null,
                emails,
                socialLinks,
                sources: [{
                  platform: 'linkedin',
                  externalId: profileUrl || null,
                  connectedOn: connectedOn || null,
                  rawData: JSON.stringify(row),
                }],
                _sourcePlatform: 'linkedin',
              } as any;
            })
            .filter(Boolean);
          
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse LinkedIn CSV structure.'));
        }
      },
      error: () => reject(new Error('Failed to read CSV file.'))
    });
  });
};

// ===========================================================================
// Facebook JSON Parser
// Input: friends_v2 JSON array with [{ name, timestamp }] structure
// ===========================================================================
export const parseFacebookJSON = (jsonData: string): Partial<Contact>[] => {
  try {
    const data = JSON.parse(jsonData);
    
    // Facebook exports come in various structures
    // Common: { friends_v2: [{ name, timestamp }] }
    // Or: [{ name, timestamp }]
    let friends: any[] = [];
    
    if (data.friends_v2) {
      friends = data.friends_v2;
    } else if (data.friends) {
      friends = data.friends;
    } else if (Array.isArray(data)) {
      friends = data;
    } else {
      // Try to find any array of objects with a 'name' field
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key]) && data[key].length > 0 && data[key][0].name) {
          friends = data[key];
          break;
        }
      }
    }

    if (friends.length === 0) {
      throw new Error('Could not find friends data in the JSON file. Expected a "friends_v2" or "friends" array.');
    }

    return friends
      .filter((f: any) => f.name)
      .map((f: any) => {
        // Facebook uses UTF-8 escaped encoding for names
        let name = f.name;
        try {
          name = decodeURIComponent(escape(f.name));
        } catch { /* keep original */ }

        const connectedOn = f.timestamp ? new Date(f.timestamp * 1000).toISOString().split('T')[0] : null;

        return {
          name,
          sources: [{
            platform: 'facebook',
            connectedOn,
            rawData: JSON.stringify(f),
          }],
          _sourcePlatform: 'facebook',
        } as any;
      });
  } catch (e: any) {
    if (e.message.includes('Could not find')) throw e;
    throw new Error('Failed to parse Facebook JSON. Ensure you uploaded the correct friends data file.');
  }
};

// ===========================================================================
// Google Contacts CSV Parser
// Columns: Given Name, Family Name, E-mail 1 - Value, Phone 1 - Value, 
//          Organization 1 - Name, Organization 1 - Title, etc.
// ===========================================================================
export const parseGoogleCSV = (csvData: string): Promise<Partial<Contact>[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data
            .map((row: any) => {
              const firstName = (row['Given Name'] || '').trim();
              const lastName = (row['Family Name'] || '').trim();
              const fullName = (row['Name'] || `${firstName} ${lastName}`).trim();
              if (!fullName) return null;

              // Collect all emails (Google supports E-mail 1, E-mail 2, etc.)
              const emails: any[] = [];
              for (let i = 1; i <= 5; i++) {
                const email = (row[`E-mail ${i} - Value`] || '').trim();
                const type = (row[`E-mail ${i} - Type`] || 'personal').toLowerCase();
                if (email) {
                  emails.push({ email, label: type === '*' ? 'personal' : type, isPrimary: i === 1 });
                }
              }

              // Collect all phones
              const phones: any[] = [];
              for (let i = 1; i <= 5; i++) {
                const phone = (row[`Phone ${i} - Value`] || '').trim();
                const type = (row[`Phone ${i} - Type`] || 'mobile').toLowerCase();
                if (phone) {
                  phones.push({ phone, label: type === '*' ? 'mobile' : type, isPrimary: i === 1 });
                }
              }

              const company = (row['Organization 1 - Name'] || '').trim();
              const role = (row['Organization 1 - Title'] || '').trim();
              const location = (row['Address 1 - Formatted'] || '').trim();
              const birthday = (row['Birthday'] || '').trim();
              const notes = (row['Notes'] || '').trim();
              const website = (row['Website 1 - Value'] || '').trim();

              return {
                name: fullName,
                firstName: firstName || null,
                lastName: lastName || null,
                company: company || null,
                role: role || null,
                location: location || null,
                birthday: birthday || null,
                about: notes || null,
                website: website || null,
                emails,
                phones,
                sources: [{ platform: 'google' }],
                _sourcePlatform: 'google',
              } as any;
            })
            .filter(Boolean);
          
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse Google Contacts CSV structure.'));
        }
      },
      error: () => reject(new Error('Failed to read CSV file.'))
    });
  });
};

// ===========================================================================
// Generic CSV Parser (fallback)
// ===========================================================================
export const parseGenericCSV = (csvData: string, sourceName: string): Promise<Partial<Contact>[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsed = results.data.map((row: any) => {
            const name = row['Name'] || row['name'] || row['Full Name'];
            if (!name || name === 'Unknown') return null;

            const email = row['Email'] || row['email'] || row['Email Address'] || '';
            const phone = row['Phone'] || row['phone'] || row['Phone Number'] || '';

            return {
              name,
              company: row['Company'] || row['company'] || null,
              role: row['Role'] || row['Title'] || row['Position'] || null,
              emails: email ? [{ email, label: 'personal', isPrimary: true }] : [],
              phones: phone ? [{ phone, label: 'mobile', isPrimary: true }] : [],
              sources: [{ platform: sourceName }],
              _sourcePlatform: sourceName,
            } as any;
          }).filter(Boolean);
          
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse CSV structure.'));
        }
      },
      error: () => reject(new Error('Failed to read CSV file.'))
    });
  });
};
