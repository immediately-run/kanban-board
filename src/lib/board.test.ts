import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBoard, listBoards, readBoard } from './board';
import { assertRootReadable, type Store } from './store';

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

// R3-548 round 2: the read layer is TOTAL, and that is why a delegated directory needs
// one read that is not. `listBoards` catches `readdir` and returns `[]`; `readBoard`
// bottoms out in `readJson`, which falls back. So for a task boot, "empty" and
// "unreadable" arrive identically — and the app would render "No boards here yet",
// settle nothing, and leave the caller to the 600s liveness bound. These cases pin the
// asymmetry rather than the implementation: if `assertRootReadable` ever grows a catch,
// the first one fails.
describe('a delegated directory that cannot be read is distinguishable from an empty one (R3-548)', () => {
  const missing = (root: string): Store => ({ root, mode: 'ro', kind: 'task' });

  it('assertRootReadable THROWS on a root that is not there', async () => {
    await expect(assertRootReadable(missing('/no/such/delegated/dir'))).rejects.toBeDefined();
  });

  it('…while every other read answers the same as it would for an empty directory', async () => {
    const gone = missing('/no/such/delegated/dir');
    // This is the whole finding: identical answers for two different situations.
    await expect(listBoards(gone)).resolves.toEqual([]);
    await expect(readBoard(gone, 'any')).resolves.toBeNull();
  });

  it('…and resolves for a real one, so the probe is not just "always throws"', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kanban-readable-'));
    try {
      await expect(assertRootReadable(missing(root))).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// R3-549: the projection branch is ONE branch, and it is total — a store that carries
// bundle facts (any federated view) but no resolved projection takes today's native
// path byte for byte. The app holds such stores whenever a delegated bundle's marker
// has no `projection` (or one this consumer cannot resolve).
describe('a bundle-fact store without a projection reads natively (R3-549)', () => {
  it('readBoard and listBoards answer exactly as a plain store over the same bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kanban-board-'));
    try {
      const plain: Store = { root, mode: 'rw', kind: 'settings' };
      const meta = await createBoard(plain, 'Native board', 'alice', true);

      const withLayout: Store = {
        root,
        mode: 'rw',
        kind: 'space',
        // A layout the host could have handed over — but no `projection` on the store.
        bundle: {
          kind: 'wiki',
          layout: {
            version: 1,
            recordSets: { 'roadmap-items': { dir: '/roadmap', select: 'R3-*.mdx', record: 'mdx-frontmatter' } },
          },
        },
      };
      expect(await readBoard(withLayout, meta.id)).toEqual(await readBoard(plain, meta.id));
      expect(await listBoards(withLayout)).toEqual(await listBoards(plain));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
