import { useState, useRef } from 'react';
import { Modal } from './Modal';
import { UploadCloud, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { api } from '../api';
import { Contact } from '../types';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImportModal = ({ isOpen, onClose, onSuccess }: ImportModalProps) => {
  const [activeTab, setActiveTab] = useState<'apple' | 'linkedin' | 'facebook'>('apple');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        newContacts = parseVCard(text, 'Apple Contacts');
      } else if (file.name.endsWith('.csv')) {
        newContacts = await parseCSV(text, activeTab === 'linkedin' ? 'LinkedIn' : 'Facebook');
      } else {
        throw new Error('Unsupported file format. Please upload a .vcf or .csv file.');
      }

      if (newContacts.length === 0) {
        throw new Error('No valid contacts found in the file.');
      }

      const result = await api.contacts.bulkCreate(newContacts);
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

  const parseVCard = (vcardData: string, sourceName: string): Partial<Contact>[] => {
    const contacts: Partial<Contact>[] = [];
    const cards = vcardData.split(/BEGIN:VCARD/i);
    
    for (const card of cards) {
      if (!card.trim()) continue;
      
      const nameMatch = card.match(/^FN:(.*)$/m);
      if (!nameMatch) continue;

      const emailMatch = card.match(/^EMAIL.*:(.*)$/m);
      const orgMatch = card.match(/^ORG:(.*)$/m);
      const titleMatch = card.match(/^TITLE:(.*)$/m);
      const phoneMatch = card.match(/^TEL.*:(.*)$/m);

      contacts.push({
        name: nameMatch[1].trim(),
        email: emailMatch ? emailMatch[1].trim() : '',
        company: orgMatch ? orgMatch[1].split(';')[0].trim() : '',
        role: titleMatch ? titleMatch[1].trim() : '',
        phone: phoneMatch ? phoneMatch[1].trim() : '',
        sources: [sourceName] as any
      });
    }
    return contacts;
  };

  const parseCSV = (csvData: string, sourceName: string): Promise<Partial<Contact>[]> => {
    return new Promise((resolve, reject) => {
      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            const parsed = results.data.map((row: any) => {
              if (sourceName === 'LinkedIn' && row['First Name'] !== undefined) {
                return {
                  name: `${row['First Name']} ${row['Last Name']}`.trim(),
                  email: row['Email Address'] || '',
                  company: row['Company'] || '',
                  role: row['Position'] || '',
                  sources: [sourceName] as any
                };
              }
              
              const name = row['Name'] || row['name'] || row['Full Name'];
              return {
                name: name || 'Unknown',
                email: row['Email'] || row['email'] || row['Email Address'] || '',
                company: row['Company'] || row['company'] || '',
                role: row['Role'] || row['Title'] || row['Position'] || '',
                phone: row['Phone'] || row['phone'] || row['Phone Number'] || '',
                sources: [sourceName] as any
              };
            }).filter(c => c.name && c.name !== 'Unknown');
            
            resolve(parsed);
          } catch (e) {
            reject(new Error('Failed to parse CSV structure.'));
          }
        },
        error: () => reject(new Error('Failed to read CSV file.'))
      });
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Contacts">
      <div className="mb-6 flex gap-2 border-b border-surface-container-highest pb-2">
        {(['apple', 'linkedin', 'facebook'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors ${activeTab === tab ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-surface-container-low p-6 rounded-xl mb-6 text-sm text-on-surface-variant">
        <h4 className="font-bold text-on-surface mb-2 flex items-center gap-2">
          <FileText className="w-4 h-4" />
          How to export from {activeTab === 'apple' ? 'Apple Contacts' : activeTab === 'linkedin' ? 'LinkedIn' : 'Facebook'}
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
          </ol>
        )}
        {activeTab === 'facebook' && (
          <ol className="list-decimal list-inside space-y-1 ml-1">
            <li>Go to Facebook <strong>Settings & Privacy</strong>.</li>
            <li>Select <strong>Download your information</strong>.</li>
            <li>Choose format as <strong>CSV</strong> and select <strong>Friends and followers</strong> (or similar contact info).</li>
            <li>Download, extract, and upload the relevant <strong>.csv</strong> file below.</li>
          </ol>
        )}
      </div>

      <div 
        className="border-2 border-dashed border-surface-container-highest rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-surface-container-low transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept={activeTab === 'apple' ? '.vcf' : '.csv'} 
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
              {activeTab === 'apple' ? 'vCard (.vcf)' : 'CSV (.csv)'} files only
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
