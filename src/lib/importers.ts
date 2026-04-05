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
// Apple Contacts (vCard) Parser
// Handles multi-value TEL/EMAIL entries with labels
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
    const urlMatch = card.match(/^URL:(.*)$/m);

    // Extract ALL emails with labels
    const emailRegex = /^EMAIL(?:;TYPE=([^:;]+))?[^:]*:(.*)$/gm;
    const emails: any[] = [];
    let emailMatch;
    while ((emailMatch = emailRegex.exec(card)) !== null) {
      const label = (emailMatch[1] || 'personal').toLowerCase().replace('pref,', '').replace(',pref', '').trim();
      emails.push({
        email: emailMatch[2].trim(),
        label: label === 'internet' ? 'personal' : label,
        isPrimary: emails.length === 0,
      });
    }

    // Extract ALL phone numbers with labels
    const phoneRegex = /^TEL(?:;TYPE=([^:;]+))?[^:]*:(.*)$/gm;
    const phones: any[] = [];
    let phoneMatch;
    while ((phoneMatch = phoneRegex.exec(card)) !== null) {
      const label = (phoneMatch[1] || 'mobile').toLowerCase().replace('pref,', '').replace(',pref', '').replace('voice,', '').replace(',voice', '').trim();
      phones.push({
        phone: phoneMatch[2].trim(),
        label: label || 'mobile',
        isPrimary: phones.length === 0,
      });
    }

    // Extract social profile URLs
    const socialRegex = /^X-SOCIALPROFILE(?:;TYPE=([^:;]+))?[^:]*:(.*)$/gm;
    const socialLinks: any[] = [];
    let socialMatch;
    while ((socialMatch = socialRegex.exec(card)) !== null) {
      socialLinks.push({
        platform: (socialMatch[1] || 'other').toLowerCase(),
        url: socialMatch[2].trim(),
      });
    }

    if (urlMatch) {
      socialLinks.push({ platform: 'website', url: urlMatch[1].trim() });
    }

    // Parse structured name for firstName/lastName
    const nMatch = card.match(/^N:([^;]*);([^;]*)(?:;.*)?$/m);
    let firstName = null;
    let lastName = null;
    if (nMatch) {
      lastName = nMatch[1].trim() || null;
      firstName = nMatch[2].trim() || null;
    }

    contacts.push({
      name: nameMatch[1].trim(),
      firstName,
      lastName,
      company: orgMatch ? orgMatch[1].split(';')[0].trim() : null,
      role: titleMatch ? titleMatch[1].trim() : null,
      birthday: bdayMatch ? bdayMatch[1].trim() : null,
      about: noteMatch ? noteMatch[1].trim() : null,
      emails,
      phones,
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
