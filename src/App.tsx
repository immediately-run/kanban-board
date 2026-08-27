// Root component — immediately.run renders the default export of THIS file.
// Global CSS is imported here (not in main.tsx) because immediately.run's
// runtime never loads main.tsx; anything the rendered tree needs must be
// reachable from App.tsx.
import './index.css';
import './App.css';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@immediately-run/sdk/auth';
import { useBoard } from './hooks/useBoard';
import { storeKey, useStores } from './hooks/useStores';
import { useToasts } from './hooks/useToasts';
import type { Card } from './lib/board';
import Board from './components/Board';
import CardModal from './components/CardModal';
import ShareDialog from './components/ShareDialog';
import Toasts from './components/Toasts';
import TopBar from './components/TopBar';

function App() {
  const auth = useAuth();
  const by = auth.user?.login || 'someone';
  const stores = useStores();
  const { store } = stores;
  const { toasts, push, dismiss } = useToasts();

  const [boardId, setBoardId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);

  // Each store remembers its own last board.
  const key = store ? storeKey(store) : null;
  const wantedBoard = key ? (stores.config.lastBoard?.[key] ?? null) : null;
  const effectiveBoardId = boardId ?? wantedBoard;

  const onBoardChange = useCallback(
    (id: string) => {
      setBoardId(id);
      if (store) stores.rememberBoard(storeKey(store), id);
    },
    [store, stores],
  );

  const onRemoteUpdate = useCallback(() => {
    push(`Updated from ${store?.name ?? 'the shared space'}`);
  }, [push, store]);

  const onError = useCallback((m: string) => push(m, 'error'), [push]);

  const kb = useBoard({ store, boardId: effectiveBoardId, onBoardChange, by, onRemoteUpdate, onError });

  // Reset the in-memory selection when the store changes (private ↔ shared).
  const [prevStore, setPrevStore] = useState(store);
  if (store !== prevStore) {
    setPrevStore(store);
    setBoardId(null);
    setOpenCardId(null);
  }

  useEffect(() => {
    if (stores.lastError) {
      push(stores.lastError, 'error');
      stores.clearError();
    }
  }, [stores, push]);

  const runShare = async (op: () => Promise<'ok' | 'cancelled' | 'error'>) => {
    setShareBusy(true);
    try {
      const r = await op();
      if (r === 'ok') setShareOpen(false);
    } finally {
      setShareBusy(false);
    }
  };

  const openCard = kb.board?.cards.find((c) => c.id === openCardId) ?? null;

  return (
    <div className="app">
      <TopBar
        boards={kb.boards}
        boardId={kb.board?.meta.id ?? effectiveBoardId}
        store={store}
        readOnly={kb.readOnly}
        onSelectBoard={onBoardChange}
        onNewBoard={(name) => void kb.createBoard(name)}
        onRenameBoard={(name) => void kb.renameBoard(name)}
        onDeleteBoard={(id) => void kb.deleteBoard(id)}
        onShare={() => setShareOpen(true)}
      />

      {stores.error ? (
        <div className="empty">
          <h2>Storage is unavailable.</h2>
          <p className="muted">{stores.error}</p>
        </div>
      ) : !stores.ready || (kb.loading && !kb.board) ? (
        <div className="empty">
          <p className="muted mono">Opening your boards…</p>
        </div>
      ) : kb.board ? (
        <Board
          board={kb.board}
          readOnly={kb.readOnly}
          onOpenCard={(c: Card) => setOpenCardId(c.id)}
          onMoveCard={(id, col, idx) => void kb.moveCard(id, col, idx)}
          onAddCard={(col, title) => void kb.addCard(col, title)}
          onAddColumn={(name) => void kb.addColumn(name)}
          onRenameColumn={(id, name) => void kb.renameColumn(id, name)}
          onDeleteColumn={(id) => void kb.removeColumn(id)}
          onMoveColumn={(id, idx) => void kb.moveColumn(id, idx)}
        />
      ) : (
        <div className="empty">
          <h2>No boards here yet.</h2>
          <p className="muted">
            {kb.readOnly ? 'This space is read-only and has no boards.' : 'Create one from the board menu.'}
          </p>
        </div>
      )}

      {openCard && kb.board && (
        <CardModal
          card={openCard}
          columns={kb.board.meta.columns}
          readOnly={kb.readOnly}
          onSave={(c) => {
            if (c.column !== openCard.column) void kb.moveCard(c.id, c.column, Number.MAX_SAFE_INTEGER, c);
            else void kb.updateCard(c);
          }}
          onDelete={() => void kb.removeCard(openCard.id)}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {shareOpen && (
        <ShareDialog
          shared={stores.shared}
          busy={shareBusy}
          onPick={() => void runShare(stores.openShared)}
          onCreate={(name) => void runShare(() => stores.createShared(name))}
          onLeave={() => {
            void stores.leaveShared();
            setShareOpen(false);
          }}
          onClose={() => setShareOpen(false)}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default App;
