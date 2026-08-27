import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dueInDays, labelHue, type Card, type Column } from '../lib/board';
import Icon from './Icon';
import Popover from './Popover';

interface Props {
  card: Card;
  columns: Column[];
  /** Number of other cards in each column (for "move to bottom"). */
  readOnly: boolean;
  dragging: boolean;
  onOpen: () => void;
  onStartDrag: (e: ReactPointerEvent<HTMLElement>, cardEl: HTMLElement | null) => void;
  wasDragClick: () => boolean;
  onMove: (columnId: string, index: number) => void;
}

function CardItem({ card, columns, readOnly, dragging, onOpen, onStartDrag, wasDragClick, onMove }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [menu, setMenu] = useState(false);
  const days = dueInDays(card.due);
  const dueClass = days === null ? '' : days < 0 ? ' due-late' : days <= 2 ? ' due-soon' : '';

  return (
    <article
      ref={ref}
      className={`card${dragging ? ' card-dragging' : ''}`}
      data-card={card.id}
      onPointerDown={(e) => {
        if (readOnly || menu) return;
        if (e.pointerType !== 'mouse') return; // touch/pen drag via the grip only
        if ((e.target as HTMLElement).closest('button')) return;
        onStartDrag(e, ref.current);
      }}
      onClick={(e) => {
        if (wasDragClick()) return;
        if ((e.target as HTMLElement).closest('button, .pop')) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) onOpen();
      }}
      tabIndex={0}
      role="button"
      aria-label={card.title || 'Untitled card'}
    >
      <div className="card-main">
        <h4 className="card-title">{card.title || <span className="muted">Untitled</span>}</h4>
        {(card.labels.length > 0 || card.due) && (
          <div className="card-meta">
            {card.labels.map((l) => (
              <span key={l} className={`label hue-${labelHue(l)}`}>
                {l}
              </span>
            ))}
            {card.due && (
              <span className={`due${dueClass}`} title={`Due ${card.due}`}>
                {days === 0 ? 'today' : days === 1 ? 'tomorrow' : days !== null && days < 0 ? `${-days}d late` : card.due.slice(5)}
              </span>
            )}
          </div>
        )}
        <div className="card-foot">
          <span className="by">{card.by}</span>
        </div>
      </div>
      {!readOnly && (
        <div className="card-tools">
          <button
            type="button"
            className="grip"
            aria-label="Drag card"
            onPointerDown={(e) => {
              e.stopPropagation();
              onStartDrag(e, ref.current);
            }}
          >
            <Icon name="grip" size={16} />
          </button>
          <div className="pop-anchor">
            <button
              type="button"
              className="iconbtn small"
              aria-label="Move card to…"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={(e) => {
                e.stopPropagation();
                setMenu((m) => !m);
              }}
            >
              <Icon name="move" size={14} />
            </button>
            {menu && (
              <Popover label="Move card" onClose={() => setMenu(false)}>
                <div className="pop-title">Move to</div>
                {columns.map((c) => (
                  <div key={c.id} className="pop-row">
                    <span className={c.id === card.column ? 'muted' : ''}>{c.name}</span>
                    <span className="pop-row-actions">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(false);
                          onMove(c.id, 0);
                        }}
                      >
                        top
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(false);
                          onMove(c.id, Number.MAX_SAFE_INTEGER);
                        }}
                      >
                        bottom
                      </button>
                    </span>
                  </div>
                ))}
              </Popover>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default CardItem;
