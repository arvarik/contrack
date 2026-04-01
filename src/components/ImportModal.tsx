import { useState, useRef } from 'react';
import { Modal } from './Modal';
import { UploadCloud, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { useBulkCreateContacts } from '../api';
import { Contact } from '../types';
import { TAB_CONTAINER, tabItem, SECTION_BG } from '../lib/styles';
import { cn } from '../lib/utils';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportTab = 'apple' | 'linkedin' | 'facebook' | 'google';

export const ImportModal = ({ isOpen, onClose, onSuccess }: ImportModalProps) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('apple');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkCreate = useBulkCreateContacts();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccessCount(null);

    try {
      const text = await file.text();
      let newContacts: Partial<Contact>[] = [];

      if (file.name.endsWith('.vcf')) {
        newContacts = parseVCard(text, 'apple');
      } else if (file.name.endsWith('.csv')) {
        if (activeTab === 'linkedin') {
          newContacts = await parseLinkedInCSV(text);
        } else if (activeTab === 'google') {
          newContacts = await parseGoogleCSV(text);
        } else {
          newContacts = await parseGenericCSV(text, activeTab);
        }
      } else if (file.name.endsWith('.json')) {
        if (activeTab === 'facebook') {
          newContacts = parseFacebookJSON(text);
        } else {
          throw new Error('JSON import is only supported for Facebook data exports.');
        }
      } else {
        throw new Error('Unsupported file format. Please upload a .vcf, .csv, or .json file.');
      }

      if (newContacts.length === 0) {
        throw new Error('No valid contacts found in the file.');
      }

      const result = await bulkCreate.mutateAsync(newContacts);
      setSuccessCount(result.count);
      setTimeout(() => {
        onSuccess();
        onClose();
        setSuccessCount(null);
      }, 2000);

    } catch (err: any) {
      setError(err.message || 'Failed to process file.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ===========================================================================
  // Apple Contacts (vCard) Parser
  // Handles multi-value TEL/EMAIL entries with labels
  // ===========================================================================
  const parseVCard = (vcardData: string, sourcePlatform: string): Partial<Contact>[] => {
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
  const parseLinkedInCSV = (csvData: string): Promise<Partial<Contact>[]> => {
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
  const parseFacebookJSON = (jsonData: string): Partial<Contact>[] => {
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
  const parseGoogleCSV = (csvData: string): Promise<Partial<Contact>[]> => {
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
  const parseGenericCSV = (csvData: string, sourceName: string): Promise<Partial<Contact>[]> => {
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

  const getAcceptedFormats = () => {
    switch (activeTab) {
      case 'apple': return '.vcf';
      case 'linkedin': return '.csv';
      case 'facebook': return '.json';
      case 'google': return '.csv';
      default: return '.csv,.vcf,.json';
    }
  };

  const getFormatLabel = () => {
    switch (activeTab) {
      case 'apple': return 'vCard (.vcf)';
      case 'linkedin': return 'CSV (.csv)';
      case 'facebook': return 'JSON (.json)';
      case 'google': return 'CSV (.csv)';
      default: return '.csv, .vcf, .json';
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Contacts">
      <div className={cn(TAB_CONTAINER, "mb-6")}>
        {(['apple', 'linkedin', 'google', 'facebook'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={tabItem(activeTab === tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-surface-container-low p-6 rounded-xl mb-6 text-sm text-on-surface-variant">
        <h4 className="font-bold text-on-surface mb-2 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          How to export from {activeTab === 'apple' ? 'Apple Contacts' : activeTab === 'linkedin' ? 'LinkedIn' : activeTab === 'google' ? 'Google Contacts' : 'Facebook'}
        </h4>
        {activeTab === 'apple' && (
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Open the <strong>Contacts</strong> app on your Mac.</li>
            <li>Select the contacts you want to export (or Cmd+A for all).</li>
            <li>Go to <strong>File &gt; Export &gt; Export vCard...</strong></li>
            <li>Save the <strong>.vcf</strong> file and upload it below.</li>
          </ol>
        )}
        {activeTab === 'linkedin' && (
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Go to LinkedIn <strong>Settings & Privacy</strong>.</li>
            <li>Select <strong>Data Privacy</strong> &gt; <strong>Get a copy of your data</strong>.</li>
            <li>Choose <strong>Connections</strong> and request archive.</li>
            <li>Download the archive, extract it, and upload the <strong>Connections.csv</strong> file below.</li>
            <li className="text-xs text-on-surface-variant/70 mt-1">Fields imported: Name, Company, Position, Email, Profile URL, Connection Date</li>
          </ol>
        )}
        {activeTab === 'google' && (
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Go to <strong>contacts.google.com</strong>.</li>
            <li>Click <strong>Export</strong> in the left sidebar.</li>
            <li>Select <strong>Google CSV</strong> format and click <strong>Export</strong>.</li>
            <li>Upload the downloaded <strong>.csv</strong> file below.</li>
            <li className="text-xs text-on-surface-variant/70 mt-1">Fields imported: Name, multiple Emails & Phones, Company, Role, Address, Birthday, Notes, Website</li>
          </ol>
        )}
        {activeTab === 'facebook' && (
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Go to Facebook <strong>Settings & Privacy</strong> &gt; <strong>Settings</strong>.</li>
            <li>Navigate to <strong>Accounts Center</strong> &gt; <strong>Your information and permissions</strong>.</li>
            <li>Select <strong>Download your information</strong>.</li>
            <li>Choose <strong>JSON</strong> format and select the <strong>Friends and Followers</strong> category.</li>
            <li>Download, extract, and upload the <strong>friends.json</strong> file below.</li>
            <li className="text-xs text-on-surface-variant/70 mt-1">Note: Facebook only exports friend names and connection dates — no emails or phone numbers.</li>
          </ol>
        )}
      </div>

      <div 
        className="bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-surface-container-high transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept={getAcceptedFormats()} 
          onChange={handleFileChange}
        />
        
        {isUploading ? (
          <div className="animate-pulse flex flex-col items-center">
            <UploadCloud className="w-10 h-10 text-primary mb-4" />
            <p className="font-bold text-on-surface">Processing file...</p>
          </div>
        ) : successCount !== null ? (
          <div className="flex flex-col items-center text-green-500">
            <CheckCircle2 className="w-10 h-10 mb-4" />
            <p className="font-bold">Successfully imported {successCount} contacts!</p>
          </div>
        ) : (
          <>
            <div className="bg-surface-container-high p-4 rounded-full mb-4">
              <UploadCloud className="w-8 h-8 text-primary" />
            </div>
            <p className="font-bold text-on-surface mb-1">Click to upload or drag and drop</p>
            <p className="text-xs text-on-surface-variant">
              {getFormatLabel()} files only
            </p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-500/10 text-red-500 rounded-xl flex items-center gap-3 text-sm font-medium">
          <AlertCircle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}
    </Modal>
  );
};
