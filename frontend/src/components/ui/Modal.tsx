import React from 'react';
import {Dialog, DialogContent, DialogClose} from '@/components/ui/dialog';

interface ModalProps {
  children: React.ReactNode;
  onClose: () => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
  dismissible?: boolean;
  showClose?: boolean;
  finalFocus?: React.ComponentProps<typeof DialogContent>['finalFocus'];
}

/** Viewport-level dialogs, independent of animated or clipped page ancestors. */
export function Modal({ children, onClose, label, labelledBy, describedBy,
  role = 'dialog', className = 'max-w-lg p-6', dismissible = true, showClose = true, finalFocus }: ModalProps) {
  return (
    <Dialog open modal disablePointerDismissal={!dismissible}
      onOpenChange={(open, details) => {
        if (!open) {
          if (dismissible) onClose();
          else details.cancel();
        }
      }}>
          <DialogContent finalFocus={finalFocus} showCloseButton={false} role={role} aria-label={label} aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            className={`block max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-card text-card-foreground shadow-[var(--shadow-dialog)] outline-none [&>h2]:pr-5 [&>h3]:pr-5 ${className}`}>
            {showClose && <DialogClose disabled={!dismissible} aria-label="Close dialog"
              className="absolute right-3 top-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-lg leading-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">×</DialogClose>}
            {children}
          </DialogContent>
    </Dialog>
  );
}

