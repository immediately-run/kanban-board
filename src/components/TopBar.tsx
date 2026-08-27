import { useState, type FormEvent } from 'react';
import type { BoardMeta } from '../lib/board';
import type { Store } from '../lib/store';
import Icon from './Icon';
import Popover from './Popover';
import ThemeSwitch from './ThemeSwitch';

interface Props {
  boards: BoardMeta[];
  boardId: string | null;
  store: Store | null;
  readOnly: boolean;
  onSelectBoard: (id: string) => void;
  onNewBoard: (name: string) => void;
  onRenameBoard: (name: string) => void;
  onDeleteBoard: (id: string) => void;
  onShare: () => void;
}

function TopBar({ boards, boardId, store, readOnly, onSelectBoard, onNewBoard, onRenameBoard, onDeleteBoard, onShare }: Props) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<'idle' | 'new' | 'rename' | 'delete'>('idle');
  const [name, setName] = useState('');
  const current = boards.find((b) => b.id === boardId);
  const shared = store?.kind === 'space' || (store?.kind === 'dev' && !!store.spaceId);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (mode === 'new' && n) onNewBoard(n);
    if (mode === 'rename' && n) onRenameBoard(n);
    setMode('idle');
    setName('');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <span className="brand-name">Kanban</span>
      </div>

      <div className="switcher pop-anchor">
        {mode === 'new' || mode === 'rename' ? (
          <form onSubmit={submit} className="row">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'new' ? 'New board name' : 'Board name'}
              aria-label={mode === 'new' ? 'New board name' : 'Board name'}
              maxLength={80}
              onKeyDown={(e) => e.key === 'Escape' && setMode('idle')}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
              {mode === 'new' ? 'Create' : 'Rename'}
            </button>
            <button type="button" className="iconbtn" aria-label="Cancel" onClick={() => setMode('idle')}>
              <Icon name="x" size={16} />
            </button>
          </form>
        ) : mode === 'delete' && current ? (
          <span className="row">
            <span className="small">Delete “{current.name}” and its cards?</span>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => {
                onDeleteBoard(current.id);
                setMode('idle');
              }}
            >
              Delete
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>
              Keep
            </button>
          </span>
        ) : (
          <>
            <button
              type="button"
              className="switch-btn"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              title="Switch board"
            >
              <Icon name="board" size={16} />
              <span className="switch-name">{current?.name ?? (boards.length ? 'Pick a board' : 'No boards')}</span>
              <Icon name="chevron" size={14} />
            </button>
            {menu && (
              <Popover label="Boards" align="left" onClose={() => setMenu(false)}>
                <div className="pop-title">Boards</div>
                {boards.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`pop-item${b.id === boardId ? ' active' : ''}`}
                    onClick={() => {
                      setMenu(false);
                      onSelectBoard(b.id);
                    }}
                  >
                    {b.id === boardId && <Icon name="check" size={14} />}
                    {b.name}
                  </button>
                ))}
                {!readOnly && (
                  <>
                    <div className="pop-sep" />
                    <button
                      type="button"
                      className="pop-item"
                      onClick={() => {
                        setMenu(false);
                        setName('');
                        setMode('new');
                      }}
                    >
                      <Icon name="plus" size={14} /> New board
                    </button>
                    {current && (
                      <>
                        <button
                          type="button"
                          className="pop-item"
                          onClick={() => {
                            setMenu(false);
                            setName(current.name);
                            setMode('rename');
                          }}
                        >
                          Rename board
                        </button>
                        <button
                          type="button"
                          className="pop-item danger"
                          onClick={() => {
                            setMenu(false);
                            setMode('delete');
                          }}
                        >
                          Delete board
                        </button>
                      </>
                    )}
                  </>
                )}
              </Popover>
            )}
          </>
        )}
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className={`btn ${shared ? 'btn-shared' : 'btn-ghost'} btn-sm`}
          onClick={onShare}
          title={shared ? `Shared: ${store?.name ?? store?.spaceId}` : 'Share this board'}
        >
          {shared ? <Icon name="users" size={15} /> : <Icon name="share" size={15} />}
          <span className="btn-label">{shared ? (store?.name ?? 'Shared') : 'Share'}</span>
          {readOnly && <Icon name="lock" size={13} />}
        </button>
        <ThemeSwitch />
      </div>
    </header>
  );
}

export default TopBar;
