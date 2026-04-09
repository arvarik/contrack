import { useState, useRef } from 'react';
import { Modal } from './ui/Modal';
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import Papa from 'papaparse';
import { parseVCard, parseLinkedInCSV, parseGoogleCSV, parseFacebookJSON, parseGenericCSV } from '../lib/importers';
import { useQueryClient } from '@tanstack/react-query';
import { Contact } from '../types';
import { TAB_CONTAINER, tabItem, SECTION_BG } from '../lib/styles';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportTab = 'apple' | 'linkedin' | 'facebook' | 'google';

interface ImportProgress {
  processed: number;
  total: number;
  phase: string;
}

/**
 * Bulk-create contacts via SSE for progress tracking.
 * Falls back to standard JSON POST for small batches (< 20 contacts).
 */
async function bulkImportWithProgress(
  contacts: Partial<Contact>[],
  onProgress: (p: ImportProgress) => void,
): Promise<number> {
  const useStream = contacts.length >= 20;

  const res = await fetch('/api/contacts/bulk', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(useStream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify(contacts),
  });

  if (!res.ok) throw new Error('Failed to import contacts');

  if (useStream && res.body) {
    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) {
              finalCount = data.count;
            } else {
              onProgress(data);
            }
          } catch {}
        }
      }
    }
    return finalCount;
  } else {
    // Standard JSON response
    const data = await res.json();
    return data.count;
  }
}

export const ImportModal = ({ isOpen, onClose, onSuccess }: ImportModalProps) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('apple');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccessCount(null);
    setProgress(null);

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

      // Set initial progress
      setProgress({ processed: 0, total: newContacts.length, phase: 'Parsing file' });

      const count = await bulkImportWithProgress(newContacts, setProgress);
      setSuccessCount(count);
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ['contacts'] });

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

  const progressPct = progress
    ? Math.round((progress.processed / Math.max(progress.total, 1)) * 100)
    : 0;

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
        className={cn(
          "bg-surface-container-low rounded-2xl p-8 flex flex-col items-center justify-center text-center transition-colors",
          !isUploading && successCount === null && "hover:bg-surface-container-high cursor-pointer"
        )}
        onClick={() => !isUploading && successCount === null && fileInputRef.current?.click()}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept={getAcceptedFormats()} 
          onChange={handleFileChange}
        />
        
        {isUploading && progress ? (
          /* ── Progress state ─────────────────────────────────────────── */
          <div className="w-full max-w-xs flex flex-col items-center gap-4">
            <div className="relative">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <div className="w-full space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-on-surface-variant">{progress.phase}</span>
                <span className="text-primary tabular-nums">{progress.processed}/{progress.total}</span>
              </div>
              {/* Progress bar — matches dedupe scan pattern */}
              <div className="h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary-dim to-primary-container rounded-full"
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                />
              </div>
              <p className="text-[11px] text-on-surface-variant">
                {progressPct}% complete
              </p>
            </div>
          </div>
        ) : isUploading ? (
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
