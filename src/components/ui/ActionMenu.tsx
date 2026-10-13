import { useRef, useState, useLayoutEffect, Children, isValidElement, cloneElement, type ReactNode, type ReactElement, type ButtonHTMLAttributes } from 'react';
import { Popover } from '@base-ui/react/popover';
import { MoreVertical } from 'lucide-react';

/** Portaled popovers remain visible outside scrolling tables and nested dialogs. */
export default function ActionMenu({ open, onOpenChange, label, children, trigger, buttonClassName, width = 208, height = 256, isPicker = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; label: string; children: ReactNode;
  trigger?: ReactNode; buttonClassName?: string; width?: number; height?: number; isPicker?: boolean;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useLayoutEffect(() => {
    const update = () => setVisible(!!anchor.current?.getClientRects().length);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);
  return <Popover.Root open={open && visible} onOpenChange={onOpenChange}>
    <Popover.Trigger ref={anchor} type="button" aria-label={label} aria-haspopup={isPicker ? 'dialog' : 'menu'}
      className={buttonClassName || 'p-2 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring cursor-pointer'}>
      {trigger || <MoreVertical className="w-4 h-4" />}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-[100]">
        <Popover.Popup ref={popup} role={isPicker ? 'dialog' : 'menu'} aria-label={label}
          style={{ width, maxWidth: 'calc(100vw - 24px)', maxHeight: `min(var(--available-height), ${height}px)` }}
          onKeyDown={event => {
            if (!isPicker && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const items = (Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []) as HTMLButtonElement[]).filter(item => item.getClientRects().length);
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }} className="bg-card text-foreground border border-border rounded-xl shadow-xl py-1.5 text-left overflow-y-auto overscroll-contain [scrollbar-gutter:stable] outline-none">
          {isPicker ? children : Children.map(children, child => isValidElement(child) && child.type === 'button' ? cloneElement(child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>, { role: 'menuitem' }) : child)}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
