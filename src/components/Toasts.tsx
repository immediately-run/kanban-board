import type { Toast } from '../hooks/useToasts';

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

function Toasts({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  );
}

export default Toasts;
