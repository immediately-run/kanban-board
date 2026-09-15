import { describe, expect, it } from 'vitest';
import type { SandboxMount, SandboxMountBundle } from '@immediately-run/sdk/mounts';
import type { TaskInput } from '@immediately-run/sdk/tasks';
import { OPEN_DECLARED_TASK, storeFromTaskInput } from './taskStore';

// The value under test is `params.dir`, and its producer is the HOST, not this repo and
// not a package this repo depends on: `rewriteCapFileParams` replaces the dir cap with
// `delegationFilePath(slot, 'dir', relName)`, and a directory delegation has an empty
// `relName`, so the value is `delegationMountPath(slot, 'dir')` — the same string
// `mintDelegations` publishes the mount at. Both are
// `immediately-run-site-main/src/editor/task/taskDelegation.ts` (:15-16 and :99-108).
//
// DECLARED GAP (ways_of_working §4): that producer cannot be called from here — it is
// host code in another repo — so the path below spells its formula rather than calling
// it. What the tests then get right by construction is the part that actually matters
// and that a hand-typed pair would get wrong: the mount path and the param are ONE
// value, from one expression, so a test cannot pass by agreeing with itself about two
// separately typed strings. The `TaskInput` shape itself is pinned at compile time by
// the SDK's own exported type, and matches the object the SDK's `src/tasks.test.ts`
// asserts in 'registers the task-input listener EAGERLY: an input delivered before any
// task API call is kept' (`{ task: 'edit-file', params: { file: 'x' } }`).
const delegatedDir = (slot: string) => `/task/${slot}/dir`;

const DIR = delegatedDir('s1');

const input = (params: Record<string, unknown>, task = OPEN_DECLARED_TASK): TaskInput => ({ task, params });

const mount = (over: Partial<SandboxMount> = {}): SandboxMount => ({
  path: DIR,
  type: 'chroot',
  id: DIR,
  ...over,
});

/** The mounts an ordinary boot of this app already holds, which is why "the only
 *  foreign mount" is not a safe way to find the delegated one. */
const OTHERS: SandboxMount[] = [
  { path: '/app', type: 'repo' },
  { path: '/settings/kanban-board', type: 'settings', mode: 'rw' },
  { path: '/mnt/9f2a', type: 'firestore', id: 'space:abc', name: 'Team space', mode: 'rw' },
];

describe('storeFromTaskInput (R3-548)', () => {
  it('returns a task store for the delegated mount, carrying its mode and bundle', () => {
    // A real `SandboxMountBundle`, typed by the SDK rather than cast past it — the
    // point of carrying it through is that R3-549 can switch on `layout`.
    const bundle: SandboxMountBundle = { kind: 'board', layout: { version: 1, recordSets: {} } };
    const store = storeFromTaskInput(input({ dir: DIR }), [...OTHERS, mount({ name: 'Q3 plan', mode: 'rw', bundle })]);
    expect(store).toEqual({ root: DIR, mode: 'rw', kind: 'task', name: 'Q3 plan', bundle });
  });

  it('is read-only when the mount says so — the mount is the grant, not our guess', () => {
    const store = storeFromTaskInput(input({ dir: DIR }), [mount({ mode: 'ro' })]);
    expect(store?.mode).toBe('ro');
  });

  it('no task input is an ordinary boot, not a callee', () => {
    expect(storeFromTaskInput(null, [mount()])).toBeNull();
  });

  it('another task is not ours to answer', () => {
    expect(storeFromTaskInput(input({ dir: DIR }, 'edit-file'), [mount()])).toBeNull();
  });

  it('a dir naming a path no mount announces is null, and does not throw', () => {
    // The delegation never arrived (or arrived at a path we were not told about).
    // Failing closed is the point: the caller asked for THEIR folder.
    expect(storeFromTaskInput(input({ dir: '/task/s9/dir' }), [...OTHERS, mount()])).toBeNull();
    expect(storeFromTaskInput(input({ dir: DIR }), OTHERS)).toBeNull();
  });

  it('never falls back to the only other mount, or to the app itself', () => {
    // The failure this rules out: writing a stranger's board into the user's own space,
    // or into `/app`, because it was the nearest thing to hand.
    expect(storeFromTaskInput(input({ dir: DIR }), [{ path: '/mnt/9f2a', type: 'firestore', id: 'space:abc' }])).toBeNull();
    expect(storeFromTaskInput(input({ dir: DIR }), [{ path: '/app', type: 'repo' }])).toBeNull();
  });

  it('a missing, empty or non-string dir is null', () => {
    expect(storeFromTaskInput(input({}), [mount()])).toBeNull();
    expect(storeFromTaskInput(input({ dir: '' }), [mount()])).toBeNull();
    expect(storeFromTaskInput(input({ dir: { mountId: 'x', relPath: '' } }), [mount()])).toBeNull();
  });

  it('matches the WHOLE path, not a prefix or a suffix of it', () => {
    // `/task/s1/dir` must not be answered by `/task/s1/dir-other` or by `/other/dir`.
    expect(storeFromTaskInput(input({ dir: DIR }), [mount({ path: `${DIR}-other` })])).toBeNull();
    expect(storeFromTaskInput(input({ dir: DIR }), [mount({ path: '/other/dir' })])).toBeNull();
  });
});
