import React, { useEffect, useRef } from 'react';

interface NativeModalProps {
  open: boolean;
  titleId: string;
  dismissible?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
}

export const NativeModal: React.FC<NativeModalProps> = ({
  open,
  titleId,
  dismissible = false,
  onClose,
  children,
}) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      dialog.returnValue = '';
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      if (!dismissible) {
        e.preventDefault();
      }
    };
    const handleClose = () => {
      dialog.returnValue = '';
      onClose?.();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [dismissible, onClose]);

  const closedByProp = dismissible ? 'closerequest' : 'none';

  return (
    <dialog
      ref={ref}
      className="game-dialog"
      aria-labelledby={titleId}
      {...({ closedby: closedByProp } as Record<string, unknown>)}
    >
      {children}
    </dialog>
  );
};
