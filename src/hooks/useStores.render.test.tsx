// @vitest-environment jsdom
//
// R3-548 regression: task mode has to RENDER, and that is not something the pure tests
// can see. The first version of this hook handed `App` a freshly-built `Store` object on
// every render; `App` compares `store !== prevStore` during render to reset its
// selection, so a new identity each time is a render-phase update that never converges —
// React gives up with "Too many re-renders" and the whole feature does not run. The pure
// resolver was green throughout.
//
// So this file renders the hook for real (jsdom + `react-dom/client`, both already in the
// tree) and asserts the two properties that failure violated: the render loop terminates,
// and the store keeps ONE identity across re-renders. `App`'s comparison is reproduced
// verbatim rather than described, because it is the thing under test.

import { act } from 'react';
import { useState } from 'react';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxMount } from '@immediately-run/sdk/mounts';
import type { TaskInput } from '@immediately-run/sdk/tasks';

const DIR = '/task/s1/dir';

let taskInput: TaskInput | null = null;
let mounts: SandboxMount[] = [];

const cancelTask = vi.fn();
vi.mock('@immediately-run/sdk/tasks', () => ({
  useTaskInput: () => taskInput,
  // `completeTask` is deliberately absent: nothing in this app imports it any more, and
  // a mock that offers it would let a regression re-introduce the call unnoticed.
  cancelTask: (...args: unknown[]) => cancelTask(...args),
}));
vi.mock('@immediately-run/sdk/mounts', () => ({
  useMounts: () => mounts,
  openSettings: vi.fn(),
  createSpace: vi.fn(),
  requestMount: vi.fn(),
  mount: vi.fn(),
}));

const { useStores, storeKey } = await import('./useStores');
const { useBoard } = await import('./useBoard');
const { default: React } = await import('react');

/** `App.tsx`'s own shape: a render-phase reset keyed on the store's IDENTITY. */
function Probe({ onRender }: { onRender: (store: ReturnType<typeof useStores>['store']) => void }) {
  const stores = useStores();
  const { store } = stores;
  const [prevStore, setPrevStore] = useState(store);
  const [, setBoardId] = useState<string | null>(null);
  if (store !== prevStore) {
    setPrevStore(store);
    setBoardId(null);
  }
  onRender(store);
  return React.createElement('div', null, store ? storeKey(store) : 'none');
}

describe('useStores in task mode renders (R3-548)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    taskInput = { task: 'open-declared', params: { dir: DIR } };
    mounts = [{ path: '/app', type: 'repo' }, { path: DIR, type: 'chroot', id: DIR, mode: 'ro', name: 'Q3 plan' }];
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
  });

  it('converges — a fresh store object every render would be "Too many re-renders"', async () => {
    const seen: (ReturnType<typeof useStores>['store'] | null)[] = [];
    const root = createRoot(container);

    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });
    // A SECOND render is required to exercise this at all, and that is not a detail:
    // `useState(store)` seeds `prevStore` with the first render's value, so the
    // comparison can only disagree once a later render produces a different object. A
    // one-render version of this case passes even with the latch removed — measured.
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });

    // The bug's signature was an unbounded render count; the fix's is a small one.
    expect(seen.length).toBeLessThan(10);
    const resolved = seen.filter(Boolean);
    expect(resolved.length).toBeGreaterThan(0);
    // ONE identity: `App`'s comparison — and `useBoard`'s effect deps — key on it.
    expect(new Set(resolved).size).toBe(1);
    expect(resolved[0]).toMatchObject({ root: DIR, mode: 'ro', kind: 'task', name: 'Q3 plan' });
    expect(container.textContent).toBe(`task:${DIR}`);

    await act(async () => root.unmount());
  });

  it('a re-render with a NEW mounts array keeps the same store — the latch, not luck', async () => {
    const seen: (ReturnType<typeof useStores>['store'] | null)[] = [];
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });

    // The host re-announces mounts as a fresh array; nothing about the delegation changed.
    mounts = mounts.map((m) => ({ ...m }));
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });

    expect(new Set(seen.filter(Boolean)).size).toBe(1);
    await act(async () => root.unmount());
  });

  it('…and keeps it when the delegation disappears, instead of failing an open board', async () => {
    const seen: (ReturnType<typeof useStores>['store'] | null)[] = [];
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });
    const opened = seen.filter(Boolean).at(-1);

    // A sign-out tears down every mount (`MountRemoveReason`). Without the latch this is
    // where the grace timer re-arms and cancels a task the reader is still using.
    mounts = [];
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: (s) => void seen.push(s) }));
    });

    expect(seen.at(-1)).toBe(opened);
    await act(async () => root.unmount());
  });
});

