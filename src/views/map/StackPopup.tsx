/**
 * The list that opens over a stack of pins: people the geocoder put on one
 * point, which no zoom can split. Each has a button, the open one marked.
 *
 * @module views/map/StackPopup
 */
import { Popup } from "@vis.gl/react-maplibre";
import type { PaddingOptions } from "maplibre-gl";
import type { MapContact } from "../../../shared/geo";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { SELECTED_TINT } from "../../lib/styles";
import { cn } from "../../lib/utils";
import { PIN_CLEARANCE } from "./MapHoverCard";

export interface ContactStack {
  clusterId: number;
  longitude: number;
  latitude: number;
  /** Everyone in the cluster, up to {@link STACK_LIMIT}. */
  contacts: MapContact[];
  /** The cluster's full size, which can be more than the list holds. */
  total: number;
  /** The part of the map the list keeps inside. */
  padding?: PaddingOptions;
}

/** The most people one stack lists. The rest are counted, not listed. */
export const STACK_LIMIT = 50;

interface StackPopupProps {
  stack: ContactStack;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export const StackPopup = ({
  stack,
  selectedId,
  onSelect,
  onClose,
}: StackPopupProps) => {
  const hidden = stack.total - stack.contacts.length;
  return (
    <Popup
      longitude={stack.longitude}
      latitude={stack.latitude}
      offset={PIN_CLEARANCE}
      padding={stack.padding}
      closeButton={false}
      closeOnClick
      onClose={onClose}
      maxWidth="280px"
      className="contact-popup"
    >
      <div className="font-body">
        <p className="px-2 pt-1 pb-1 text-xs font-semibold text-on-surface-variant">
          {stack.total} people here
        </p>
        <ul
          className="max-h-64 overflow-y-auto"
          aria-label="People at this place"
        >
          {stack.contacts.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                aria-current={contact.id === selectedId || undefined}
                onClick={() => onSelect(contact.id)}
                className={cn(
                  "state-layer flex w-full min-h-[44px] items-center gap-2 px-2 rounded-lg text-left text-sm text-on-surface",
                  contact.id === selectedId && SELECTED_TINT,
                )}
              >
                <ScoreRingAvatar contact={contact} size={28} decorative />
                <span className="min-w-0 truncate">
                  <span className="font-semibold">{contact.name}</span>
                  {contact.company && (
                    <span className="text-on-surface-variant">
                      , {contact.company}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hidden > 0 && (
          <p className="px-2 pt-1 text-xs text-on-surface-variant">
            Showing {stack.contacts.length} of {stack.total}
          </p>
        )}
      </div>
    </Popup>
  );
};
