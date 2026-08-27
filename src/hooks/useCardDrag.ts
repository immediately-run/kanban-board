// Pointer-event drag and drop for cards. Works with mouse, pen and touch: the
// drag handle carries `touch-action: none`, the rest of the card stays scrollable.
// Hit-testing uses `[data-col]` / `[data-card]` attributes on the rendered DOM so
// the hook doesn't need refs for every card.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface DropTarget {
  column: string;
  /** Insertion index among the column's OTHER cards. */
  index: number;
}

export interface DragState {
  cardId: string;
  fromColumn: string;
  title: string;
  /** Ghost box: current pointer minus grab offset. */
  x: number;
  y: number;
  w: number;
  h: number;
  target: DropTarget | null;
}

const THRESHOLD = 5;
const EDGE = 48;

interface Pending {
  cardId: string;
  fromColumn: string;
  title: string;
  pointerId: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  active: boolean;
}

function findTarget(x: number, y: number, cardId: string): DropTarget | null {
  const cols = Array.from(document.querySelectorAll<HTMLElement>('[data-col]'));
  let col: HTMLElement | null = null;
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40) {
      col = c;
      break;
    }
  }
  if (!col) return null;
  const cards = Array.from(col.querySelectorAll<HTMLElement>('[data-card]')).filter((el) => el.dataset.card !== cardId);
  let index = 0;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    if (y > r.top + r.height / 2) index++;
  }
  return { column: col.dataset.col as string, index };
}

function autoScroll(x: number, y: number) {
  const board = document.querySelector<HTMLElement>('[data-board]');
  if (board) {
    const r = board.getBoundingClientRect();
    if (x < r.left + EDGE) board.scrollLeft -= 12;
    else if (x > r.right - EDGE) board.scrollLeft += 12;
  }
  const cols = Array.from(document.querySelectorAll<HTMLElement>('[data-col-scroll]'));
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    if (x < r.left || x > r.right) continue;
    if (y < r.top + EDGE) c.scrollTop -= 10;
    else if (y > r.bottom - EDGE) c.scrollTop += 10;
  }
}

export function useCardDrag(onDrop: (cardId: string, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<Pending | null>(null);
  const suppressClickUntil = useRef(0);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const end = useCallback(() => {
    pending.current = null;
    document.body.classList.remove('is-dragging');
    setDrag(null);
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.active) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < THRESHOLD) return;
        p.active = true;
        document.body.classList.add('is-dragging');
      }
      e.preventDefault();
      autoScroll(e.clientX, e.clientY);
      setDrag({
        cardId: p.cardId,
        fromColumn: p.fromColumn,
        title: p.title,
        x: e.clientX - p.dx,
        y: e.clientY - p.dy,
        w: p.w,
        h: p.h,
        target: findTarget(e.clientX, e.clientY, p.cardId),
      });
    };
    const up = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (p.active) {
        suppressClickUntil.current = Date.now() + 400;
        const target = findTarget(e.clientX, e.clientY, p.cardId);
        if (target) onDropRef.current(p.cardId, target);
      }
      end();
    };
    const cancel = (e: PointerEvent) => {
      const p = pending.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (p.active) suppressClickUntil.current = Date.now() + 400;
      end();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [end]);

  /** Attach to `onPointerDown` of the card (mouse) or its grip (touch). */
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, card: { id: string; column: string; title: string }, cardEl: HTMLElement | null) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const el = cardEl ?? (e.currentTarget as HTMLElement);
      const r = el.getBoundingClientRect();
      pending.current = {
        cardId: card.id,
        fromColumn: card.column,
        title: card.title,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        dx: e.clientX - r.left,
        dy: e.clientY - r.top,
        w: r.width,
        h: r.height,
        active: false,
      };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* not supported; window listeners still work for mouse */
      }
    },
    [],
  );

  /** True right after a drop, so the click that follows pointerup doesn't open the card. */
  const wasDragClick = useCallback(() => Date.now() < suppressClickUntil.current, []);

  return { drag, startDrag, wasDragClick };
}
