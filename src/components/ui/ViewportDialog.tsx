import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export default function ViewportDialog({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} className={`block max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain p-0 gap-0 border-0 bg-transparent shadow-none ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'}`}>
      <DialogTitle className="sr-only">{label}</DialogTitle>
      {children}
    </DialogContent>
  </Dialog>;
}
