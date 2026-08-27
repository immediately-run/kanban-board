// Boards + the open board's cards for one Store, with optimistic mutations and
// (for shared spaces) a directory poll that pulls other members' changes in.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  boardDir,
  boardsDir,
  byOrder,
  cardsDir,
  cardsIn,
  createBoard as createBoardOnDisk,
  deleteBoard as deleteBoardOnDisk,
  deleteCard as deleteCardOnDisk,
  listBoards,
  needsRenumber,
  newCard,
  orderBetween,
  readBoard,
  writeBoardMeta,
  writeCard,
  type BoardMeta,
  type BoardSnapshot,
  type Card,
} from '../lib/board';
import { newId, pollDir, type Store } from '../lib/store';

const POLL_MS = 2500;

/** Canonical serialisation so "did the poll bring anything new?" is a string compare. */
function canon(snap: BoardSnapshot | null): string {
  if (!snap) return '';
  const cards = [...snap.cards].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ meta: snap.meta, cards });
}

export interface UseBoardOptions {
  store: Store | null;
  /** Board to open (null = first board). */
  boardId: string | null;
  /** Called whenever the effective open board changes (incl. auto-select). */
  onBoardChange: (boardId: string) => void;
  /** Who writes. */
  by: string;
  /** Poll got something new from another member. */
  onRemoteUpdate: () => void;
  onError: (message: string) => void;
}

