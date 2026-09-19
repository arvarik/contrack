/**
 * ProfileHeader: who this contact is, and the one thing to do next.
 *
 * Wide (the contact pane is 768 px or more):
 *
 * ```
 * (avatar 96) Thomas Walker (they/them)          [ Log interaction ] ⋮
 *             UX Researcher at Umbrella Corp
 *             Sydney · 2:45 AM · 13°C · in ThomasWalker ↗ · @Thomas_Walker ↗
 *             [tech-lead ×] [advisor ×] [+ tag]
 * ```
 *
 * Narrow (a phone, or a pane too slim for two columns):
 *
 * ```
 * ← Network
 * (avatar 56) Thomas Walker                                  ⋮
 *             UX Researcher · Umbrella Corp
 *             Sydney · 2:45 AM · in ThomasWalker ↗
 * ```
 *
 * 1. The name is the page's h1 and takes focus when a contact opens.
 * 2. The ring around the avatar is the relationship score (ScoreRingAvatar).
 *    The contact's own colour is the page accent, not the ring.
 * 3. The meta line is text. Facts (place, local time, weather) are plain,
 *    and links look like links, with ↗ because they open a new tab.
 * 4. "Log interaction" is the only primary button. Colour, avatar, copy,
 *    archive and delete sit in the kebab beside it. The narrow layout has no
 *    button: the composer is the first thing under the tabs.
 * 5. The narrow header keeps to about 140 px. The headline, the summary and
 *    the tags move to the Details tab (`ContactIntro`, `ContactTags`), and
 *    the weather stays off.
 *
 * The briefing lives in the Dossier tab, not here.
 */
import React, { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Archive,
  ArrowUpRight,
  CalendarClock,
  Copy,
  NotebookPen,
  Trash2,
} from "lucide-react";
import { isPast, isToday } from "date-fns";
import { motion } from "motion/react";
import { toast } from "sonner";

import type {
  Contact,
  ContactSocialLink,
  ContactUpdateData,
} from "../../../types";
import { cleanLinkedInSlug, cn, safeHref } from "../../../lib/utils";
import { META_LINE } from "../../../lib/styles";
import { copyToClipboard, CLIPBOARD_DENIED } from "../../../lib/clipboard";

import {
  LocalTimeWeather,
  timeZoneAt,
} from "../../../components/LocalTimeWeather";
import { usePreferences } from "../../../contexts/PreferencesContext";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ScoreRingAvatar } from "../../../components/ScoreRingAvatar";

import { EditableField } from "./EditableField";
import { PlatformIcon, PLATFORM_COLORS, hasKnownIcon } from "./PlatformIcon";
import { ContactActionsMenu } from "./ContactActionsMenu";
import { ContactTags } from "./ContactTags";
import { CONTACT_HEADING_ID } from "../../../components/layout/SkipLink";
import { hasUserInteracted } from "../../../lib/userInteraction";

/** The two forms of the contact page. See ContactProfile. */
export type ContactLayout = "wide" | "narrow";

// ═══════════════════════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════════════════════

export interface ProfileHeaderProps {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  onDelete: () => void;
  onClose?: () => void;
  onOpenAvatarPicker: () => void;
  /** Opens the Timeline tab and focuses the composer. */
  onLogInteraction: () => void;
  showNetworkButton?: boolean;
  /** Which form to draw. Defaults to wide. */
  layout?: ContactLayout;
  /**
   * Where Back goes, by the name of the page: "Network", "Map". The button
   * says it, so nobody has to guess. Without one, the button says "Back".
   */
  backLabel?: string;

