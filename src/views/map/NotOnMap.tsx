/**
 * NotOnMap: the bottom line's count of contacts with an address and no pin,
 * and the list behind it, where "Set location" places a pin by hand.
 */
import { useState } from "react";
import { MapPinOff } from "lucide-react";
import type { NotOnMapContact } from "../../../shared/geo";
import { useGeoStatus } from "../../api/geo";
import { ScoreRingAvatar } from "../../components/ScoreRingAvatar";
import { Modal } from "../../components/ui/Modal";
import { cn } from "../../lib/utils";

const REASON: Record<NotOnMapContact["reason"], string> = {
  pending: "Waiting for the geocoder",
  "not-found": "The geocoder found no place for this address",
};

interface NotOnMapProps {
  /** Open the pin dialog for this contact. */
  onSetLocation: (contact: NotOnMapContact) => void;
  className?: string;
}

export const NotOnMap = ({ onSetLocation, className }: NotOnMapProps) => {
  const { data: contacts = [] } = useGeoStatus();
  const [open, setOpen] = useState(false);
  if (contacts.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "hit-area state-layer glass-panel shadow-lg rounded-2xl border border-outline-variant/20 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-on-surface whitespace-nowrap tabular-nums cursor-pointer",
          className,
        )}
      >
        <MapPinOff className="w-3.5 h-3.5" aria-hidden="true" />
        {contacts.length} not on the map
      </button>
      <Modal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Not on the map"
      >
        <ul className="-my-2">
          {contacts.map((contact) => (
            <li key={contact.id} className="flex items-center gap-3 py-2">
              <ScoreRingAvatar contact={contact} size={36} decorative />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-on-surface truncate">
                  {contact.name}
                </span>
                <span className="block text-xs text-on-surface-variant truncate">
                  {contact.location}
                </span>
                <span className="block text-xs text-on-surface-variant">
                  {REASON[contact.reason]}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSetLocation(contact);
                }}
                aria-label={`Set location for ${contact.name}`}
                className="btn-secondary btn-sm shrink-0"
              >
                Set location
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
};