export function useBoard({ store, boardId, onBoardChange, by, onRemoteUpdate, onError }: UseBoardOptions) {
  // Everything loaded is tagged with the key it was loaded FOR, so "loading" is
  // derived (no setState-in-effect) and a stale store/board can never show.
  const sKey = store ? `${store.kind}:${store.spaceId ?? 'private'}:${store.root}` : null;
  const bKey = sKey && boardId ? `${sKey}|${boardId}` : null;
  const [boardsState, setBoardsState] = useState<{ key: string; list: BoardMeta[] } | null>(null);
  const [loaded, setLoaded] = useState<{ key: string; snap: BoardSnapshot | null } | null>(null);

  const boards = useMemo(() => (boardsState?.key === sKey ? boardsState.list : []), [boardsState, sKey]);
  const board = loaded && loaded.key === bKey ? loaded.snap : null;
  const loading = !!store && (boardsState?.key !== sKey || (!!bKey && loaded?.key !== bKey));

  const boardRef = useRef<BoardSnapshot | null>(board);
  const inflight = useRef(0);
  const dirty = useRef(false);
  const cbs = useRef({ onBoardChange, onRemoteUpdate, onError, by });
  useEffect(() => {
    boardRef.current = board;
  }, [board]);
  useEffect(() => {
    cbs.current = { onBoardChange, onRemoteUpdate, onError, by };
  }, [onBoardChange, onRemoteUpdate, onError, by]);

  const readOnly = !store || store.mode === 'ro';

  const setBoards = useCallback(
    (update: BoardMeta[] | ((prev: BoardMeta[]) => BoardMeta[])) => {
      if (!sKey) return;
      setBoardsState((prev) => {
        const base = prev?.key === sKey ? prev.list : [];
        return { key: sKey, list: typeof update === 'function' ? update(base) : update };
      });
    },
    [sKey],
  );
  const setBoard = useCallback(
    (snap: BoardSnapshot | null) => {
      if (bKey) setLoaded({ key: bKey, snap });
    },
    [bKey],
  );

  // ── boards list (+ first-run seed) ───────────────────────────────────────────
  useEffect(() => {
    if (!store || !sKey) return;
    let cancelled = false;
    (async () => {
      let list = await listBoards(store);
      if (list.length === 0 && store.mode === 'rw') {
        await createBoardOnDisk(store, 'My board', cbs.current.by, true);
        list = await listBoards(store);
      }
      if (cancelled) return;
      setBoardsState({ key: sKey, list });
      const wanted = list.find((b) => b.id === boardId) ?? list[0];
      if (wanted && wanted.id !== boardId) cbs.current.onBoardChange(wanted.id);
    })().catch((e: unknown) => {
      if (!cancelled) {
        setBoardsState({ key: sKey, list: [] });
        cbs.current.onError(e instanceof Error ? e.message : 'Could not list boards');
      }
    });
    return () => {
      cancelled = true;
    };
    // boardId is intentionally NOT a dep: this effect seeds + auto-selects once per store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, sKey]);

  // ── open board ───────────────────────────────────────────────────────────────
  const reload = useCallback(
    async (remote: boolean) => {
      if (!store || !boardId) return;
      const snap = await readBoard(store, boardId, boardRef.current ?? undefined);
      if (!snap) {
        // Board vanished (deleted by another member): fall back to the list.
        const list = await listBoards(store);
        setBoards(list);
        if (list[0]) cbs.current.onBoardChange(list[0].id);
        else setBoard(null);
        return;
      }
      if (canon(snap) !== canon(boardRef.current)) {
        const hadBoard = boardRef.current !== null;
        boardRef.current = snap;
        setBoard(snap);
        setBoards((bs) => bs.map((b) => (b.id === snap.meta.id ? snap.meta : b)));
        if (remote && hadBoard) cbs.current.onRemoteUpdate();
      }
    },
    [store, boardId, setBoard, setBoards],
  );

  useEffect(() => {
    if (!store || !boardId || !bKey) return;
    let cancelled = false;
    (async () => {
      const snap = await readBoard(store, boardId);
      if (cancelled) return;
      boardRef.current = snap;
      setLoaded({ key: bKey, snap });
    })().catch((e: unknown) => {
      if (!cancelled) {
        setLoaded({ key: bKey, snap: null });
        cbs.current.onError(e instanceof Error ? e.message : 'Could not open board');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store, boardId, bKey]);

  // ── polling (shared spaces only: there are no remote watch events) ───────────
  useEffect(() => {
    if (!store || !boardId || !store.spaceId) return;
    const onChange = () => {
      if (inflight.current > 0) {
        dirty.current = true;
        return;
      }
      void reload(true);
    };
    const stops = [
      pollDir(cardsDir(store, boardId), onChange, POLL_MS),
      pollDir(boardDir(store, boardId), onChange, POLL_MS),
      pollDir(boardsDir(store), () => void listBoards(store).then(setBoards), POLL_MS * 2),
    ];
    return () => stops.forEach((s) => s());
  }, [store, boardId, reload, setBoards]);

  // ── mutation plumbing ────────────────────────────────────────────────────────
  /** Run a write: apply the optimistic state first, then persist; reload on failure. */
  const commit = useCallback(
    async (optimistic: (b: BoardSnapshot) => BoardSnapshot, persist: (s: Store) => Promise<void>) => {
      if (!store || readOnly) return;
      const cur = boardRef.current;
      if (!cur) return;
      const next = optimistic(cur);
      boardRef.current = next;
      setBoard(next);
      setBoards((bs) => bs.map((b) => (b.id === next.meta.id ? next.meta : b)));
      inflight.current++;
      try {
        await persist(store);
      } catch (e: unknown) {
        cbs.current.onError(e instanceof Error ? `Could not save: ${e.message}` : 'Could not save');
        dirty.current = true;
      } finally {
        inflight.current--;
        if (inflight.current === 0 && dirty.current) {
          dirty.current = false;
          void reload(false);
        }
      }
    },
    [store, readOnly, reload, setBoard, setBoards],
  );

  const stamp = () => new Date().toISOString();

  // ── cards ────────────────────────────────────────────────────────────────────
  const addCard = useCallback(
    (columnId: string, title: string) => {
      const cur = boardRef.current;
      if (!cur) return;
      const last = cardsIn(cur.cards, columnId).at(-1);
      const card = newCard({ column: columnId, order: orderBetween(last?.order, undefined), by: cbs.current.by, title });
      return commit(
        (b) => ({ ...b, cards: [...b.cards, card] }),
        async (s) => {
          await writeCard(s, cur.meta.id, card);
        },
      );
    },
    [commit],
  );

  const updateCard = useCallback(
    (card: Card) => {
      const cur = boardRef.current;
      if (!cur) return;
      const next: Card = { ...card, by: cbs.current.by, updated: stamp() };
      return commit(
        (b) => ({ ...b, cards: b.cards.map((c) => (c.id === next.id ? next : c)) }),
        async (s) => {
          await writeCard(s, cur.meta.id, next);
        },
      );
    },
    [commit],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      const cur = boardRef.current;
      if (!cur) return;
      return commit(
        (b) => ({ ...b, cards: b.cards.filter((c) => c.id !== cardId) }),
        (s) => deleteCardOnDisk(s, cur.meta.id, cardId),
      );
    },
    [commit],
  );

  /** Move `cardId` into `columnId` at visual `index` (0 = top), among the other
   *  cards. `patch` folds field edits into the same write (one file, one save). */
  const moveCard = useCallback(
    (cardId: string, columnId: string, index: number, patch?: Partial<Card>) => {
      const cur = boardRef.current;
      if (!cur) return;
      const found = cur.cards.find((c) => c.id === cardId);
      if (!found) return;
      const card: Card = { ...found, ...patch, id: cardId };
      const others = cardsIn(cur.cards, columnId).filter((c) => c.id !== cardId);
      const i = Math.max(0, Math.min(index, others.length));
      if (card.column === columnId && !patch) {
        const currentIndex = others.filter((o) => byOrder(o, card) < 0).length;
        if (currentIndex === i) return; // already there
      }
      const before = others[i - 1]?.order;
      const after = others[i]?.order;
      let order = orderBetween(before, after);
      let renumbered: Card[] = [];
      if (needsRenumber([...others.map((o) => o.order), order])) {
        const seq = [...others.slice(0, i), { ...card }, ...others.slice(i)];
        renumbered = seq.map((c, n) => ({ ...c, order: n + 1 }));
        order = i + 1;
      }
      const moved: Card = { ...card, column: columnId, order, by: cbs.current.by, updated: stamp() };
      const changed = renumbered.length ? renumbered.filter((c) => c.id !== cardId) : [];
      const changedIds = new Set(changed.map((c) => c.id));
      return commit(
        (b) => ({
          ...b,
          cards: b.cards.map((c) => (c.id === cardId ? moved : changedIds.has(c.id) ? (changed.find((x) => x.id === c.id) as Card) : c)),
        }),
        async (s) => {
          await writeCard(s, cur.meta.id, moved);
          for (const c of changed) await writeCard(s, cur.meta.id, c);
        },
      );
    },
    [commit],
  );

  // ── columns ──────────────────────────────────────────────────────────────────
  const addColumn = useCallback(
    (name: string) => {
      const col = { id: newId(), name };
      return commit(
        (b) => ({ ...b, meta: { ...b.meta, columns: [...b.meta.columns, col], updated: stamp() } }),
        async (s) => {
          const cur = boardRef.current;
          if (cur) await writeBoardMeta(s, cur.meta);
        },
      );
    },
    [commit],
  );

  const renameColumn = useCallback(
    (columnId: string, name: string) =>
      commit(
        (b) => ({
          ...b,
          meta: { ...b.meta, columns: b.meta.columns.map((c) => (c.id === columnId ? { ...c, name } : c)), updated: stamp() },
        }),
        async (s) => {
          const cur = boardRef.current;
          if (cur) await writeBoardMeta(s, cur.meta);
        },
      ),
    [commit],
  );

  /** Delete a column; its cards move to the first remaining column (kept in order, appended). */
  const removeColumn = useCallback(
    (columnId: string) => {
      const cur = boardRef.current;
      if (!cur) return;
      const remaining = cur.meta.columns.filter((c) => c.id !== columnId);
      if (remaining.length === 0) return; // never delete the last column
      const target = remaining[0].id;
      const tail = cardsIn(cur.cards, target).at(-1)?.order ?? 0;
      const moved = cardsIn(cur.cards, columnId).map((c, n) => ({
        ...c,
        column: target,
        order: tail + n + 1,
        updated: stamp(),
      }));
      const movedIds = new Map(moved.map((c) => [c.id, c]));
      return commit(
        (b) => ({
          meta: { ...b.meta, columns: remaining, updated: stamp() },
          cards: b.cards.map((c) => movedIds.get(c.id) ?? c),
        }),
        async (s) => {
          for (const c of moved) await writeCard(s, cur.meta.id, c);
          const now = boardRef.current;
          if (now) await writeBoardMeta(s, now.meta);
        },
      );
    },
    [commit],
  );

  const moveColumn = useCallback(
    (columnId: string, index: number) =>
      commit(
        (b) => {
          const cols = b.meta.columns.filter((c) => c.id !== columnId);
          const col = b.meta.columns.find((c) => c.id === columnId);
          if (!col) return b;
          cols.splice(Math.max(0, Math.min(index, cols.length)), 0, col);
          return { ...b, meta: { ...b.meta, columns: cols, updated: stamp() } };
        },
        async (s) => {
          const cur = boardRef.current;
          if (cur) await writeBoardMeta(s, cur.meta);
        },
      ),
    [commit],
  );

  // ── boards ───────────────────────────────────────────────────────────────────
  const renameBoard = useCallback(
    (name: string) =>
      commit(
        (b) => ({ ...b, meta: { ...b.meta, name, updated: stamp() } }),
        async (s) => {
          const cur = boardRef.current;
          if (cur) await writeBoardMeta(s, cur.meta);
        },
      ),
    [commit],
  );

  const createBoard = useCallback(
    async (name: string) => {
      if (!store || readOnly) return;
      try {
        const meta = await createBoardOnDisk(store, name, cbs.current.by, false);
        setBoards((bs) => [...bs, meta]);
        cbs.current.onBoardChange(meta.id);
      } catch (e: unknown) {
        cbs.current.onError(e instanceof Error ? e.message : 'Could not create board');
      }
    },
    [store, readOnly, setBoards],
  );

  const deleteBoard = useCallback(
    async (id: string) => {
      if (!store || readOnly) return;
      const rest = boards.filter((b) => b.id !== id);
      setBoards(rest);
      if (id === boardId) {
        if (rest[0]) cbs.current.onBoardChange(rest[0].id);
        else setBoard(null);
      }
      try {
        await deleteBoardOnDisk(store, id);
      } catch (e: unknown) {
        cbs.current.onError(e instanceof Error ? e.message : 'Could not delete board');
      }
      if (rest.length === 0) {
        const meta = await createBoardOnDisk(store, 'My board', cbs.current.by, false);
        setBoards([meta]);
        cbs.current.onBoardChange(meta.id);
      }
    },
    [store, readOnly, boards, boardId, setBoard, setBoards],
  );

  return {
    boards,
    board,
    loading,
    readOnly,
    sortedCards: board ? [...board.cards].sort(byOrder) : [],
    addCard,
    updateCard,
    removeCard,
    moveCard,
    addColumn,
    renameColumn,
    removeColumn,
    moveColumn,
    renameBoard,
    createBoard,
    deleteBoard,
    refresh: () => reload(false),
  };
}
