// The board as a task callee (R3-548, BUNDLE_EMBEDDING §4b.2).
//
// Another app found a directory whose marker names `open-declared` with this app, and
// invoked the contract. The host attenuated that against the CALLER's own grants, minted
// a task-scoped chroot over the directory, mounted it for us, and delivered the task
// input. So everything below is downstream of authority we never asked for and cannot
// widen: the mount IS the grant (UI_AS_APPS_SPEC §5.7).
//
// Pure — no fs, no host reads — so the whole resolution is testable without a host.

import type { SandboxMount } from '@immediately-run/sdk/mounts';
import type { TaskInput } from '@immediately-run/sdk/tasks';
import type { Store } from './store';

/** The contract this app opts into (`package.json` → `immediately.run.opens`). */
export const OPEN_DECLARED_TASK = 'open-declared';
/** The param carrying the delegated directory. */
export const DIR_PARAM = 'dir';

/**
 * The store to use for an `open-declared` invocation, or `null` when this boot is not
 * one (no input, another task, or the delegated mount has not arrived).
 *
 * `params.dir` reaches a callee as a STRING, already rewritten to the callee's own path
 * space: the host's `rewriteCapFileParams` replaces the cap with
 * `delegationFilePath(slot, 'dir', relName)`, and a directory delegation has an empty
 * `relName`, so the value IS the mount point `mintDelegations` published
 * (`/task/<slot>/dir`). We therefore match the announced mount by EXACT path.
 *
 * **Deviation from grove's `resolveOpenWiki`, deliberately.** That resolver matches the
 * mount path by `/<paramKey>` suffix and falls back to "the only foreign mount", because
 * it must also serve a repo-load dispatch that has no task input at all. Neither shape is
 * safe here. This app routinely holds OTHER foreign mounts — its private settings store,
 * and a shared space the user granted it — so "the only foreign mount" is not a
 * one-candidate situation, and picking wrong would write a stranger's board into the
 * user's own space. Matching the path the host put in our own params is exact, needs no
 * private path grammar, and fails closed: a `dir` naming a path no mount announces
 * returns `null` rather than the nearest thing to hand.
 */
export function storeFromTaskInput(input: TaskInput | null, mounts: readonly SandboxMount[]): Store | null {
  if (!input || input.task !== OPEN_DECLARED_TASK) return null;
  const dir = input.params[DIR_PARAM];
  if (typeof dir !== 'string' || dir === '') return null;
  const hit = mounts.find((m) => m.path === dir);
  if (!hit) return null;
  return {
    // The delegated directory IS the board root — no per-app sub-folder. A space is
    // shared with other apps and gets a `kanban-board/` corner of its own; this chroot
    // was opened as a board, by a caller that already decided what it holds.
    root: hit.path,
    // Read-only is the mount's word, not ours: an `ro` delegation is a legitimate way to
    // hand someone a board, and the board renders with editing off rather than failing.
    mode: hit.mode === 'ro' ? 'ro' : 'rw',
    kind: 'task',
    ...(hit.name !== undefined ? { name: hit.name } : {}),
    ...(hit.bundle !== undefined ? { bundle: hit.bundle } : {}),
  };
}
