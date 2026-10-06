/** ImportPanel in a dialog, opened from the contact list. */
import { Modal } from "./ui/Modal";
import { ImportPanel } from "./ImportPanel";
import type { ImportSummary } from "../api/imports";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ImportModal = ({
  isOpen,
  onClose,
  onSuccess,
}: ImportModalProps) => {
  const handleComplete = (_summary: ImportSummary) => {
    onSuccess();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import contacts">
      <ImportPanel onComplete={handleComplete} onClose={onClose} />
    </Modal>
  );
};
