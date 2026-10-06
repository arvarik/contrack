/**
 * The map's cards: a pin's hover card and its phone sheet, and a cluster's
 * preview. A card keeps inside `padding`, the part of the map nothing covers.
 */
import React, {
  useEffect,
  useRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { Popup, type PopupInstance } from "@vis.gl/react-maplibre";
import type { PaddingOptions } from "maplibre-gl";
import { motion } from "motion/react";
import {
  CalendarPlus,
  ExternalLink,
  ListPlus,
  MapPin,
  MapPinPen,
  PenLine,
  Phone,
  X,
} from "lucide-react";
import type { MapContact } from "../../../shared/geo";
import { scoreView } from "../../../shared/scoreBand";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { IconButton } from "../../components/ui/IconButton";
import {
  describeLocalTime,
  timeZoneAt,
} from "../../components/LocalTimeWeather";
import { telHref } from "../../lib/contactLinks";
import { formatRelative } from "../../lib/datetime";
import { BANNER_DAYS, describeFollowUp } from "../../lib/followUp";
import { DURATION, EASE } from "../../lib/motion";
import { TAG_PILL, TONE_TEXT, TONE_WASH } from "../../lib/styles";
import { cn } from "../../lib/utils";
import type { ClusterFeature } from "./useClusterFeatures";

/** Half the 48 px pin plus a gap, so a card clears the ring. */
export const PIN_CLEARANCE = 30;

export type CardAction = "open" | "log" | "followUp" | "list" | "adjust";

const ACTIONS: {
  action: CardAction;
  label: string;
  short: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { action: "open", label: "Open contact", short: "Open", Icon: ExternalLink },
  { action: "log", label: "Log interaction", short: "Log", Icon: PenLine },
  {
    action: "followUp",
    label: "Add follow-up",
    short: "Follow-up",
    Icon: CalendarPlus,
  },
  { action: "list", label: "Add to list", short: "List", Icon: ListPlus },
  { action: "adjust", label: "Adjust pin", short: "Pin", Icon: MapPinPen },
];

const MORE = "text-[11px] font-semibold text-on-surface-variant";

/** The `tel:` link of the contact's primary phone, or null. */
const callHref = (contact: MapContact) => {
  const phone = contact.phones?.[0]?.phone;
  return phone ? telHref(phone) : null;
};

/** The hover card's Call: an `IconButton` in look, a link in fact. */
const CALL_ICON_LINK =
  "state-layer inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-xl p-1.5 text-on-surface-variant hover:text-on-surface";

// The cells of the phone sheet share the row by their words, so "Follow-up"
// keeps one line when Call makes six cells on a 375 px phone.
const SHEET_ACTION =
  "state-layer flex flex-auto min-w-[44px] min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl px-1 whitespace-nowrap text-[11px] font-semibold text-on-surface";

const SheetCall = ({ contact }: { contact: MapContact }) => {
  const call = callHref(contact);
  return call ? (
    <a href={call} className={SHEET_ACTION}>
      <Phone aria-hidden="true" className="h-4 w-4" />
      Call
    </a>
  ) : null;
};

export const cardId = (id: string) => `map-hover-card-${id}`;
export const clusterCardId = (key: string) => `map-cluster-card-${key}`;

/** The most urgent fact: a follow-up due within the week, or the last contact. */
function statusOf(contact: MapContact) {
  const due = describeFollowUp(contact.nextFollowUpAt);
  if (due && due.days <= BANNER_DAYS) return due;
  return {
    tone: "neutral" as const,
    text: contact.lastContactedAt
      ? `Last contact ${formatRelative(contact.lastContactedAt)}`
      : "No contact logged yet",
  };
}

function CardBody({
  contact,
  aside,
  children,
}: {
  contact: MapContact;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const view = scoreView(contact);
  const zone = timeZoneAt(contact.lat, contact.lng);
  const local = zone ? describeLocalTime(zone) : null;
  const place = [
    contact.location,
    local && `${local.time} ${local.zone.short}`,
  ].filter(Boolean);
  const status = statusOf(contact);
  const tags = contact.tags ?? [];
  const lists = contact.lists ?? [];
  return (
    <div className="space-y-2 font-body">
      <div className="flex items-start gap-3">
        <ScoreRingAvatar contact={contact} size={44} ring="list" decorative />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-on-surface">
            {contact.name}
          </p>
          {(contact.role || contact.company) && (
            <p className="truncate text-xs text-on-surface-variant">
              {[contact.role, contact.company].filter(Boolean).join(" at ")}
            </p>
          )}
        </div>
        {view.kind === "scored" && (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold",
              TONE_WASH[view.band.token],
            )}
          >
            Score {view.score}
          </span>
        )}
        {aside}
      </div>
      {place.length > 0 && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-primary">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{place.join(" · ")}</span>
        </p>
      )}
      <p className={cn("text-xs font-semibold", TONE_TEXT[status.tone])}>
        {status.text}
      </p>
      {(tags.length > 0 || lists.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className={TAG_PILL}>
              {tag}
            </span>
          ))}
          {tags.length > 3 && <span className={MORE}>+{tags.length - 3}</span>}
          {lists[0] && (
            <span className="rounded-md bg-secondary/10 px-2 py-0.5 text-[11px] font-semibold text-secondary">
              {lists[0].name}
            </span>
          )}
          {lists.length > 1 && (
            <span className={MORE}>
              +{lists.length - 1} {lists.length === 2 ? "list" : "lists"}
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

const popupProps = {
  offset: PIN_CLEARANCE,
  closeButton: false,
  closeOnClick: false,
  focusAfterOpen: false,
  maxWidth: "none",
  className: "contact-popup map-card",
};

interface MapHoverCardProps {
  contact: MapContact;
  /** `focus` is the keyboard's tooltip, with no buttons. `pinned` stays open. */
  mode: "focus" | "hover" | "pinned";
  padding?: PaddingOptions;
  onAction: (action: CardAction) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export const MapHoverCard = ({
  contact,
  mode,
  padding,
  onAction,
  onPointerEnter,
  onPointerLeave,
}: MapHoverCardProps) => {
  const popup = useRef<PopupInstance>(null);
  const first = useRef<HTMLButtonElement>(null);
  // A new size or room places the card again, and a pinned card takes focus.
  useEffect(() => {
    popup.current?.setPadding(padding);
    if (mode === "pinned") first.current?.focus();
  }, [mode, padding]);
  const tooltip = mode === "focus";
  const call = callHref(contact);
  return (
    <Popup
      ref={popup}
      longitude={contact.lng}
      latitude={contact.lat}
      padding={padding}
      {...popupProps}
    >
      <div
        id={cardId(contact.id)}
        role={tooltip ? "tooltip" : "dialog"}
        aria-label={tooltip ? undefined : contact.name}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        className="w-72"
      >
        <CardBody contact={contact}>
          {tooltip ? (
            <p className="text-[11px] text-on-surface-variant">
              Space for actions · Enter to open
            </p>
          ) : (
            <div className="-mx-2 -mb-2 flex justify-between border-t border-outline-variant/20 pt-1">
              {ACTIONS.map(({ action, label, Icon }, i) => (
                <React.Fragment key={action}>
                  <IconButton
                    ref={i === 0 ? first : undefined}
                    aria-label={label}
                    title={label}
                    tone="subtle"
                    size="sm"
                    onClick={() => onAction(action)}
                  >
                    <Icon className="h-4 w-4" />
                  </IconButton>
                  {/* Call follows Open: the two ways to reach the person. */}
                  {action === "open" && call && (
                    <a
                      href={call}
                      aria-label="Call"
                      title="Call"
                      className={CALL_ICON_LINK}
                    >
                      <Phone aria-hidden="true" className="h-4 w-4" />
                    </a>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}
        </CardBody>
      </div>
    </Popup>
  );
};

/** A finger cannot hover, so a tap on a pin shows its card here first. */
export const MapPeekSheet = ({
  contact,
  onAction,
  onClose,
}: {
  contact: MapContact;
  onAction: (action: CardAction) => void;
  onClose: () => void;
}) => (
  <motion.div
    role="dialog"
    aria-label={contact.name}
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: DURATION.fast, ease: EASE }}
    className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-20 mx-auto max-w-md rounded-2xl bg-surface-container-lowest p-4 shadow-2xl ring-1 ring-outline-variant/30 md:bottom-4"
  >
    <CardBody
      contact={contact}
      aside={
        <IconButton
          aria-label="Close"
          tone="subtle"
          size="sm"
          className="-mr-2 -mt-2"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </IconButton>
      }
    >
      <div className="flex gap-1 border-t border-outline-variant/20 pt-2">
        {ACTIONS.map(({ action, label, short, Icon }) => (
          <React.Fragment key={action}>
            <button
              type="button"
              aria-label={label}
              onClick={() => onAction(action)}
              className={SHEET_ACTION}
            >
              <Icon className="h-4 w-4" />
              {short}
            </button>
            {action === "open" && <SheetCall contact={contact} />}
          </React.Fragment>
        ))}
      </div>
    </CardBody>
  </motion.div>
);

/** Who is in a cluster: its five best-known people and what a click does. */
export const ClusterPreview = ({
  cluster,
  members,
  stacked,
  padding,
}: {
  cluster: ClusterFeature;
  members: MapContact[];
  /** No zoom splits it, so a click lists the people. */
  stacked: boolean;
  padding?: PaddingOptions;
}) => {
  const shown = members.slice(0, 5);
  return (
    <Popup
      longitude={cluster.longitude}
      latitude={cluster.latitude}
      padding={padding}
      {...popupProps}
    >
      <div
        id={clusterCardId(cluster.key)}
        role="tooltip"
        className="w-60 space-y-2 font-body"
      >
        <p className="text-sm font-extrabold text-on-surface">
          {cluster.count} people
        </p>
        {shown.length > 0 && (
          <ul className="space-y-1.5">
            {shown.map((contact) => (
              <li
                key={contact.id}
                className="flex items-center gap-2 text-xs text-on-surface"
              >
                <ScoreRingAvatar contact={contact} size={24} decorative />
                <span className="truncate">
                  <span className="font-semibold">{contact.name}</span>
                  {contact.company && ` · ${contact.company}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        {shown.length > 0 && cluster.count > shown.length && (
          <p className={MORE}>and {cluster.count - shown.length} more</p>
        )}
        <p className="text-[11px] font-semibold text-primary">
          {stacked ? "Choose it to list them" : "Choose it to zoom in"}
        </p>
      </div>
    </Popup>
  );
};
