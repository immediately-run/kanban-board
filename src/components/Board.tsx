import { useState, type FormEvent } from 'react';
import { cardsIn, type BoardSnapshot, type Card } from '../lib/board';
import { useCardDrag } from '../hooks/useCardDrag';
import ColumnView from './ColumnView';
import Icon from './Icon';

interface Props {
  board: BoardSnapshot;
  readOnly: boolean;
  onOpenCard: (card: Card) => void;
  onMoveCard: (cardId: string, columnId: string, index: number) => void;
  onAddCard: (columnId: string, title: string) => void;
  onAddColumn: (name: string) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onDeleteColumn: (columnId: string) => void;
  onMoveColumn: (columnId: string, index: number) => void;
}

function Board({
  board,
  readOnly,
  onOpenCard,
  onMoveCard,
  onAddCard,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onMoveColumn,
}: Props) {
  const { drag, startDrag, wasDragClick } = useCardDrag((cardId, target) => onMoveCard(cardId, target.column, target.index));
  const [addingCol, setAddingCol] = useState(false);
  const [colName, setColName] = useState('');

  const submitCol = (e: FormEvent) => {
    e.preventDefault();
    const n = colName.trim();
    if (n) onAddColumn(n);
    setColName('');
    setAddingCol(false);
  };

  return (
    <div className="board" data-board="">
      {board.meta.columns.map((col, i) => (
        <ColumnView
          key={col.id}
          column={col}
          columns={board.meta.columns}
          index={i}
          cards={cardsIn(board.cards, col.id)}
          readOnly={readOnly}
          drag={drag}
          onOpenCard={onOpenCard}
          onStartDrag={(e, card, el) => startDrag(e, card, el)}
          wasDragClick={wasDragClick}
          onMoveCard={onMoveCard}
          onAddCard={(title) => onAddCard(col.id, title)}
          onRename={(name) => onRenameColumn(col.id, name)}
          onDelete={() => onDeleteColumn(col.id)}
          onMoveColumn={(idx) => onMoveColumn(col.id, idx)}
        />
      ))}

      {!readOnly && (
        <section className="col col-new">
          {addingCol ? (
            <form onSubmit={submitCol} className="add-col">
              <input
                value={colName}
                onChange={(e) => setColName(e.target.value)}
                placeholder="Column name"
                aria-label="New column name"
                maxLength={60}
                onKeyDown={(e) => e.key === 'Escape' && setAddingCol(false)}
              />
              <div className="row">
                <button type="submit" className="btn btn-primary btn-sm">
                  Add column
                </button>
                <button type="button" className="iconbtn" aria-label="Cancel" onClick={() => setAddingCol(false)}>
                  <Icon name="x" size={16} />
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="add-btn add-col-btn" onClick={() => setAddingCol(true)}>
              <Icon name="plus" size={16} /> Add a column
            </button>
          )}
        </section>
      )}

      {drag && (
        <div className="ghost" style={{ transform: `translate(${drag.x}px, ${drag.y}px)`, width: drag.w }} aria-hidden="true">
          <h4 className="card-title">{drag.title || 'Untitled'}</h4>
        </div>
      )}
    </div>
  );
}

export default Board;
