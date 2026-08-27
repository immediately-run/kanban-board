import { useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Card, Column } from '../lib/board';
import type { DragState } from '../hooks/useCardDrag';
import CardItem from './CardItem';
import Icon from './Icon';
import Popover from './Popover';

interface Props {
  column: Column;
  columns: Column[];
  index: number;
  cards: Card[];
  readOnly: boolean;
  drag: DragState | null;
  onOpenCard: (card: Card) => void;
  onStartDrag: (e: ReactPointerEvent<HTMLElement>, card: Card, cardEl: HTMLElement | null) => void;
  wasDragClick: () => boolean;
  onMoveCard: (cardId: string, columnId: string, index: number) => void;
  onAddCard: (title: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onMoveColumn: (index: number) => void;
}

function ColumnView({
  column,
  columns,
  index,
  cards,
  readOnly,
  drag,
  onOpenCard,
  onStartDrag,
  wasDragClick,
  onMoveCard,
  onAddCard,
  onRename,
  onDelete,
  onMoveColumn,
}: Props) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');

  const placeholderAt = drag?.target?.column === column.id ? drag.target.index : -1;
  const visible = drag ? cards.filter((c) => c.id !== drag.cardId) : cards;
  const isLast = index === columns.length - 1;

  const submitRename = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n && n !== column.name) onRename(n);
    else setName(column.name);
    setRenaming(false);
  };

  const submitAdd = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (t) onAddCard(t);
    setTitle('');
  };

  const placeholder = <div className="card-placeholder" style={{ height: drag?.h ?? 64 }} aria-hidden="true" />;

  return (
    <section className={`col${drag?.target?.column === column.id ? ' col-over' : ''}`} data-col={column.id} aria-label={column.name}>
      <header className="col-head">
        {renaming ? (
          <form onSubmit={submitRename} className="col-rename">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={submitRename}
              aria-label="Column name"
              maxLength={60}
            />
          </form>
        ) : (
          <h3
            className="col-name"
            onDoubleClick={() => !readOnly && setRenaming(true)}
            title={readOnly ? undefined : 'Double-click to rename'}
          >
            {column.name}
            <span className="count">{cards.length}</span>
          </h3>
        )}
        {!readOnly && (
          <div className="pop-anchor">
            <button
              type="button"
              className="iconbtn small"
              aria-label={`Column ${column.name} options`}
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <Icon name="more" size={16} />
            </button>
            {menu && (
              <Popover label="Column options" onClose={() => setMenu(false)}>
                <button
                  type="button"
                  className="pop-item"
                  onClick={() => {
                    setMenu(false);
                    setRenaming(true);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="pop-item"
                  disabled={index === 0}
                  onClick={() => {
                    setMenu(false);
                    onMoveColumn(index - 1);
                  }}
                >
                  Move left
                </button>
                <button
                  type="button"
                  className="pop-item"
                  disabled={isLast}
                  onClick={() => {
                    setMenu(false);
                    onMoveColumn(index + 1);
                  }}
                >
                  Move right
                </button>
                <button
                  type="button"
                  className="pop-item danger"
                  disabled={columns.length <= 1}
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  Delete column{cards.length > 0 ? ` (moves ${cards.length} to ${columns.find((c) => c.id !== column.id)?.name ?? ''})` : ''}
                </button>
              </Popover>
            )}
          </div>
        )}
      </header>

      <div className="col-cards" data-col-scroll="">
        {cards.map((c) => {
          // The dragged card stays mounted (hidden by CSS) so pointer capture
          // survives; it is excluded from placeholder index math.
          const isDragged = c.id === drag?.cardId;
          const slot = isDragged ? -1 : visible.indexOf(c);
          return (
          <div key={c.id} className="col-slot">
            {slot >= 0 && placeholderAt === slot && placeholder}
            <CardItem
              card={c}
              columns={columns}
              readOnly={readOnly}
              dragging={isDragged}
              onOpen={() => onOpenCard(c)}
              onStartDrag={(e, el) => onStartDrag(e, c, el)}
              wasDragClick={wasDragClick}
              onMove={(col, idx) => onMoveCard(c.id, col, idx)}
            />
          </div>
          );
        })}
        {placeholderAt >= visible.length && placeholder}
        {visible.length === 0 && placeholderAt < 0 && <div className="col-empty">No cards</div>}
      </div>

      {!readOnly && (
        <footer className="col-foot">
          {adding ? (
            <form onSubmit={submitAdd} className="add-card">
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Card title"
                rows={2}
                aria-label="New card title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitAdd(e);
                  }
                  if (e.key === 'Escape') setAdding(false);
                }}
              />
              <div className="row">
                <button type="submit" className="btn btn-primary btn-sm">
                  Add card
                </button>
                <button type="button" className="iconbtn" aria-label="Cancel" onClick={() => setAdding(false)}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="add-btn" onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} /> Add a card
            </button>
          )}
        </footer>
      )}
    </section>
  );
}

export default ColumnView;
