import React, { useState, useEffect } from 'react';
import { MoreVertical, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { DROPDOWN_MENU, DROPDOWN_ITEM } from '../../lib/styles';

export const ContactActionsMenu = ({ contact, onDelete }: { contact: any, onDelete: () => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const copyBasic = () => {
    const textChunks = [
      `Name: ${contact.name}`
    ];
    if (contact.emails?.length) textChunks.push(`Email: ${contact.emails.map((e: any) => e.email).join(', ')}`);
    if (contact.phones?.length) textChunks.push(`Phone: ${contact.phones.map((p: any) => p.phone).join(', ')}`);

    navigator.clipboard.writeText(textChunks.join('\n'));
    toast.success('Basic details copied');
    setIsOpen(false);
  };

  const copyAdvanced = () => {
    const textChunks = [
      `Name: ${contact.name}`
    ];
    if (contact.role) textChunks.push(`Role: ${contact.role}`);
    if (contact.company) textChunks.push(`Company: ${contact.company}`);
    if (contact.emails?.length) textChunks.push(`Email: ${contact.emails.map((e: any) => e.email).join(', ')}`);
    if (contact.phones?.length) textChunks.push(`Phone: ${contact.phones.map((p: any) => p.phone).join(', ')}`);
    if (contact.birthday) textChunks.push(`Birthday: ${contact.birthday}`);
    if (contact.addresses?.length) {
      textChunks.push(`Location: ${contact.addresses.map((a: any) => a.address).join(' | ')}`);
    } else if (contact.location) {
      textChunks.push(`Location: ${contact.location}`);
    }

    navigator.clipboard.writeText(textChunks.join('\n'));
    toast.success('All details copied');
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block ml-1" ref={containerRef}>
      <button onClick={() => setIsOpen(!isOpen)} className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-all flex items-center justify-center">
        <MoreVertical className="w-5 h-5" />
      </button>
      {isOpen && (
        <ul className={cn(DROPDOWN_MENU, "right-0 w-56 mt-2 z-50")}>
          <li className={DROPDOWN_ITEM} onClick={copyBasic}>
            <Copy className="w-4 h-4 mr-2 opacity-50" />
            Copy Basic Details
          </li>
          <li className={DROPDOWN_ITEM} onClick={copyAdvanced}>
            <Copy className="w-4 h-4 mr-2 opacity-50" />
            Copy Full Details
          </li>
          <div className="h-px bg-white/10 my-1 mx-2" />
          <li className={cn(DROPDOWN_ITEM, "text-red-400 hover:text-red-300 hover:bg-red-500/10")} onClick={() => { setIsOpen(false); onDelete(); }}>
            <Trash2 className="w-4 h-4 mr-2 opacity-50" />
            Delete Contact
          </li>
        </ul>
      )}
    </div>
  );
};
