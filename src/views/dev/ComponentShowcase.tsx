/**
 * ComponentShowcase — Dev-only design system reference page.
 *
 * Available at `/dev` in development mode. Renders the design system's
 * tokens, components and patterns on one scrollable page, so engineers can
 * check them without navigating the full app. It shows the one look from
 * `.agent/STYLE.md`: pressable buttons with an edge, one hover layer, one
 * selected look, one focus ring, the tones, the page header and the
 * highlighter.
 *
 * NOT included in production builds — guarded by `import.meta.env.DEV`.
 */
import React, { useState } from "react";
import {
  BTN_QUIET,
  CARD,
  CARD_INTERACTIVE,
  EDITABLE_INPUT,
  FIELD_LABEL,
  FORM_INPUT,
  FORM_LABEL,
  ICON_BTN,
  KBD,
  KBD_SM,
  LABEL,
  LABEL_PRIMARY,
  MENU_HEADING,
  MENU_HINT,
  MENU_ICON,
  MENU_ITEM,
  MENU_ITEM_DANGER,
  MENU_ITEM_SELECTED,
  MENU_PANEL,
  MENU_SEPARATOR,
  MICRO_BADGE,
  PAGE_TITLE,
  PAGE_TOP,
  PAGE_X,
  SEARCH_INPUT,
  SECTION_BG,
  SECTION_HEADING,
  SECTION_HEADING_SPACED,
  SOURCE_BADGE,
  STATUS_BADGE_SUCCESS,
  TAB_CONTAINER,
  TAG_PILL,
  TEXT_LINK,
  TONE_DOT,
  TONE_TEXT,
  TONE_WASH,
  filterPill,
  formInputHighlight,
  listRow,
  tabItem,
  type Tone,
} from "../../lib/styles";
import { NAMES } from "../../lib/names";
import { cn } from "../../lib/utils";
import { Modal } from "../../components/ui/Modal";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/layout/PageHeader";
import {
  ArrowUpDown,
  Check,
  Heart,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Users,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// Parts
// ═══════════════════════════════════════════════════════════════════════════

/** The name of the token or class a demo shows, in code type. */
const Token = ({ children }: { children: React.ReactNode }) => (
  <code className="text-[11px] font-mono text-on-surface-variant">
    {children}
  </code>
);

const ColorSwatch = ({
  name,
  variable,
}: {
  name: string;
  variable: string;
}) => (
  <div className="flex flex-col items-center gap-2">
    <div
      className="w-16 h-16 rounded-xl shadow-sm ring-1 ring-black/5"
      style={{ backgroundColor: `var(${variable})` }}
    />
    <span className="text-[11px] font-bold text-on-surface-variant text-center leading-tight">
      {name}
    </span>
    <Token>{variable}</Token>
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-4">
    <h2 className="text-lg font-headline font-bold text-on-surface">{title}</h2>
    <div className={cn(CARD, "space-y-6")}>{children}</div>
  </section>
);

/** A group inside a section: a small caps heading over its demos. */
const Group = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <div>
    <h3 className={cn(LABEL, "mb-3")}>{title}</h3>
    {children}
  </div>
);

/** The three calls to action, each shown at both sizes and disabled. */
const BUTTONS = [
  { variant: "btn-primary", label: "Save changes" },
  { variant: "btn-secondary", label: "Cancel" },
  { variant: "btn-danger", label: "Delete forever" },
] as const;

/** The five tones, with what each means on Pulse. */
const TONES: { tone: Tone; means: string }[] = [
  { tone: "error", means: "Overdue" },
  { tone: "primary", means: "Today" },
  { tone: "warning", means: "Birthday" },
  { tone: "success", means: "New people" },
  { tone: "neutral", means: "This week" },
];

const FILTERS = [
  { id: "all", label: "All" },
  { id: "friends", label: "Friends" },
  { id: "work", label: "Work" },
  { id: "vip", label: "VIP" },
];

const PEOPLE = ["Ada Lovelace", "Alan Turing", "Grace Hopper"];

// ═══════════════════════════════════════════════════════════════════════════
// Component Showcase
// ═══════════════════════════════════════════════════════════════════════════

