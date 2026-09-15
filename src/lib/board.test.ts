import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, listBoards, readBoard } from './board';
import type { Store } from './store';

// R3-548's load-bearing claim about the read layer: a `'task'` store is a Store like any
// other, so the SAME bytes read the same through it. If `board.ts` ever branched on
// `store.kind`, a delegated board would render differently from the one the caller sees
// in their own app — and the kind is the only thing R3-548 adds to `Store`.
//
// Driven over a real temp directory through `node:fs`, which is the same `fs.promises`
// surface `board.ts` calls on the host (see vitest.config.ts on why the dev bridge is
// deliberately out of the way). The boards are written by `createBoard` — the app's own
// producer — never by a hand-built directory tree, so the layout under test is the one
// the app actually makes.
describe('board.ts reads the same snapshot whatever kind of store points at it (R3-548)', () => {
  let root: string;
  const storeOfKind = (kind: Store['kind'], mode: Store['mode'] = 'rw'): Store => ({ root, mode, kind });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kanban-board-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('a task store reads a board a settings store wrote, byte for byte', async () => {
    const settings = storeOfKind('settings');
    const meta = await createBoard(settings, 'Q3 plan', 'alice', true);

    const task = storeOfKind('task');
    const viaSettings = await readBoard(settings, meta.id);
    const viaTask = await readBoard(task, meta.id);

    expect(viaTask).not.toBeNull();
    expect(viaTask).toEqual(viaSettings);
    expect(viaTask?.cards.length).toBeGreaterThan(0); // the seed actually wrote cards
  });

  it('…and lists it the same way', async () => {
    const written = await createBoard(storeOfKind('space'), 'Shared board', 'bob');
    expect(await listBoards(storeOfKind('task'))).toEqual([written]);
  });

  it('a read-only task store still reads — `ro` is about writing', async () => {
    const meta = await createBoard(storeOfKind('settings'), 'Handed over', 'alice');
    const snap = await readBoard(storeOfKind('task', 'ro'), meta.id);
    expect(snap?.meta.name).toBe('Handed over');
  });

  it('an empty delegated directory reads as null, not as a throw', async () => {
    // What a callee gets when the caller delegated a directory with no board in it: the
    // app shows its empty state, and the task is still `opened`.
    expect(await readBoard(storeOfKind('task'), 'no-such-board')).toBeNull();
    expect(await listBoards(storeOfKind('task'))).toEqual([]);
  });
});
