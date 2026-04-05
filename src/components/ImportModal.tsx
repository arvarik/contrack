import { useState, useRef } from 'react';
import { Modal } from './ui/Modal';
import { UploadCloud, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import Papa from 'papaparse';
import { parseVCard, parseLinkedInCSV, parseGoogleCSV, parseFacebookJSON, parseGenericCSV } from '../lib/importers';
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

// Parsers extracted to src/lib/importers.ts

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
