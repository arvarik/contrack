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
  const [hasContent, setHasContent] = useState(false);
  const parsedDate = chrono.parseDate(followUpText);

  const handleSave = async (htmlContent: string) => {
    const isEditorEmpty = !htmlContent.trim() || htmlContent === '<p></p>';
    if (isEditorEmpty && !followUpText.trim()) return;

    try {
      const payload: any = {
        type,
        title: type === 'note' ? (isEditorEmpty ? 'Action Scheduled' : 'Quick Note') : `Logged ${type}`,
        content: isEditorEmpty ? null : htmlContent,
        date: new Date().toISOString()
      };

      if (parsedDate) {
        const chronoResult = chrono.parse(followUpText)[0];
        let actionItemTitle = "Follow up";
        
        if (chronoResult && chronoResult.text) {
          let titleText = followUpText.replace(chronoResult.text, '').trim();
          
          let previous;
          do {
            previous = titleText;
            titleText = titleText.replace(/^(on|at|by|in|for|with|the|to)\s+/i, '').trim();
            titleText = titleText.replace(/\s+(on|at|by|in|for|with|the|to)$/i, '').trim();
          } while (titleText !== previous);
          
          if (titleText.length > 0) {
            // Capitalize first letter
            actionItemTitle = titleText.charAt(0).toUpperCase() + titleText.slice(1);
          }
        }
        
        payload.actionItem = {
          title: actionItemTitle,
          dueAt: parsedDate.toISOString()
        };
      }

      await addInteraction.mutateAsync({
        contactId,
        data: payload
      });

      if (parsedDate) {
        toast.success("Follow-up scheduled!");
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
        placeholder: 'Write a quick note...',
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
    onUpdate: ({ editor }) => {
      setHasContent(!editor.isEmpty);
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[80px] text-on-surface break-words prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1',
      }
    }
  });

  // Reconfigure placeholder when type shifts
  React.useEffect(() => {
    if (editor) {
      const ph = {
        note: 'Write a quick note...',
        call: 'Summarize the call...',
        meeting: 'Capture meeting highlights...',
        email: 'Log an email interaction...'
      }[type];
      editor.extensionManager.extensions.find(e => e.name === 'placeholder')!.options.placeholder = ph;
      editor.view.dispatch(editor.state.tr);
    }
  }, [type, editor]);

  return (
    <div className={cn(COMPOSER, "p-0 overflow-hidden flex flex-col border border-surface-container-highest/20")}>
      {/* Editor area */}
      <div className="p-5 flex-1 relative">
        <EditorContent editor={editor} className="w-full custom-tiptap" />
        
        {/* Next action field smoothly integrated into the editor card */}
        <div className="mt-4 group flex items-center relative">
          <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-surface-container to-transparent -top-3 opacity-50" />
          <div className="flex flex-1 items-center px-3 py-2.5 bg-surface-container-lowest border border-surface-container rounded-xl shadow-sm hover:border-primary/30 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
            <CalendarClock className="w-4 h-4 text-primary/80 mr-2.5 shrink-0" />
            <input 
              value={followUpText}
              onChange={(e) => setFollowUpText(e.target.value)}
              placeholder="Next Action (e.g. Follow up next Tuesday at 2pm)..." 
              className="flex-1 bg-transparent border-none text-xs font-semibold text-on-surface focus:ring-0 p-0 focus:outline-none placeholder:text-on-surface-variant/40" 
            />
            {parsedDate && (
               <span className={cn(TAG_PILL, "ml-2 shrink-0 shadow-sm")}>
                 {format(parsedDate, "MMM d, h:mm a")}
               </span>
            )}
          </div>
        </div>
      </div>
      
      {/* Action Bar */}
      <div className="bg-surface-container-low/40 px-5 py-3 border-t border-surface-container flex items-center justify-between">
        <div className="flex gap-1.5 bg-surface-container-lowest p-1 rounded-xl shadow-sm border border-surface-container/30">
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
              setHasContent(false);
            }
          }}
          disabled={(!hasContent && !followUpText.trim()) || addInteraction.isPending}
          className="bg-primary text-on-primary hover:bg-primary/90 font-bold rounded-full px-7 py-2.5 shadow-sm text-sm transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </div>
    </div>
  );
};
