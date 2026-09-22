/**
 * ImportModal — Dialog wrapper for ImportPanel.
 *
 * Opened from the contact list. Renders ImportPanel inside a standard Modal.
 *
 * @module components/ImportModal
 */
import React from "react";
import { Modal } from "./ui/Modal";
import { ImportPanel } from "./ImportPanel";
import type { ImportSummary } from "../api/imports";

export interface ImportModalProps {
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

export default ImportModal;
