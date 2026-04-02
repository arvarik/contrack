import React, { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import { LinkPreviewExtension } from './LinkPreviewExtension';
import { useAddInteraction, useUpdateContact, useContacts } from '../api';
import { getMentionSuggestion } from './MentionSuggestion';
import { FileText, Phone, Handshake, Mail, CalendarClock } from 'lucide-react';
import * as chrono from 'chrono-node';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { COMPOSER, NLP_INPUT_ROW, TAG_PILL, iconToggle } from '../lib/styles';
import { cn } from '../lib/utils';

export const RichInteractionComposer = ({ contactId }: { contactId: string }) => {
  const [type, setType] = useState<'note' | 'call' | 'meeting' | 'email'>('note');
  const { data: allContacts = [] } = useContacts();
  const addInteraction = useAddInteraction();
  const updateContact = useUpdateContact();
  const [followUpText, setFollowUpText] = useState('');
  const parsedDate = chrono.parseDate(followUpText);

  const handleSave = async (htmlContent: string) => {
    if (!htmlContent.trim() || htmlContent === '<p></p>') return;

    try {
      await addInteraction.mutateAsync({
        contactId,
        data: {
          type,
          title: type === 'note' ? 'Quick Note' : `Logged ${type}`,
          content: htmlContent,
          date: new Date().toISOString()
        }
      });

      if (parsedDate) {
        await updateContact.mutateAsync({
          id: contactId,
          data: { nextFollowUpAt: parsedDate.toISOString() }
        });
        toast.success("Follow-up logic scheduled!");
      }
      
      setFollowUpText('');
    } catch (err: any) {
       toast.error("Failed to log interaction");
    }
  };

  const SubmitExtension = Extension.create({
    name: 'submitShortcut',
    addKeyboardShortcuts() {
      return {
        'Mod-Enter': ({ editor }) => {
          handleSave(editor.getHTML());
          editor.commands.clearContent();
          return true; // prevent default behavior
        }
      };
    }
  });

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Write your notes or slash commands here... (Cmd+Enter to save)',
        showOnlyWhenEditable: false,
      }),
      SubmitExtension,
      Mention.configure({
        HTMLAttributes: {
          class: 'bg-primary/10 text-primary font-bold px-1 py-0.5 rounded-md cursor-pointer',
        },
        suggestion: getMentionSuggestion(allContacts),
      }),
      LinkPreviewExtension,
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[40px] text-on-surface break-words prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1',
      }
    }
  });

  // Reconfigure placeholder when type shifts
  React.useEffect(() => {
    if (editor) {
      editor.extensionManager.extensions.find(e => e.name === 'placeholder')!.options.placeholder = `Log a ${type}... (Cmd+Enter to save, Markdown supported)`;
      editor.view.dispatch(editor.state.tr);
    }
  }, [type, editor]);

  return (
    <div className={COMPOSER}>
      <div className="w-full bg-transparent overflow-hidden">
        <EditorContent editor={editor} className="w-full custom-tiptap" />
      </div>
      
      {/* NLP Action Input */}
      <div className={NLP_INPUT_ROW}>
        <CalendarClock className="w-3.5 h-3.5 text-primary ml-1 mr-2 opacity-80" />
        <input 
          value={followUpText}
          onChange={(e) => setFollowUpText(e.target.value)}
          placeholder="Next Action (e.g., Coffee next Tuesday at 3pm)..." 
          className="flex-1 bg-transparent border-none text-xs font-semibold text-on-surface focus:ring-0 p-0 focus:outline-none placeholder:text-on-surface-variant/60" 
        />
        {parsedDate && (
           <span className={cn(TAG_PILL, "ml-2 shadow-sm animate-in fade-in zoom-in duration-200")}>
             {format(parsedDate, "MMM d, h:mm a")}
           </span>
        )}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 relative">
        <div className="flex gap-2">
          <button onClick={() => setType('note')} className={iconToggle(type === 'note')} title="Note"><FileText className="w-4 h-4" /></button>
          <button onClick={() => setType('call')} className={iconToggle(type === 'call')} title="Call"><Phone className="w-4 h-4" /></button>
          <button onClick={() => setType('meeting')} className={iconToggle(type === 'meeting')} title="Meeting"><Handshake className="w-4 h-4" /></button>
          <button onClick={() => setType('email')} className={iconToggle(type === 'email')} title="Email"><Mail className="w-4 h-4" /></button>
        </div>
        <button 
          onClick={() => {
            if (editor) {
              handleSave(editor.getHTML());
              editor.commands.clearContent();
            }
          }}
          disabled={!editor || editor.isEmpty || addInteraction.isPending}
          className="px-6 py-2 bg-primary text-on-primary font-bold text-sm rounded-full hover:shadow-md hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
        >
          Save
        </button>
      </div>
    </div>
  );
};
