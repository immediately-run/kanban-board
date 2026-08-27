import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

interface Props {
  onClose: () => void;
  children: ReactNode;
  /** Anchor to the right edge of the trigger. */
  align?: 'left' | 'right';
  label: string;
}

/**
 * Small anchored menu. Positioned `fixed` from the parent (`.pop-anchor`) rect so
 * it is never clipped by a scrolling column, and kept inside the viewport.
 */
function Popover({ onClose, children, align = 'right', label }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const anchor = el?.parentElement;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = align === 'right' ? a.right - w : a.left;
    left = Math.max(8, Math.min(left, vw - w - 8));
    let top = a.bottom + 6;
    if (top + h > vh - 8) top = Math.max(8, a.top - h - 6);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [align]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className={`pop pop-${align}`} role="menu" aria-label={label} ref={ref}>
      {children}
    </div>
  );
}

export default Popover;
