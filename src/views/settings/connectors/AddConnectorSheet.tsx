/**
 * AddConnectorSheet — gallery sheet for choosing a new connector to add.
 *
 * Reads supported kinds from `/api/connectors/kinds` and presents each option
 * with icon, description, and platform availability notes.
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

interface AddConnectorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectKind: (kind: ConnectorKind) => void;
}

const KIND_ICONS: Record<ConnectorKind, LucideIcon> = {
  ics: Calendar,
  imap: Mail,
  google: Globe,
};

export const AddConnectorSheet: React.FC<AddConnectorSheetProps> = ({
  isOpen,
  onClose,
  onSelectKind,
}) => {
  const { data: kinds, isLoading } = useConnectorKinds();

  const handleChoose = (kind: KindInfo) => {
    onSelectKind(kind.kind);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add a Connector" size="md">
      <div className="space-y-4 pt-2">
        <p className="text-xs text-on-surface-variant leading-relaxed">
          Choose a service to sync your interactions. Contrack connects directly
          from your server — your data is never shared with third parties.
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-8 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin mr-2" aria-hidden="true" />
            <span className="text-sm">Loading available connectors…</span>
          </div>
        )}

        {!isLoading && kinds && (
          <div className="grid gap-2">
            {kinds.map((k) => {
              const Icon = KIND_ICONS[k.kind] ?? Calendar;
              return (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => handleChoose(k)}
                  className="hit-area w-full text-left flex items-start gap-3 p-3 rounded-xl border transition-all bg-surface-container hover:bg-surface-container-high border-surface-container-high cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-on-surface">
                        {k.label}
                      </span>
                    </div>
                    <p className="text-xs text-on-surface-variant mt-0.5 leading-normal">
                      {k.description}
                    </p>
                  </div>
                  <ChevronRight
                    className="w-4 h-4 text-on-surface-variant shrink-0 mt-2"
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-surface-container-high/40">
          <button
            type="button"
            onClick={onClose}
            className="hit-area px-4 py-2 rounded-xl text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
};
