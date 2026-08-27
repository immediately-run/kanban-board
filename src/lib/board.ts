// Board data model + on-disk layout.
//
//   <store>/boards/<boardId>/board.json          name, column order + names
//   <store>/boards/<boardId>/cards/<cardId>.json one card per file
//
// One card = one file, so two members moving different cards at the same time
// never clobber each other (last-write-wins only ever applies to ONE card).
import fs from 'fs';
import { ensureDir, listFiles, newId, readJson, removeFile, writeJson, type Store } from './store';

export interface Column {
  id: string;
  name: string;
}

export interface BoardMeta {
  id: string;
  name: string;
  columns: Column[];
  created: string;
  updated: string;
}

export interface Card {
  id: string;
  title: string;
  /** Markdown-ish plain text; rendered as paragraphs. */
  description: string;
  /** Column id. */
  column: string;
  /** Fractional index inside the column; lower sorts first. */
  order: number;
  labels: string[];
  /** ISO date (YYYY-MM-DD) or null. */
  due: string | null;
  /** Login of whoever last touched it ("someone" when the host has no login). */
  by: string;
  created: string;
  updated: string;
}

export interface BoardSnapshot {
  meta: BoardMeta;
  cards: Card[];
}

// ── paths ──────────────────────────────────────────────────────────────────────

const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/');

export const boardsDir = (store: Store) => join(store.root, 'boards');
export const boardDir = (store: Store, boardId: string) => join(boardsDir(store), boardId);
export const boardFile = (store: Store, boardId: string) => join(boardDir(store, boardId), 'board.json');
export const cardsDir = (store: Store, boardId: string) => join(boardDir(store, boardId), 'cards');
export const cardFile = (store: Store, boardId: string, cardId: string) =>
  join(cardsDir(store, boardId), `${cardId}.json`);

// ── ordering ───────────────────────────────────────────────────────────────────

/** Fractional index strictly between two neighbours (either may be absent). */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return (after as number) - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** True when the gaps in a column have collapsed enough that we should renumber. */
export function needsRenumber(orders: number[]): boolean {
  const s = [...orders].sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] < 1e-6) return true;
  return false;
}

export const byOrder = (a: Card, b: Card) =>
  a.order - b.order || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

export const cardsIn = (cards: Card[], columnId: string) =>
  cards.filter((c) => c.column === columnId).sort(byOrder);

// ── validation ─────────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === 'string';

function asCard(raw: unknown, id: string): Card | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isStr(r.column)) return null;
  return {
    id,
    title: isStr(r.title) ? r.title : '',
    description: isStr(r.description) ? r.description : '',
    column: r.column,
    order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
    labels: Array.isArray(r.labels) ? r.labels.filter(isStr) : [],
    due: isStr(r.due) && r.due ? r.due : null,
    by: isStr(r.by) && r.by ? r.by : 'someone',
    created: isStr(r.created) ? r.created : new Date(0).toISOString(),
    updated: isStr(r.updated) ? r.updated : new Date(0).toISOString(),
  };
}

function asMeta(raw: unknown, id: string): BoardMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cols = Array.isArray(r.columns)
    ? r.columns
        .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
        .filter((c) => isStr(c.id))
        .map((c) => ({ id: c.id as string, name: isStr(c.name) ? c.name : 'Untitled' }))
    : [];
  return {
    id,
    name: isStr(r.name) && r.name ? r.name : 'Untitled board',
    columns: cols,
    created: isStr(r.created) ? r.created : new Date(0).toISOString(),
    updated: isStr(r.updated) ? r.updated : new Date(0).toISOString(),
  };
}

// ── reads ──────────────────────────────────────────────────────────────────────

