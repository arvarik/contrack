/**
 * AddConnectorSheet — gallery sheet for choosing a new connector to add.
 *
 * Reads supported kinds from `/api/connectors/kinds` and presents each option
 * with icon, description, and platform availability notes.
 *
 * Each kind is a tile (`ConnectorKindTile`) that opens its form as a whole,
 * so it lifts on hover (`lift`, "Elevation" in `.agent/STYLE.md`). The
 * Connectors page shows the same tiles when nothing is connected yet.
 *
 * @module views/settings/connectors/AddConnectorSheet
 */

import React from "react";
import {
  Calendar,
  ChevronRight,
  Globe,
  Loader2,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { useConnectorKinds } from "../../../api/connectors";
import type { ConnectorKind, KindInfo } from "../../../../shared/connectors";
import { TONE_WASH } from "../../../lib/styles";
import { cn } from "../../../lib/utils";

interface AddConnectorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKind: (kind: ConnectorKind) => void;
}

export const KIND_ICONS: Record<ConnectorKind, LucideIcon> = {
  ics: Calendar,
  imap: Mail,
  google: Globe,
};

/** One kind of connector: a tile that opens its form. */
const ConnectorKindTile = ({
  kind,
  onChoose,
}: {
  kind: KindInfo;
  onChoose: (kind: ConnectorKind) => void;
}) => {
  const Icon = KIND_ICONS[kind.kind] ?? Calendar;
  return (
    <button
      type="button"
      onClick={() => onChoose(kind.kind)}
      className="lift state-layer w-full text-left flex items-start gap-3 p-3.5 rounded-xl bg-surface-container-low cursor-pointer"
    >
      <span
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
          TONE_WASH.primary,
        )}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-on-surface">
          {kind.label}
        </span>{" "}
        {/* The space keeps the name "Calendar Sync meetings…" for a
            reader that ignores the blocks' own break. */}
        <span className="block text-xs text-on-surface-variant mt-0.5 text-pretty">
          {kind.description}
        </span>
      </span>
      <ChevronRight
        className="w-4 h-4 text-on-surface-variant shrink-0 mt-2.5"
        aria-hidden="true"
      />
    </button>
  );
};

export const AddConnectorSheet: React.FC<AddConnectorSheetProps> = ({
  isOpen,
  onClose,
  onSelectKind,
}) => {
  const { data: kinds, isLoading } = useConnectorKinds();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add a connector" size="md">
      <div className="space-y-4 pt-2">
        <p className="text-sm text-on-surface-variant text-pretty">
          Choose a service to sync who you talk to. Contrack connects to it from
          your own server, and shares your data with no one.
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-8 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
            <span className="text-sm">Loading connectors…</span>
          </div>
        )}

        {!isLoading && kinds && (
          <div className="grid gap-2">
            {kinds.map((k) => (
              <ConnectorKindTile
                key={k.kind}
                kind={k}
                onChoose={onSelectKind}
              />
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
