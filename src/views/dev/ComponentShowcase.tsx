/**
 * ComponentShowcase — Dev-only design system reference page.
 *
 * Available at `/dev` in development mode. Renders all design system tokens,
 * components, and patterns in a single scrollable page so engineers can
 * visually verify consistency without navigating the full app.
 *
 * NOT included in production builds — guarded by `import.meta.env.DEV`.
 */
import React, { useState } from 'react';
import {
  LABEL, LABEL_PRIMARY, SECTION_HEADING, SECTION_HEADING_SPACED,
  PAGE_TITLE, CARD, CARD_COMPACT, CARD_TINTED, SECTION_BG,
  ICON_BTN, ICON_BTN_ACTIVE, ICON_BTN_INACTIVE,
  TAG_PILL, MICRO_BADGE, STATUS_BADGE_SUCCESS, SOURCE_BADGE,
  SEARCH_INPUT, EDITABLE_INPUT, KBD, KBD_SM,
  TAB_CONTAINER, tabItem, filterPill,
  TIMELINE_CARD, COMPOSER, EMPTY_STATE,
  DROPDOWN_MENU, DROPDOWN_ITEM,
  FORM_LABEL, FORM_INPUT, formInputHighlight,
  TEXT_LINK, DANGER_BTN,
} from '../../lib/styles';
import { cn } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import {
  Star, Heart, Search, Settings, Plus, Trash2, Edit2,
  Mail, Phone, MapPin, Sparkles, Users, ArrowRight,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// Color Swatch
// ═══════════════════════════════════════════════════════════════════════════

const ColorSwatch = ({ name, variable }: { name: string; variable: string }) => (
  <div className="flex flex-col items-center gap-2">
    <div
      className="w-16 h-16 rounded-xl shadow-sm ring-1 ring-black/5"
      style={{ backgroundColor: `var(${variable})` }}
    />
    <span className="text-[10px] font-bold text-on-surface-variant text-center leading-tight">{name}</span>
    <span className="text-[9px] font-mono text-on-surface-variant/50">{variable}</span>
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// Section Wrapper
// ═══════════════════════════════════════════════════════════════════════════

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-4">
    <h2 className="text-lg font-headline font-bold text-on-surface flex items-center gap-2">
      <div className="w-1.5 h-6 bg-primary rounded-full" />
      {title}
    </h2>
    <div className={cn(CARD, "space-y-6")}>{children}</div>
  </section>
);

// ═══════════════════════════════════════════════════════════════════════════
// Component Showcase
// ═══════════════════════════════════════════════════════════════════════════

export const ComponentShowcase = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [headlessModalOpen, setHeadlessModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('first');
  const [activeFilter, setActiveFilter] = useState('all');

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="max-w-4xl mx-auto p-8 space-y-10">
        {/* Header */}
        <div>
          <h1 className={cn(PAGE_TITLE, "mb-2")}>🎨 Design System Showcase</h1>
          <p className="text-sm text-on-surface-variant">
            Living reference for all tokens, patterns, and components. Dev-only — not included in production builds.
          </p>
        </div>

        {/* ── Typography ────────────────────────────────────── */}
        <Section title="Typography">
          <div className="space-y-4">
            <div>
              <span className={LABEL}>LABEL token</span>
              <span className="ml-4 text-[10px] font-mono text-on-surface-variant/50">LABEL</span>
            </div>
            <div>
              <span className={LABEL_PRIMARY}>LABEL_PRIMARY token</span>
              <span className="ml-4 text-[10px] font-mono text-on-surface-variant/50">LABEL_PRIMARY</span>
            </div>
            <div>
              <span className={SECTION_HEADING}>SECTION_HEADING token</span>
              <span className="ml-4 text-[10px] font-mono text-on-surface-variant/50">SECTION_HEADING</span>
            </div>
            <div>
              <h3 className={SECTION_HEADING_SPACED}><Sparkles className="w-4 h-4" /> Section Heading Spaced</h3>
              <span className="text-[10px] font-mono text-on-surface-variant/50">SECTION_HEADING_SPACED</span>
            </div>
            <div>
              <h1 className={PAGE_TITLE}>Page Title</h1>
              <span className="text-[10px] font-mono text-on-surface-variant/50">PAGE_TITLE (font-headline = Manrope)</span>
            </div>
            <div className="pt-3">
              <p className="text-sm text-on-surface font-medium leading-relaxed">
                Body text uses <strong>Inter</strong> at <code className={KBD}>font-body</code> weight medium.
                This paragraph demonstrates the default reading style for all content areas.
              </p>
            </div>
          </div>
        </Section>

        {/* ── Colors ────────────────────────────────────────── */}
        <Section title="Color Palette">
          <div>
            <h4 className={cn(LABEL, "mb-4")}>PRIMARY</h4>
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="Primary" variable="--color-primary" />
              <ColorSwatch name="Primary Dim" variable="--color-primary-dim" />
              <ColorSwatch name="Primary Container" variable="--color-primary-container" />
              <ColorSwatch name="On Primary" variable="--color-on-primary" />
            </div>
          </div>
          <div>
            <h4 className={cn(LABEL, "mb-4")}>SURFACE HIERARCHY</h4>
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="Surface" variable="--color-surface" />
              <ColorSwatch name="Container Lowest" variable="--color-surface-container-lowest" />
              <ColorSwatch name="Container Low" variable="--color-surface-container-low" />
              <ColorSwatch name="Container" variable="--color-surface-container" />
              <ColorSwatch name="Container High" variable="--color-surface-container-high" />
              <ColorSwatch name="Container Highest" variable="--color-surface-container-highest" />
            </div>
          </div>
          <div>
            <h4 className={cn(LABEL, "mb-4")}>TEXT</h4>
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="On Surface" variable="--color-on-surface" />
              <ColorSwatch name="On Surface Variant" variable="--color-on-surface-variant" />
              <ColorSwatch name="Secondary" variable="--color-secondary" />
            </div>
          </div>
        </Section>

        {/* ── Cards ─────────────────────────────────────────── */}
        <Section title="Cards">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={CARD}>
              <span className={LABEL}>CARD</span>
              <p className="text-sm text-on-surface mt-2">Standard card — white bg, rounded-2xl, shadow-sm</p>
            </div>
            <div className={CARD_COMPACT}>
              <span className={LABEL}>CARD_COMPACT</span>
              <p className="text-sm text-on-surface mt-2">Compact card — tighter padding (p-5)</p>
            </div>
            <div className={CARD_TINTED}>
              <span className={LABEL_PRIMARY}>CARD_TINTED</span>
              <p className="text-sm text-primary mt-2">AI-tinted card — bg-primary/5</p>
            </div>
          </div>
          <div className="glass-panel rounded-2xl p-6 shadow-xl">
            <span className={LABEL}>glass-panel (CSS class)</span>
            <p className="text-sm text-on-surface mt-2">Glassmorphism — backdrop-blur, used for modals and overlays</p>
          </div>
          <div className={TIMELINE_CARD}>
            <span className={LABEL}>TIMELINE_CARD</span>
            <p className="text-sm text-on-surface mt-2">Timeline entry — hover:shadow-md transition</p>
          </div>
        </Section>

        {/* ── Buttons ───────────────────────────────────────── */}
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn-primary">Primary CTA</button>
            <button className="btn-primary text-sm px-4 py-2">Primary Small</button>
            <button className="btn-secondary">Secondary</button>
            <button className={cn("btn-primary opacity-50 cursor-not-allowed")} disabled>Disabled</button>
          </div>
          <div>
            <h4 className={cn(LABEL, "mb-3")}>ICON BUTTONS</h4>
            <div className="flex items-center gap-2">
              <button className={ICON_BTN} aria-label="Example icon button"><Star className="w-5 h-5" /></button>
              <button className={ICON_BTN} aria-label="Example icon button"><Heart className="w-5 h-5" /></button>
              <button className={ICON_BTN} aria-label="Example icon button"><Search className="w-5 h-5" /></button>
              <button className={ICON_BTN} aria-label="Example icon button"><Settings className="w-5 h-5" /></button>
              <div className="w-px h-6 bg-surface-container-high mx-1" />
              <button className={ICON_BTN_ACTIVE} aria-label="Active icon button"><Plus className="w-5 h-5" /></button>
              <button className={ICON_BTN_INACTIVE} aria-label="Inactive icon button"><Trash2 className="w-5 h-5" /></button>
            </div>
          </div>
          <div>
            <h4 className={cn(LABEL, "mb-3")}>SPECIAL BUTTONS</h4>
            <div className="space-y-2">
              <a className={TEXT_LINK} href="#" onClick={e => e.preventDefault()}>Text Link Style</a>
              <div><button className={DANGER_BTN}><Trash2 className="w-3.5 h-3.5" /> Delete Permanently</button></div>
            </div>
          </div>
        </Section>

        {/* ── Badges & Pills ───────────────────────────────── */}
        <Section title="Badges & Pills">
          <div className="flex flex-wrap items-center gap-3">
            <span className={TAG_PILL}>TAG_PILL</span>
            <span className={MICRO_BADGE}>MICRO_BADGE</span>
            <span className={STATUS_BADGE_SUCCESS}>Current</span>
            <span className={SOURCE_BADGE}>linkedin</span>
            <span className={KBD}>⌘ K</span>
            <span className={KBD_SM}>Esc</span>
          </div>
        </Section>

        {/* ── Tabs & Filters ───────────────────────────────── */}
        <Section title="Tabs & Filter Pills">
          <div>
            <h4 className={cn(LABEL, "mb-3")}>TAB BAR</h4>
            <div className={TAB_CONTAINER}>
              {['first', 'second', 'third'].map(tab => (
                <button key={tab} className={tabItem(activeTab === tab)} onClick={() => setActiveTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4 className={cn(LABEL, "mb-3")}>FILTER PILLS</h4>
            <div className="flex gap-1.5">
              {['all', 'friends', 'work', 'vip'].map(f => (
                <button key={f} className={filterPill(activeFilter === f)} onClick={() => setActiveFilter(f)}>
                  <Users className="w-3.5 h-3.5" />
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </Section>

        {/* ── Form Inputs ──────────────────────────────────── */}
        <Section title="Form Inputs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={FORM_LABEL}>Standard Form Input</label>
              <input className={FORM_INPUT} placeholder="Type something..." />
            </div>
            <div>
              <label className={FORM_LABEL}>AI Highlighted Input</label>
              <input className={cn(FORM_INPUT, formInputHighlight(true))} defaultValue="AI pre-filled" />
            </div>
            <div>
              <label className={FORM_LABEL}>Search Input</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input className={SEARCH_INPUT} placeholder="Search... (/)" />
              </div>
            </div>
            <div>
              <label className={FORM_LABEL}>Editable Field</label>
              <input className={EDITABLE_INPUT} defaultValue="Click to edit" />
            </div>
          </div>
          <div>
            <label className={FORM_LABEL}>CSS .input class</label>
            <input className="input" placeholder="Global .input from index.css" />
          </div>
        </Section>

        {/* ── Empty States ─────────────────────────────────── */}
        <Section title="Empty States">
          <div className={EMPTY_STATE}>
            <Sparkles className="w-8 h-8 text-primary mx-auto mb-3" />
            <p className="font-bold text-on-surface mb-1">No Results</p>
            <p className="text-sm">Try adjusting your search or filters.</p>
          </div>
        </Section>

        {/* ── Composer ─────────────────────────────────────── */}
        <Section title="Composer">
          <div className={COMPOSER}>
            <p className="text-sm text-on-surface-variant italic">COMPOSER token — focus-within:ring, shadow-md on focus</p>
          </div>
        </Section>

        {/* ── Dropdown ─────────────────────────────────────── */}
        <Section title="Dropdown">
          <div className="relative inline-block">
            <div className={cn(DROPDOWN_MENU, "relative w-56")} style={{ position: 'relative' }}>
              <div className={DROPDOWN_ITEM}><Mail className="w-4 h-4 mr-2" /> Send Email</div>
              <div className={DROPDOWN_ITEM}><Phone className="w-4 h-4 mr-2" /> Call</div>
              <div className={DROPDOWN_ITEM}><MapPin className="w-4 h-4 mr-2" /> View on Map</div>
            </div>
          </div>
        </Section>

        {/* ── Modals ───────────────────────────────────────── */}
        <Section title="Modal Variants">
          <div className="flex gap-4">
            <button className="btn-primary" onClick={() => setModalOpen(true)}>Standard Modal</button>
            <button className="btn-secondary" onClick={() => setHeadlessModalOpen(true)}>Headless Modal</button>
          </div>
        </Section>

        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Standard Modal">
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant">
              This modal has a built-in header with title and close button.
              Focus is trapped — Tab cycles within the dialog.
            </p>
            <div>
              <label className={FORM_LABEL}>Example Input</label>
              <input className={FORM_INPUT} placeholder="Focus should stay inside..." />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => setModalOpen(false)}>Confirm</button>
            </div>
          </div>
        </Modal>

        <Modal isOpen={headlessModalOpen} onClose={() => setHeadlessModalOpen(false)} size="lg">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold font-headline">Headless Modal</h2>
              <button className={ICON_BTN} onClick={() => setHeadlessModalOpen(false)} aria-label="Close">
                <span className="text-lg">×</span>
              </button>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">
              Headless mode — children fill the entire modal. Consumer provides their own header.
              Demonstrates the <code className={KBD}>size="lg"</code> variant (max-w-2xl).
            </p>
            <button className="btn-primary" onClick={() => setHeadlessModalOpen(false)}>Close</button>
          </div>
        </Modal>

        {/* ── Spacing & Surfaces ───────────────────────────── */}
        <Section title="Surface Hierarchy">
          <p className="text-sm text-on-surface-variant mb-4">
            The paper-stack metaphor — each layer progressively recedes:
          </p>
          <div className="space-y-3">
            {([
              ['--color-surface-container-lowest', 'Card / interactive (white)', 'surface-container-lowest'],
              ['--color-surface-container-low', 'Sectional backgrounds', 'surface-container-low'],
              ['--color-surface-container', 'Inputs, subtle backgrounds', 'surface-container'],
              ['--color-surface-container-high', 'Elevated emphasis areas', 'surface-container-high'],
              ['--color-surface-container-highest', 'Maximum emphasis', 'surface-container-highest'],
              ['--color-surface', 'Base app layer', 'surface'],
            ] as const).map(([cssVar, desc, token]) => (
              <div key={token} className="rounded-xl p-4 flex items-center justify-between" style={{ backgroundColor: `var(${cssVar})` }}>
                <span className="text-sm font-bold text-on-surface">{desc}</span>
                <span className="text-[10px] font-mono text-on-surface-variant">bg-{token}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className={cn(SECTION_BG, "rounded-2xl p-6 text-center")}>
          <p className="text-xs text-on-surface-variant font-bold uppercase tracking-widest">
            Contrack Design System v3 — {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
};