// `storeKey` is the other thing R3-548 changed, and it is the one that decides whether a
// DELEGATED board can be filed as — and re-opened as — the user's own. It lives in this
// file because it is exported from `useStores.ts`, whose SDK imports are mocked above.
describe('storeKey keeps a delegated board out of the private slot (R3-548)', () => {
  it('a task store gets its own key, never the `private` fallback', () => {
    const key = storeKey({ root: DIR, mode: 'ro', kind: 'task' });
    // `store.spaceId ?? 'private'` would return 'private' here — the user's own slot in
    // `config.lastBoard`, so the caller's board would be re-opened as theirs next boot.
    expect(key).not.toBe('private');
    expect(key).toBe(`task:${DIR}`);
  });

  it('…and two different delegations are two different keys', () => {
    expect(storeKey({ root: DIR, mode: 'ro', kind: 'task' })).not.toBe(
      storeKey({ root: '/task/s2/dir', mode: 'ro', kind: 'task' }),
    );
  });

  it('the ordinary kinds are unchanged', () => {
    expect(storeKey({ root: '/settings/x', mode: 'rw', kind: 'settings' })).toBe('private');
    expect(storeKey({ root: '/mnt/9f2a', mode: 'rw', kind: 'space', spaceId: 'space:abc' })).toBe('space:abc');
  });
});

describe('a task boot persists nothing (R3-548)', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    taskInput = { task: 'open-declared', params: { dir: DIR } };
    mounts = [{ path: DIR, type: 'chroot', id: DIR, mode: 'ro' }];
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('rememberBoard is a no-op, so no delegated board id is ever written', async () => {
    // Captured through a ref rather than a closure variable: reassigning an outer
    // binding during render is a side effect, and the lint rule that says so is right
    // even in a test.
    const captured: { api?: ReturnType<typeof useStores> } = {};
    function Capture() {
      const api = useStores();
      React.useEffect(() => {
        captured.api = api;
      });
      return null;
    }
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Capture));
    });

    // The config write it would reach lives in the private store this callee never
    // opened; the assertion is that calling it is inert rather than merely unreached.
    act(() => captured.api!.rememberBoard('task:whatever', 'board-1'));
    await act(async () => undefined);
    expect(captured.api!.mode).toBe('task');
    expect(captured.api!.config.lastBoard ?? {}).toEqual({});

    await act(async () => root.unmount());
  });
});

