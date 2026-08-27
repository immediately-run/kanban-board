import { useCallback, useRef, useState } from 'react';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export function useToasts(ttlMs = 3200) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const push = useCallback(
    (text: string, kind: Toast['kind'] = 'info') => {
      const id = ++seq.current;
      setToasts((t) => [...t.filter((x) => x.text !== text), { id, text, kind }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttlMs);
    },
    [ttlMs],
  );

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return { toasts, push, dismiss };
}