export async function listBoards(store: Store): Promise<BoardMeta[]> {
  let ids: string[] = [];
  try {
    ids = (await fs.promises.readdir(boardsDir(store))).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
  const metas = await Promise.all(ids.map((id) => readBoardMeta(store, id)));
  return metas
    .filter((m): m is BoardMeta => m !== null)
    .sort((a, b) => a.created.localeCompare(b.created) || a.name.localeCompare(b.name));
}

export async function readBoardMeta(store: Store, boardId: string): Promise<BoardMeta | null> {
  return asMeta(await readJson<unknown>(boardFile(store, boardId), null), boardId);
}

/**
 * Read every card of a board. A file that is mid-write by another member (or
 * momentarily unparsable) falls back to `previous`'s copy of that card rather
 * than vanishing for one poll cycle.
 */
export async function readCards(store: Store, boardId: string, previous: Card[] = []): Promise<Card[]> {
  const names = await listFiles(cardsDir(store, boardId), '.json');
  const prev = new Map(previous.map((c) => [c.id, c]));
  const cards = await Promise.all(
    names.map(async (n) => {
      const id = n.slice(0, -'.json'.length);
      const card = asCard(await readJson<unknown>(cardFile(store, boardId, id), null), id);
      return card ?? prev.get(id) ?? null;
    }),
  );
  return cards.filter((c): c is Card => c !== null);
}

export async function readBoard(store: Store, boardId: string, previous?: BoardSnapshot): Promise<BoardSnapshot | null> {
  const meta = (await readBoardMeta(store, boardId)) ?? previous?.meta ?? null;
  if (!meta) return null;
  const cards = await readCards(store, boardId, previous?.cards ?? []);
  return { meta, cards };
}

// ── writes ─────────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

// Writes persist EXACTLY the in-memory record (callers stamp `updated`), so a
// member's own write never differs from its optimistic state — otherwise the
// poll would report the writer's own change as "updated from the space".
export async function writeBoardMeta(store: Store, meta: BoardMeta): Promise<void> {
  const { id, ...body } = meta;
  void id;
  await writeJson(boardFile(store, id), body);
}

export async function writeCard(store: Store, boardId: string, card: Card): Promise<void> {
  const { id, ...body } = card;
  void id;
  await writeJson(cardFile(store, boardId, id), body);
}

export async function deleteCard(store: Store, boardId: string, cardId: string): Promise<void> {
  await removeFile(cardFile(store, boardId, cardId));
}

export async function deleteBoard(store: Store, boardId: string): Promise<void> {
  try {
    await fs.promises.rm(boardDir(store, boardId), { recursive: true, force: true });
  } catch {
    // Fallback for backends without recursive rm: unlink what we can.
    for (const n of await listFiles(cardsDir(store, boardId))) await removeFile(`${cardsDir(store, boardId)}/${n}`);
    await removeFile(boardFile(store, boardId));
    try {
      await fs.promises.rmdir(cardsDir(store, boardId));
      await fs.promises.rmdir(boardDir(store, boardId));
    } catch {
      /* leave the empty dir */
    }
  }
}

export function newCard(partial: Partial<Card> & { column: string; order: number; by: string }): Card {
  const t = now();
  return {
    id: newId(),
    title: '',
    description: '',
    labels: [],
    due: null,
    created: t,
    updated: t,
    ...partial,
  };
}

export const DEFAULT_COLUMNS = ['To do', 'Doing', 'Done'];

/** Create a board with the three default columns. `sample` adds four starter cards. */
export async function createBoard(store: Store, name: string, by: string, sample = false): Promise<BoardMeta> {
  const t = now();
  const meta: BoardMeta = {
    id: newId(),
    name,
    columns: DEFAULT_COLUMNS.map((n) => ({ id: newId(), name: n })),
    created: t,
    updated: t,
  };
  await ensureDir(cardsDir(store, meta.id));
  await writeBoardMeta(store, meta);
  if (sample) {
    const [todo, doing, done] = meta.columns.map((c) => c.id);
    const samples: Array<Partial<Card> & { column: string; order: number; by: string }> = [
      {
        column: todo,
        order: 1,
        by,
        title: 'Drag me to another column',
        description: 'Grab the handle on the right (or use the arrow menu) and drop this card wherever it belongs.',
        labels: ['tip'],
      },
      {
        column: todo,
        order: 2,
        by,
        title: 'Open a card to edit it',
        description: 'Title, description, labels and a due date live in the card. Everything is saved as you go.',
        labels: ['tip'],
        due: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      },
      {
        column: doing,
        order: 1,
        by,
        title: 'Share this board with a team',
        description:
          'Use “Share” in the top bar to put the board in a shared space. Every card is its own file, so people can move cards at the same time without overwriting each other.',
        labels: ['sharing', 'tip'],
      },
      {
        column: done,
        order: 1,
        by,
        title: 'Create the board',
        description: 'This one is finished. Nice.',
        labels: ['done'],
      },
    ];
    for (const s of samples) await writeCard(store, meta.id, newCard(s));
  }
  return meta;
}

// ── labels ─────────────────────────────────────────────────────────────────────

/** Stable 0..5 hue bucket for a label so the same word gets the same colour everywhere. */
export function labelHue(label: string): number {
  let h = 0;
  for (const ch of label.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

export function parseLabels(text: string): string[] {
  return Array.from(new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)));
}

/** Days from today to `due` (negative = overdue). `null` when no due date. */
export function dueInDays(due: string | null): number | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 864e5);
}