// R3-548 round 2 — the gate's post-await checkpoints, which round 1 added and round 2
// found untested. Every other case in this file has the task input present from render
// 1, so `if (isCallee) return` fires immediately and the async boot never runs: the
// checkpoints are exactly the path those cases cannot reach. Here the input arrives
// LATE, which is the sequence they exist for (the host sends `task-input` from an effect
// once the bundle is interactive; `useTaskInput` seeds from state and corrects in its own
// effect).
describe('a boot already in flight when the input lands (R3-548)', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    taskInput = null; // an ordinary boot, as far as the first render can tell
    mounts = [];
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('stops the space mount and the config write, not merely the final setState', async () => {
    // The boot has to be PARKED on an await when the input lands, or there is no race to
    // test: a boot that already finished has nothing left to stop, and a version of this
    // case that re-rendered after completion passed even with the checkpoints deleted.
    // So `openPrivateStore` hands back a promise this test resolves by hand.
    const calls: string[] = [];
    let releasePrivate!: (s: { root: string; mode: 'rw'; kind: 'settings' }) => void;
    const parked = new Promise<{ root: string; mode: 'rw'; kind: 'settings' }>((res) => {
      releasePrivate = res;
    });

    const store = await import('../lib/store');
    const spies = [
      vi.spyOn(store, 'openPrivateStore').mockImplementation(() => {
        calls.push('openPrivateStore');
        return parked;
      }),
      vi.spyOn(store, 'readJson').mockImplementation(async () => {
        calls.push('readJson');
        return { spaceId: 'space:abc' } as never;
      }),
      vi.spyOn(store, 'openRememberedSpace').mockImplementation(async () => {
        calls.push('openRememberedSpace');
        return null;
      }),
      vi.spyOn(store, 'writeJson').mockImplementation(async () => {
        calls.push('writeJson');
      }),
    ];

    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: () => undefined }));
    });
    // Parked: the ordinary boot has asked for the private store and is waiting on it.
    expect(calls).toEqual(['openPrivateStore']);

    // The input lands WHILE it waits. `isCallee` is this effect's dependency, so the flip
    // re-runs it: React tears the previous run down (setting `cancelled`) before the new
    // body returns early — and the parked boot resumes into the checkpoints.
    taskInput = { task: 'open-declared', params: { dir: DIR } };
    mounts = [{ path: DIR, type: 'chroot', id: DIR, mode: 'ro' }];
    await act(async () => {
      root.render(React.createElement(Probe, { onRender: () => undefined }));
    });
    await act(async () => {
      releasePrivate({ root: '/settings/data', mode: 'rw', kind: 'settings' });
      await parked;
    });

    // Nothing after the first await ran. Without the checkpoints this reads
    // ['openPrivateStore', 'readJson', 'openRememberedSpace', 'writeJson'] — the user's
    // shared space mounted, and their config rewritten, inside a callee.
    expect(calls).toEqual(['openPrivateStore']);
    for (const spy of spies) spy.mockRestore();
    await act(async () => root.unmount());
  });
});

// R3-548 round 2 — the give-up path, which round 1 shipped as two `cancelTask()` calls
// that could never run: `listBoards` and `readBoard` are total (they catch and fall back),
// so an unreadable delegated directory arrived as an empty one and nothing settled the
// task. `useBoard` now probes the root with the one read that is allowed to fail.
describe('a delegated directory that cannot be read settles the task (R3-548)', () => {
  let host: HTMLDivElement;
  const store = (root: string) => ({ root, mode: 'ro' as const, kind: 'task' as const });

  const Board = ({ root }: { root: string }) => {
    useBoard({
      store: store(root),
      boardId: null,
      onBoardChange: () => undefined,
      by: 'someone',
      onRemoteUpdate: () => undefined,
      onError: () => undefined,
    });
    return null;
  };

  beforeEach(() => {
    taskInput = { task: 'open-declared', params: { dir: DIR } };
    mounts = [{ path: DIR, type: 'chroot', id: DIR, mode: 'ro' }];
    cancelTask.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());

  it('cancels when the root cannot be read', async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(React.createElement(Board, { root: '/no/such/delegated/dir' }));
    });
    expect(cancelTask).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('does NOT cancel when it can — an EMPTY directory is content, not failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    try {
      const root = createRoot(host);
      await act(async () => {
        root.render(React.createElement(Board, { root: dir }));
      });
      // Nothing to show, and nothing to settle: the reader sees the empty state and the
      // host's dismiss ends the slot.
      expect(cancelTask).not.toHaveBeenCalled();
      await act(async () => root.unmount());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