export const ComponentShowcase = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [headlessModalOpen, setHeadlessModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("first");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activePerson, setActivePerson] = useState(PEOPLE[1]);

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div
        className={cn("max-w-4xl mx-auto pb-10 space-y-10", PAGE_X, PAGE_TOP)}
      >
        <PageHeader
          title="🎨 Design system showcase"
          description="Living reference for the tokens, patterns and components. Dev-only, not included in production builds"
        />

        {/* ── Typography ────────────────────────────────────── */}
        <Section title="Typography">
          <div className="space-y-4">
            <div className="flex items-baseline gap-4">
              <span className={LABEL}>Label token</span>
              <Token>LABEL</Token>
            </div>
            <div className="flex items-baseline gap-4">
              <span className={LABEL_PRIMARY}>Label primary token</span>
              <Token>LABEL_PRIMARY</Token>
            </div>
            <div className="flex items-baseline gap-4">
              <span className={SECTION_HEADING}>Section heading token</span>
              <Token>SECTION_HEADING</Token>
            </div>
            <div>
              <p className={SECTION_HEADING_SPACED}>
                <Sparkles className="w-4 h-4" /> Section heading spaced
              </p>
              <Token>SECTION_HEADING_SPACED</Token>
            </div>
            <div className="flex items-baseline gap-4">
              <span className={FIELD_LABEL}>Field label</span>
              <Token>FIELD_LABEL</Token>
            </div>
            <div>
              <p className={PAGE_TITLE}>Page title</p>
              <Token>PAGE_TITLE (font-headline = Manrope)</Token>
            </div>
            <p className="pt-3 text-sm text-on-surface font-medium leading-relaxed">
              Body text uses <strong>Inter</strong> at{" "}
              <code className={KBD}>font-body</code> weight medium. This
              paragraph demonstrates the default reading style for all content
              areas
            </p>
          </div>
        </Section>

        {/* ── Colour ────────────────────────────────────────── */}
        <Section title="Color palette">
          <Group title="Primary">
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="Primary" variable="--color-primary" />
              <ColorSwatch name="Primary dim" variable="--color-primary-dim" />
              <ColorSwatch
                name="Primary container"
                variable="--color-primary-container"
              />
              <ColorSwatch name="On primary" variable="--color-on-primary" />
            </div>
          </Group>
          <Group title="Surface hierarchy">
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="Surface" variable="--color-surface" />
              <ColorSwatch
                name="Container lowest"
                variable="--color-surface-container-lowest"
              />
              <ColorSwatch
                name="Container low"
                variable="--color-surface-container-low"
              />
              <ColorSwatch
                name="Container"
                variable="--color-surface-container"
              />
              <ColorSwatch
                name="Container high"
                variable="--color-surface-container-high"
              />
              <ColorSwatch
                name="Container highest"
                variable="--color-surface-container-highest"
              />
              <ColorSwatch name="Hairline" variable="--color-outline-variant" />
            </div>
          </Group>
          <Group title="Text">
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="On surface" variable="--color-on-surface" />
              <ColorSwatch
                name="On surface variant"
                variable="--color-on-surface-variant"
              />
              <ColorSwatch name="Secondary" variable="--color-secondary" />
            </div>
          </Group>
          <Group title="Meaning">
            <div className="flex flex-wrap gap-4">
              <ColorSwatch name="Success" variable="--color-success" />
              <ColorSwatch name="Warning" variable="--color-warning" />
              <ColorSwatch name="Error" variable="--color-error" />
              <ColorSwatch name="AI" variable="--color-ai" />
              <ColorSwatch name="Highlight" variable="--color-highlight" />
            </div>
          </Group>
        </Section>

        {/* ── Buttons ───────────────────────────────────────── */}
        <Section title="Buttons">
          <p className="text-sm text-on-surface-variant">
            A call to action has an edge under its face. It rises on hover and
            sinks on press, and a disabled one goes flat. The call site adds
            layout only
          </p>
          <div className="space-y-4">
            {BUTTONS.map(({ variant, label }) => (
              <div key={variant} className="flex flex-wrap items-center gap-4">
                <div className="w-28 shrink-0">
                  <Token>{variant}</Token>
                </div>
                <button type="button" className={variant}>
                  {label}
                </button>
                <button type="button" className={cn(variant, "btn-sm")}>
                  {label}
                </button>
                <button type="button" className={variant} disabled>
                  Disabled
                </button>
                <button
                  type="button"
                  className={cn(variant, "btn-sm")}
                  disabled
                >
                  Disabled
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-28 shrink-0">
                <Token>text-error</Token>
              </div>
              {/* A destructive act that can be undone: not the red face. */}
              <button type="button" className="btn-secondary text-error">
                Remove from list
              </button>
            </div>
          </div>
          <Group title="Flat buttons">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={ICON_BTN} aria-label="Star">
                <Star className="w-5 h-5" />
              </button>
              <button type="button" className={ICON_BTN} aria-label="Like">
                <Heart className="w-5 h-5" />
              </button>
              <button type="button" className={ICON_BTN} aria-label="Search">
                <Search className="w-5 h-5" />
              </button>
              <button type="button" className={ICON_BTN} aria-label="Settings">
                <Settings className="w-5 h-5" />
              </button>
              <button type="button" className={BTN_QUIET}>
                Show more
              </button>
              <button
                type="button"
                className={TEXT_LINK}
                onClick={(e) => e.preventDefault()}
              >
                Text link
              </button>
            </div>
          </Group>
        </Section>

        {/* ── Hover and selection ──────────────────────────── */}
        <Section title="Hover and selection">
          <p className="text-sm text-on-surface-variant">
            Three kinds of surface, three hovers. A flat control takes the state
            layer, a card that is a control rises, and a static card has no
            hover. One selected look: the primary tint, on a row, a pill or a
            nav item alike. No ring and no bar down the leading edge
          </p>
          <Group title="Rows: state-layer and SELECTED_ROW">
            <div className="space-y-1 max-w-sm">
              {PEOPLE.map((name) => {
                const selected = name === activePerson;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setActivePerson(name)}
                    aria-pressed={selected}
                    className={cn(listRow(selected), "w-full text-left")}
                  >
                    <Users className="w-4 h-4 text-on-surface-variant shrink-0" />
                    <span className="text-sm font-semibold text-on-surface">
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </Group>
          <Group title="Pills: SELECTED_TINT">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={activeFilter === f.id}
                  className={filterPill(activeFilter === f.id)}
                  onClick={() => setActiveFilter(f.id)}
                >
                  <Users className="w-3.5 h-3.5" />
                  {f.label}
                </button>
              ))}
            </div>
          </Group>
          <Group title="Cards: CARD, CARD_INTERACTIVE and lift">
            {/* On the page's own paper, where a card sits in the app. */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 rounded-2xl bg-surface p-4">
              <div className={CARD}>
                <Token>CARD</Token>
                <p className="text-sm text-on-surface mt-2">
                  A static card. No hover
                </p>
              </div>
              <button
                type="button"
                className={cn(CARD_INTERACTIVE, "text-left")}
              >
                <Token>CARD_INTERACTIVE</Token>
                <p className="text-sm text-on-surface mt-2">
                  A card that is a control. It rises on hover
                </p>
              </button>
              <button
                type="button"
                className="state-layer lift self-start rounded-xl bg-surface-container-low p-4 text-left"
              >
                <Token>lift</Token>
                <p className="text-sm text-on-surface mt-2">
                  A tile that is a control, smaller than a card. It rises 1 px
                </p>
              </button>
              <div className="glass-panel rounded-2xl p-6 shadow-xl">
                <Token>glass-panel</Token>
                <p className="text-sm text-on-surface mt-2">
                  Floating UI only: modals and overlays
                </p>
              </div>
            </div>
          </Group>
        </Section>

        {/* ── Tones ────────────────────────────────────────── */}
        <Section title="Tones">
          <p className="text-sm text-on-surface-variant">
            A colour that means something comes from one map. A group&apos;s
            dot, its rows&apos; glyph and its chips read from the same tone
          </p>
          <div className="space-y-3">
            {TONES.map(({ tone, means }) => (
              <div key={tone} className="flex items-center gap-4">
                <div className="w-20 shrink-0">
                  <Token>{tone}</Token>
                </div>
                <span
                  aria-hidden="true"
                  className={cn("w-1.5 h-1.5 rounded-full", TONE_DOT[tone])}
                />
                <span
                  className={cn(
                    "px-2 py-0.5 rounded-md text-[11px] font-bold",
                    TONE_WASH[tone],
                  )}
                >
                  {means}
                </span>
                <Star className={cn("w-4 h-4", TONE_TEXT[tone])} />
              </div>
            ))}
          </div>
          <Group title="Not a tone: the AI colour">
            <div className="flex items-center gap-3">
              <Sparkles className="w-4 h-4 text-ai" aria-hidden="true" />
              <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-ai/10 text-on-ai-wash">
                Added by enrichment
              </span>
              <span className="text-sm text-on-surface-variant">
                Marks what a model wrote. Never a selection
              </span>
            </div>
          </Group>
        </Section>

        {/* ── Page header ──────────────────────────────────── */}
        <Section title="Page header">
          <PageHeader
            titleAs="h2"
            back={{ to: "/settings", label: NAMES.settings.label }}
            title={NAMES.enrichment.label}
            description={NAMES.enrichment.description}
            actions={
              <button type="button" className="btn-primary btn-sm">
                Run now
              </button>
            }
          />
          <PageHeader
            titleAs="h2"
            title={NAMES.pulse.label}
            suffix="Tuesday, September 22"
          />
          <p className="text-sm text-on-surface-variant">
            Every page&apos;s top is <code className={KBD}>PageHeader</code>. No
            band, no border and no icon tile. The page sets{" "}
            <code className={KBD}>PAGE_X</code> and{" "}
            <code className={KBD}>PAGE_TOP</code>, so every title starts at the
            same height. A <code className={KBD}>suffix</code> continues the
            title line in the variant ink: Pulse&apos;s day
          </p>
        </Section>

        {/* ── Highlight and focus ──────────────────────────── */}
        <Section title="Highlight and focus">
          <Group title="A search match">
            <p className="text-sm text-on-surface">
              Ada met Charles <mark>Babbage</mark> at a party in 1833. A match
              is a plain <code className={KBD}>mark</code>, and the base layer
              paints it
            </p>
          </Group>
          <Group title="One focus ring">
            <p className="text-sm text-on-surface-variant mb-3">
              Tab through these. A control draws 2 px of the primary outside
              itself, and a text field draws it on its own edge. A composite
              field puts <code className={KBD}>focus-frame</code> on the box
            </p>
            <div className="focus-frame flex items-center gap-2 bg-surface-container-low rounded-xl pl-3 pr-1.5 py-1.5 max-w-md">
              <Search
                aria-hidden="true"
                className="w-4 h-4 text-on-surface-variant shrink-0"
              />
              <input
                aria-label="Ask a question"
                placeholder="Ask about your network…"
                className="flex-1 min-w-0 bg-transparent text-sm text-on-surface placeholder:text-on-surface-variant"
              />
              <button type="button" className="btn-primary btn-sm">
                Ask
              </button>
            </div>
          </Group>
        </Section>

        {/* ── Badges and pills ─────────────────────────────── */}
        <Section title="Badges and pills">
          <div className="flex flex-wrap items-center gap-3">
            <span className={TAG_PILL}>Tag pill</span>
            <span className={MICRO_BADGE}>Micro badge</span>
            <span className={STATUS_BADGE_SUCCESS}>Current</span>
            <span className={SOURCE_BADGE}>via LinkedIn</span>
            <span className={KBD}>⌘ K</span>
            <span className={KBD_SM}>Esc</span>
          </div>
        </Section>

        {/* ── Tabs ─────────────────────────────────────────── */}
        <Section title="Tabs">
          <div className={TAB_CONTAINER}>
            {["first", "second", "third"].map((tab) => (
              <button
                key={tab}
                type="button"
                className={tabItem(activeTab === tab)}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </Section>

        {/* ── Form inputs ──────────────────────────────────── */}
        <Section title="Form inputs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="demo-standard-input" className={FORM_LABEL}>
                Standard form input
              </label>
              <input
                id="demo-standard-input"
                className={FORM_INPUT}
                placeholder="Type something..."
              />
            </div>
            <div>
              <label htmlFor="demo-ai-input" className={FORM_LABEL}>
                AI-filled input
              </label>
              <input
                id="demo-ai-input"
                className={cn(FORM_INPUT, formInputHighlight(true))}
                defaultValue="AI pre-filled"
              />
            </div>
            <div>
              <label htmlFor="demo-search" className={FORM_LABEL}>
                Search input
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input
                  id="demo-search"
                  className={SEARCH_INPUT}
                  placeholder="Search... (/)"
                />
              </div>
            </div>
            <div>
              <label htmlFor="demo-editable" className={FORM_LABEL}>
                Editable field
              </label>
              <input
                id="demo-editable"
                className={EDITABLE_INPUT}
                defaultValue="Click to edit"
              />
            </div>
          </div>
          <div>
            <label htmlFor="demo-css-input" className={FORM_LABEL}>
              CSS .input class
            </label>
            <input
              id="demo-css-input"
              className="input"
              placeholder="Global .input from index.css"
            />
          </div>
        </Section>

        {/* ── Empty state ──────────────────────────────────── */}
        <Section title="Empty state">
          <EmptyState
            level={3}
            icon={Search}
            title="No results"
            body="Try another word, or clear the filters"
          />
        </Section>

        {/* ── Menu ─────────────────────────────────────────── */}
        <Section title="Menu">
          <div className={cn(MENU_PANEL, "w-60")}>
            <p className={MENU_HEADING}>Sort by</p>
            <button type="button" className={cn(MENU_ITEM, MENU_ITEM_SELECTED)}>
              <Check className={cn(MENU_ICON, "text-on-primary-wash")} />
              Name
            </button>
            <button type="button" className={MENU_ITEM}>
              <ArrowUpDown className={MENU_ICON} />
              Last contact
              <span className={MENU_HINT}>L</span>
            </button>
            <div role="none" className={MENU_SEPARATOR} />
            <button type="button" className={cn(MENU_ITEM, MENU_ITEM_DANGER)}>
              <Trash2 className={cn(MENU_ICON, "text-error")} />
              Delete contact
            </button>
          </div>
        </Section>

        {/* ── Modals ───────────────────────────────────────── */}
        <Section title="Modal variants">
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setModalOpen(true)}
            >
              Standard modal
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setHeadlessModalOpen(true)}
            >
              Headless modal
            </button>
          </div>
        </Section>

        <Modal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Standard modal"
        >
          <div className="space-y-4">
            <p className="text-sm text-on-surface-variant">
              This modal has a built-in header with title and close button.
              Focus is trapped — Tab cycles within the dialog
            </p>
            <div>
              <label htmlFor="demo-focus" className={FORM_LABEL}>
                Example input
              </label>
              <input
                id="demo-focus"
                className={FORM_INPUT}
                placeholder="Focus should stay inside..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setModalOpen(false)}
              >
                Confirm
              </button>
            </div>
          </div>
        </Modal>

        <Modal
          isOpen={headlessModalOpen}
          onClose={() => setHeadlessModalOpen(false)}
          size="lg"
          ariaLabel="Headless modal"
        >
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold font-headline">
                Headless modal
              </h2>
              <button
                type="button"
                className={ICON_BTN}
                onClick={() => setHeadlessModalOpen(false)}
                aria-label="Close"
              >
                <span className="text-lg">×</span>
              </button>
            </div>
            <p className="text-sm text-on-surface-variant mb-4">
              Headless mode — children fill the entire modal. Consumer provides
              their own header. Demonstrates the{" "}
              <code className={KBD}>size="lg"</code> variant (max-w-2xl)
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setHeadlessModalOpen(false)}
            >
              Close
            </button>
          </div>
        </Modal>

        {/* ── Surfaces ─────────────────────────────────────── */}
        <Section title="Surface hierarchy">
          <p className="text-sm text-on-surface-variant mb-4">
            The paper-stack metaphor — each layer progressively recedes:
          </p>
          <div className="space-y-3">
            {(
              [
                [
                  "--color-surface-container-lowest",
                  "Card / interactive (white)",
                  "surface-container-lowest",
                ],
                [
                  "--color-surface-container-low",
                  "Sectional backgrounds",
                  "surface-container-low",
                ],
                [
                  "--color-surface-container",
                  "Inputs, subtle backgrounds",
                  "surface-container",
                ],
                [
                  "--color-surface-container-high",
                  "Elevated emphasis areas",
                  "surface-container-high",
                ],
                [
                  "--color-surface-container-highest",
                  "Maximum emphasis",
                  "surface-container-highest",
                ],
                ["--color-surface", "Base app layer", "surface"],
              ] as const
            ).map(([cssVar, desc, token]) => (
              <div
                key={token}
                className="rounded-xl p-4 flex items-center justify-between"
                style={{ backgroundColor: `var(${cssVar})` }}
              >
                <span className="text-sm font-bold text-on-surface">
                  {desc}
                </span>
                <Token>bg-{token}</Token>
              </div>
            ))}
          </div>
        </Section>

        {/* Footer */}
        <div className={cn(SECTION_BG, "rounded-2xl p-6 text-center")}>
          <p className={LABEL}>
            Contrack design system v3 — {new Date().toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
};