  // Mutations passed from parent
  archiveContact: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
  unarchiveContact: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
  updateContact: {
    mutate: (args: { id: string; data: ContactUpdateData }) => void;
  };
  promoteGhost: {
    mutate: (
      id: string,
      opts?: { onSuccess?: () => void; onError?: (err: Error) => void },
    ) => void;
    isPending: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Meta line helpers
// ═══════════════════════════════════════════════════════════════════════════

/** The first comma part of a place: "Sydney" from "Sydney, NSW, Australia". */
const shortPlace = (text: string | null | undefined): string | null =>
  text?.split(",")[0]?.trim() || null;

/** "Linkedin" from "linkedin": the label used when a link has no handle. */
const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** The text a social link shows: its handle, else its platform, else its host. */
function socialLinkName(sl: ContactSocialLink): string {
  const platformKey = sl.platform?.toLowerCase() || "other";
  const isKnown = hasKnownIcon(platformKey);

  let displayName = sl.handle || sl.platform;
  if (!sl.handle && sl.url) {
    try {
      displayName = new URL(sl.url).hostname.replace("www.", "");
    } catch {}
  }
  // Capitalize platform name for known ones
  if (!sl.handle && isKnown) {
    displayName = capitalise(sl.platform);
  }

  // Clean up LinkedIn auto-generated suffixes for display
  if (platformKey === "linkedin" && sl.handle) {
    displayName = cleanLinkedInSlug(sl.handle);
  } else if (platformKey === "linkedin" && sl.url) {
    // Extract slug from LinkedIn URL and clean it
    try {
      const url = new URL(sl.url);
      const pathParts = url.pathname.replace(/\/+$/, "").split("/");
      const slug = pathParts[pathParts.length - 1];
      if (slug && slug !== "in") {
        displayName = cleanLinkedInSlug(slug);
      }
    } catch {}
  }
  return displayName;
}

/** The host of a website, without "www.". */
function websiteName(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "Website";
  }
}

/** The middle dot between two facts. Decoration: a screen reader skips it. */
const MetaDot = () => <span aria-hidden="true">·</span>;

// ═══════════════════════════════════════════════════════════════════════════
// SocialLink: a text link on the meta line, with its own small actions menu
// ═══════════════════════════════════════════════════════════════════════════

const SocialLink = ({
  url,
  platform,
  displayName,
  platformName,
  iconClassName,
  useFavicon,
  onRemove,
  iconOnly = false,
}: {
  url: string;
  platform: string;
  displayName: string;
  /** Said to a screen reader when the icon is the only sign of the platform. */
  platformName?: string;
  iconClassName: string;
  useFavicon: boolean;
  /** When set, the link gets a menu with Copy link and Remove link. */
  onRemove?: () => void;
  /**
   * The narrow header's form: the platform icon and ↗, with the handle as the
   * link's name and its tooltip. Two handles in words take a phone's meta
   * line onto three lines.
   */
  iconOnly?: boolean;
}) => (
  <span className="group/link inline-flex items-center gap-1 max-w-full">
    <a
      href={safeHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      title={iconOnly ? displayName : undefined}
      className="hit-area inline-flex items-center gap-1.5 min-w-0 rounded font-medium text-on-surface underline-offset-2 hover:underline"
    >
      {/* The icon is hidden: a favicon's alt text would add a host name to
          the link's name. */}
      <span aria-hidden="true" className="inline-flex shrink-0">
        <PlatformIcon
          platform={platform}
          url={url}
          className={cn("w-4 h-4", iconClassName)}
          useFavicon={useFavicon}
        />
      </span>
      <span className={iconOnly ? "sr-only" : "min-w-0 break-words"}>
        {displayName}
      </span>
      {platformName && <span className="sr-only">, {platformName}</span>}
      <span aria-hidden="true" className="text-on-surface-variant">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
    {onRemove && (
      <ActionMenu
        label={`Actions for ${displayName}`}
        iconClassName="w-3.5 h-3.5"
        // At rest at every width. Hidden until hover, it still took its width,
        // so the gap after each link was wider than the gap after each fact.
        triggerClassName="p-1 rounded-lg"
        items={[
          {
            id: "copy",
            label: "Copy link",
            icon: Copy,
            onSelect: () => {
              copyToClipboard(url).then(
                () => toast.success("Link copied"),
                () => toast.error(CLIPBOARD_DENIED),
              );
            },
          },
          {
            id: "remove",
            label: "Remove link",
            icon: Trash2,
            danger: true,
            onSelect: onRemove,
          },
        ]}
      />
    )}
  </span>
);

// ═══════════════════════════════════════════════════════════════════════════
// ContactIntro: the headline and the AI summary
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The headline and the summary, when they add something.
 *
 * Under the role in the wide header, and at the top of the Details tab in the
 * narrow layout. Renders nothing when there is nothing new to say.
 */
export const ContactIntro = ({
  contact,
  onUpdate,
  className,
}: {
  contact: Contact;
  onUpdate: (field: string, val: string) => void;
  className?: string;
}) => {
  let headline: React.ReactNode = null;
  if (contact.headline) {
    // Hide the headline when it only repeats the role and company, which the
    // line above already shows.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const headlineNorm = normalize(contact.headline);
    const isDuplicate =
      headlineNorm ===
        normalize(`${contact.role || ""} at ${contact.company || ""}`) ||
      headlineNorm ===
        normalize(`${contact.role || ""} ${contact.company || ""}`) ||
      (contact.role && headlineNorm === normalize(contact.role)) ||
      (contact.company && headlineNorm === normalize(contact.company));
    if (!isDuplicate) {
      headline = (
        <div className="text-base text-on-surface-variant font-medium italic">
          <EditableField
            value={contact.headline}
            onSave={(val) => onUpdate("headline", val)}
            placeholder="Add headline"
          />
        </div>
      );
    }
  }

  if (!headline && !contact.aiSummary) return null;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {headline}
      {contact.aiSummary && (
        <div className="flex items-start gap-2 bg-primary/10 rounded-xl p-3 max-w-fit">
          <Sparkles
            aria-hidden="true"
            className="w-4 h-4 text-primary mt-0.5 shrink-0"
          />
          <div className="text-sm text-primary font-medium leading-relaxed italic">
            {contact.aiSummary}
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════════

const ProfileHeaderInner: React.FC<ProfileHeaderProps> = ({
  contact,
  onUpdate,
  onDelete,
  onClose,
  onOpenAvatarPicker,
  onLogInteraction,
  showNetworkButton = false,
  layout = "wide",
  backLabel,
  archiveContact,
  unarchiveContact,
  updateContact,
  promoteGhost,
}) => {
  const navigate = useNavigate();
  const narrow = layout === "narrow";
  const { preferences } = usePreferences();

  /**
   * Opening a contact puts focus on its name.
   *
   * Clicking a row used to leave focus on the row while the contact rendered
   * beside it, and on a phone, where the list leaves the screen, focus fell to
   * the document. Either way the next Tab started somewhere unrelated to what
   * just opened. The name is the page's h1, so a screen reader also announces
   * which contact this is.
   *
   * Three cases keep focus where it is: a page that has just loaded (the
   * first Tab there belongs to the skip link), someone typing (a quick note, a
   * search field) and a contact shown inside a dialog, which manages its own
   * focus. The header mounts once per contact, because the profile is keyed
   * by id.
   */
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const heading = headingRef.current;
    if (!heading || !hasUserInteracted()) return;
    if (heading.closest('[role="dialog"]')) return;
    const active = document.activeElement as HTMLElement | null;
    if (
      active?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName ?? "") ||
      active?.closest('[role="dialog"]')
    ) {
      return;
    }
    heading.focus({ preventScroll: true });
  }, []);

  const timezone = useMemo(
    () => timeZoneAt(contact.lat, contact.lng),
    [contact.lat, contact.lng],
  );

  // ── Social links ──────────────────────────────────────────────────────
  const removeSocialLink = (id: string) => {
    const before = contact.socialLinks || [];
    const after = before.filter((s) => s.id !== id);
    const payload = (links: ContactSocialLink[]) =>
      links.map((s) => ({
        platform: s.platform,
        url: s.url,
        handle: s.handle,
      }));
    updateContact.mutate({
      id: contact.id,
      data: { socialLinks: payload(after) },
    });
    toast("Link removed", {
      duration: 7000,
      action: {
        label: "Undo",
        onClick: () =>
          updateContact.mutate({
            id: contact.id,
            data: { socialLinks: payload(before) },
          }),
      },
    });
  };

  // ── Meta line ─────────────────────────────────────────────────────────
  // Each item is one fact or one link. The dots go between items, so the
  // line never starts or ends with one.
  const metaItems: { key: string; node: React.ReactNode }[] = [];
  const place =
    shortPlace(contact.addresses?.[0]?.address) ?? shortPlace(contact.location);
  if (place) {
    metaItems.push({ key: "place", node: <span>{place}</span> });
  }
  if (timezone) {
    metaItems.push({
      key: "time",
      node: (
        <LocalTimeWeather
          lat={contact.lat}
          lng={contact.lng}
          // The settings revamp's `showWeather` preference replaces the wide
          // case. The narrow header has room for one line, and no weather.
          showWeather={!narrow && preferences.showWeather}
        />
      ),
    });
  }
  for (const sl of contact.socialLinks || []) {
    const platformKey = sl.platform?.toLowerCase() || "other";
    const isKnown = hasKnownIcon(platformKey);
    const displayName = socialLinkName(sl);
    const platformName = isKnown ? capitalise(platformKey) : undefined;
    metaItems.push({
      key: `link-${sl.id}`,
      node: (
        <SocialLink
          iconOnly={narrow}
          url={sl.url}
          platform={sl.platform}
          displayName={displayName}
          platformName={
            platformName && platformName !== displayName
              ? platformName
              : undefined
          }
          iconClassName={
            PLATFORM_COLORS[platformKey] || "text-on-surface-variant"
          }
          useFavicon={!isKnown}
          onRemove={() => removeSocialLink(sl.id)}
        />
      ),
    });
  }
  // The website, when it is not already one of the social links.
  if (
    contact.website &&
    !contact.socialLinks?.some((sl) => sl.url === contact.website)
  ) {
    metaItems.push({
      key: "website",
      node: (
        <SocialLink
          iconOnly={narrow}
          url={contact.website}
          platform="website"
          displayName={websiteName(contact.website)}
          iconClassName="text-on-surface-variant"
          useFavicon
        />
      ),
    });
  }

  const avatarSize = narrow ? 56 : 96;

  return (
    <>
      {/*
        Back, below `lg`, where the contact has the screen and the list does
        not show. It names the page it goes to. The bar is 56 px tall, and the
        narrow layout's tabs stick right under it (ContactProfile).
      */}
      {onClose && (
        <div className="sticky top-0 z-30 glass-panel h-14 px-4 lg:hidden flex items-center shrink-0">
          <button
            type="button"
            onClick={onClose}
            aria-label={backLabel ? `Back to ${backLabel}` : undefined}
            className="hit-area flex items-center gap-2 text-on-primary-wash font-bold px-3 py-1.5 -ml-3 rounded-xl hover:bg-primary/10 active:bg-primary/15 transition-colors"
          >
            <ArrowLeft aria-hidden="true" className="w-5 h-5" />
            {backLabel ?? "Back"}
          </button>
        </div>
      )}

      {/* URGENCY BANNER */}
      {contact.nextFollowUpAt &&
        (isPast(new Date(contact.nextFollowUpAt)) ||
          isToday(new Date(contact.nextFollowUpAt))) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full bg-error/15 px-6 py-3 flex items-center justify-center gap-2 shadow-sm"
          >
            <CalendarClock className="w-4 h-4 text-error shrink-0" />
            <span className="text-sm font-bold text-error truncate">
              Pending Follow-Up Alert
            </span>
          </motion.div>
        )}

      <div
        className={cn(
          "max-w-6xl mx-auto w-full relative shrink-0",
          narrow ? "px-4 pt-4 pb-3" : "p-8 lg:px-10 lg:pt-8 lg:pb-6",
        )}
      >
        <section
          className={cn(
            "flex flex-row items-start",
            narrow ? "gap-4" : "gap-6",
          )}
        >
          {/* Avatar in the score ring. "Change avatar" is in the contact
              actions menu. */}
          <div className="relative shrink-0">
            <ScoreRingAvatar
              contact={contact}
              size={avatarSize}
              ring="header"
            />
            {!!contact.isArchived && (
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-amber-500/90 text-white text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap z-20">
                <Archive aria-hidden="true" className="w-2.5 h-2.5" />
                Archived
              </div>
            )}
            {contact.isGhost
              ? (() => {
                  const connectorSource = contact.sources?.find((s) =>
                    [
                      "calendar",
                      "email",
                      "google",
                      "imessage",
                      "whatsapp",
                    ].includes(s.platform),
                  );
                  const count = contact.interactionCount ?? 1;
                  const sourceName = connectorSource
                    ? connectorSource.platform === "calendar"
                      ? "calendar"
                      : connectorSource.platform === "email"
                        ? "mail"
                        : connectorSource.platform
                    : null;
                  const ghostText = sourceName
                    ? `Seen ${count} time${count === 1 ? "" : "s"} in your ${sourceName}. Waiting to be populated.`
                    : "Created automatically from a mention. Waiting to be populated.";

                  return (
                    <div className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-surface-container-highest border-2 border-surface-container-lowest shadow-sm z-20 group/ghosticon cursor-help">
                      <Sparkles className="w-4 h-4 text-primary opacity-80 group-hover/ghosticon:opacity-100 transition-opacity" />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-surface text-on-surface text-xs font-medium p-2.5 rounded-xl shadow-lg border border-surface-container opacity-0 pointer-events-none group-hover/ghosticon:opacity-100 transition-all z-50 text-center leading-relaxed">
                        <strong className="block text-primary mb-0.5">
                          Ghost Profile
                        </strong>
                        {ghostText}
                      </div>
                    </div>
                  );
                })()
              : null}
          </div>

          {/* Identity */}
          <div className="flex-1 min-w-0 w-full">
            {/* The name, then the actions. On a narrow screen the actions
                wrap under the name. */}
            <div
              className={cn(
                "flex items-center justify-between",
                narrow ? "gap-2" : "flex-wrap gap-x-4 gap-y-3",
              )}
            >
              {/*
                The page's h1. `tabIndex={-1}` lets focus land here on
                navigation and from the skip link without adding a Tab stop.
                No ring: it is a place, not a control, and the name inside it
                is the control and shows its own.
              */}
              <h1
                id={CONTACT_HEADING_ID}
                ref={headingRef}
                tabIndex={-1}
                className={cn(
                  "min-w-0 font-extrabold font-headline tracking-tight text-on-surface flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5 outline-none",
                  narrow ? "text-2xl" : "text-4xl",
                )}
              >
                <EditableField
                  value={contact.name}
                  onSave={(val) => onUpdate("name", val)}
                  placeholder="Contact Name"
                />
                {contact.pronouns && (
                  <span
                    className={cn(
                      "text-on-surface-variant font-medium tracking-normal inline-block align-middle",
                      narrow ? "text-base" : "text-xl",
                    )}
                  >
                    ({contact.pronouns})
                  </span>
                )}
              </h1>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {!!contact.isGhost && !narrow && (
                  <button
                    type="button"
                    onClick={() => {
                      promoteGhost.mutate(contact.id, {
                        onSuccess: () =>
                          toast.success(`${contact.name} promoted to network!`),
                      });
                    }}
                    disabled={promoteGhost.isPending}
                    className="btn-secondary"
                  >
                    <Sparkles aria-hidden="true" className="w-4 h-4" />
                    {promoteGhost.isPending
                      ? "Promoting…"
                      : "Promote to contact"}
                  </button>
                )}

                {!narrow && (
                  <button
                    type="button"
                    onClick={onLogInteraction}
                    className="btn-primary"
                  >
                    <NotebookPen aria-hidden="true" className="w-4 h-4" />
                    Log interaction
                  </button>
                )}

                <ContactActionsMenu
                  contact={contact}
                  onDelete={onDelete}
                  onOpenAvatarPicker={onOpenAvatarPicker}
                  archiveContact={archiveContact}
                  unarchiveContact={unarchiveContact}
                  updateContact={updateContact}
                />
              </div>
            </div>

            {/* Role at company. Narrow, a dot joins them, as in the meta line. */}
            <div
              className={cn(
                "font-medium text-on-surface-variant flex flex-wrap items-center gap-x-1.5",
                narrow ? "text-sm" : "mt-1 text-lg",
              )}
            >
              <EditableField
                value={contact.role}
                onSave={(val) => onUpdate("role", val)}
                placeholder="Role / Title"
              />
              {narrow ? <MetaDot /> : <span>at</span>}
              <EditableField
                value={contact.company}
                onSave={(val) => onUpdate("company", val)}
                placeholder="Company"
              />
            </div>

            {!narrow && (
              <ContactIntro
                contact={contact}
                onUpdate={onUpdate}
                className="mt-3"
              />
            )}

            {/* Meta line: facts as text, links as links */}
            {metaItems.length > 0 && (
              <div className={cn(META_LINE, narrow ? "mt-1" : "mt-3")}>
                {/* Each dot stays with the item after it, so a line that
                    wraps never ends on a dot. */}
                {metaItems.map((item, index) => (
                  <span
                    key={item.key}
                    className="inline-flex items-center gap-x-2 min-w-0 max-w-full"
                  >
                    {index > 0 && <MetaDot />}
                    {item.node}
                  </span>
                ))}
              </div>
            )}

            {/* Tags, then lists. Narrow, they open the Details tab. */}
            {!narrow && (
              <ContactTags
                contact={contact}
                updateContact={updateContact}
                className="mt-3"
              />
            )}

            {/* A ghost's one step, under the name where a phone has room. */}
            {!!contact.isGhost && narrow && (
              <button
                type="button"
                onClick={() => {
                  promoteGhost.mutate(contact.id, {
                    onSuccess: () =>
                      toast.success(`${contact.name} promoted to network!`),
                  });
                }}
                disabled={promoteGhost.isPending}
                className="btn-secondary mt-3"
              >
                <Sparkles aria-hidden="true" className="w-4 h-4" />
                {promoteGhost.isPending ? "Promoting…" : "Promote to contact"}
              </button>
            )}

            {/* Actions Row */}
            {showNetworkButton && (
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => {
                    if (onClose) onClose();
                    navigate(`/contact/${contact.id}`);
                  }}
                  className="flex items-center gap-2 min-h-[44px] sm:min-h-0 px-4 py-2 bg-primary/10 text-on-primary-wash rounded-xl font-bold hover:bg-primary/20 transition-colors text-sm"
                >
                  <ArrowUpRight aria-hidden="true" className="w-4 h-4" />
                  Open in Network
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

export const ProfileHeader = React.memo(ProfileHeaderInner);
