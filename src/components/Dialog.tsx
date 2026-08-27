import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer row (buttons). */
  footer?: ReactNode;
  wide?: boolean;
}

function Dialog({ title, onClose, children, footer, wide }: Props) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dlg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dlg${wide ? ' dlg-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <header className="dlg-head">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>
        <div className="dlg-body">{children}</div>
        {footer && <footer className="dlg-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export default Dialog;
