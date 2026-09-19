// Boot the private store, re-open a remembered shared space, and expose the
// share / create / leave actions. The private store is opened FIRST and kept
// (see store.ts on why a later openSettings() would resolve differently).
//
// …UNLESS this boot is a task invocation (R3-548). A callee's store is the directory
// the caller delegated, and the private/shared pair must not exist beside it: one board
// id, two stores, and the `lastBoard` map would cross them. So the task branch is a
// GATE on the same boot, not a second boot path — `App.tsx` has one store to render.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMounts } from '@immediately-run/sdk/mounts';
import { cancelTask, useTaskInput } from '@immediately-run/sdk/tasks';
import {
  createSharedStore,
  openPrivateStore,
  openRememberedSpace,
  pickSharedStore,
  readJson,
  writeJson,
  type Store,
} from '../lib/store';
import { resolveProjectedStore } from '../lib/projection';
import { OPEN_DECLARED_TASK, storeFromTaskInput } from '../lib/taskStore';

/** How long a callee waits for its delegated mount before giving up. Long enough for
 *  the host's mount announcement to land after the overlay mounts, short enough that a
 *  reader is not left looking at a blank board until the §5.7.1 liveness bound fires. */
const MOUNT_GRACE_MS = 5_000;

/** Sub-folder inside a shared space, so a space used by several apps stays tidy. */
const SHARED_SUB = 'kanban-board';

export interface AppConfig {
  spaceId?: string;
  spaceName?: string;
  /** Last opened board per store ("private" or the spaceId). */
  lastBoard?: Record<string, string>;
  /** Shown as the card's "by" when the host gives the app no login (stage apps). */
  displayName?: string;
}

export interface StoresState {
  ready: boolean;
  privateStore: Store | null;
  shared: Store | null;
  config: AppConfig;
  /** Fatal boot error (no private store at all). */
  error: string | null;
}

export type ShareOutcome = 'ok' | 'cancelled' | 'error';

const configPath = (priv: Store) => `${priv.root}/config.json`;

export function useStores() {
  const [state, setState] = useState<StoresState>({
    ready: false,
    privateStore: null,
    shared: null,
    config: {},
    error: null,
  });
  const [lastError, setLastError] = useState<string | null>(null);
  const [taskFailed, setTaskFailed] = useState(false);

  // A callee is identified by its task input, never by "there is a foreign mount": the
  // app holds foreign mounts in the ordinary case too (its settings store, a granted
  // space). No input means this is the ordinary boot.
  const taskInput = useTaskInput();
  const isCallee = taskInput?.task === OPEN_DECLARED_TASK;
  // Memoized so the empty case keeps one identity: the projection effect below keys on
  // `mounts`, and a fresh `[]` per render would re-run it every frame.
  const liveMounts = useMounts();
  const mounts = useMemo(() => liveMounts ?? [], [liveMounts]);
  const resolved = storeFromTaskInput(taskInput, mounts);

  // THE LATCH, and it is load-bearing twice over.
  //
  // `storeFromTaskInput` is pure and returns a FRESH object each render. Handed to
  // `App.tsx` that way it never converges: `App` compares `store !== prevStore` during
  // render to reset its selection, so a new identity every render is an infinite
  // render-phase update — React gives up with "Too many re-renders" and task mode does
  // not run at all. `useBoard` keys its boot effect on the same identity, so it would
  // also re-run the list-and-seed on every render.
  //
  // And once a delegation has resolved it is FINAL for the life of this instance, which
  // is what stops the grace timer below re-arming: the mount set can go empty later (a
  // sign-out tears every mount down, `MountRemoveReason`), and without the latch that
  // would replace an open board with a failure message and cancel a task the reader is
  // still using. Grove latches the same way and for the same reason
  // (`useOpenWikiBoot.ts` — "the module IS the latch").
  //
  // The latch is STATE, not a ref: a ref read during render is exactly what
  // `react-hooks/refs` forbids, and the value is needed for rendering. This is the
  // documented adjust-state-during-render shape (the same one `App.tsx` uses to reset
  // its selection), and it converges after one extra render because the condition is
  // false once something is latched.
  const [taskStore, setTaskStore] = useState<Store | null>(null);
  if (resolved && !taskStore) setTaskStore(resolved);

  // ── R3-549: the projected store for a marker-only board bundle ────────────────
  //
  // A delegated bundle whose marker carries a `projection` reads its records through the
  // bundle's declared `bundle:` view — a SECOND mount the host announces (carrying the
  // target's pruned layout, G-BE-19). Deriving that store is async (a marker read) and
  // may need a mounts update (the view can land after the delegation), so it lives in an
  // effect and LATCHES exactly like `taskStore` above: once a projection has resolved it
  // is final for the life of this instance, and `App`'s `store !== prevStore` reset sees
  // one identity change, not one per render.
  const [projectedStore, setProjectedStore] = useState<Store | null>(null);
  const [projectionNative, setProjectionNative] = useState(false);
  const [bootNotices, setBootNotices] = useState<string[]>([]);
  useEffect(() => {
    if (!taskStore || projectedStore || projectionNative) return;
    let cancelled = false;
    (async () => {
      const r = await resolveProjectedStore(taskStore, mounts);
      if (cancelled) return;
      if (r.diagnostics.length > 0) setBootNotices(r.diagnostics.map((d) => d.message));
      if (r.kind === 'projected') setProjectedStore(r.store);
      else if (r.kind === 'native') setProjectionNative(true);
      // 'waiting': the view mount has not been announced yet — the effect re-runs when
      // `mounts` changes, and the grace timer below bounds the wait.
    })().catch((e: unknown) => {
      // The derivation is total by design (every read falls back, every parse degrades),
      // so an escape here means an unanticipated shape — treat it as native, loudly,
      // rather than as an unhandled rejection that leaves the boot silent.
      if (cancelled) return;
      setProjectionNative(true);
      setBootNotices((n) => [
        ...n,
        e instanceof Error ? `The board's records could not be read (${e.message}).` : 'The board\'s records could not be read.',
      ]);
    });
    return () => {
      cancelled = true;
    };
  }, [taskStore, mounts, projectedStore, projectionNative]);

  // The same wait class the delegation itself gets: if the view mount never arrives,
  // stop waiting after MOUNT_GRACE_MS and render the delegated bundle natively — with a
  // notice, because "No boards here yet" on a marker-only board bundle would be a lie
  // (the bundle holds no boards of its own; its records come through the missing view).
  const projectionWaiting = !!taskStore && !projectedStore && !projectionNative;
  useEffect(() => {
    if (!projectionWaiting) return;
    const t = setTimeout(() => {
      setProjectionNative(true);
      setBootNotices((n) => [...n, 'The records mount for this board was not delivered — showing the folder instead.']);
    }, MOUNT_GRACE_MS);
    return () => clearTimeout(t);
  }, [projectionWaiting]);

  // Written synchronously by the boot effect and by saveConfig (never during
  // render), so back-to-back saves never read a stale config.
  const privRef = useRef<Store | null>(null);
  const configRef = useRef<AppConfig>({});

  useEffect(() => {
    // The gate, in two halves. This one stops the boot from STARTING when the input is
    // already known — the common case, since the host mints the delegation before the
    // callee boots.
    //
    // The `abandoned()` re-checks below are the other half, and they are what does the
    // work for a boot that had ALREADY begun when the input landed: they stop the space
    // mount and the `config.json` write, not merely the final `setState`. They need no
    // separate "am I a callee now?" signal — `isCallee` is this effect's dependency, so
    // the flip re-runs it, and React runs the previous cleanup (which sets `cancelled`)
    // before the new body. One flag, and it is already there.
    //
    // What the pair guarantees: a callee neither grants itself the user's shared space
    // nor writes their config. The settings mount itself may already have been opened by
    // an in-flight first `await`, which is why that is not claimed.
    if (isCallee) return;
    let cancelled = false;
    const abandoned = () => cancelled;
    (async () => {
      const priv = await openPrivateStore('data');
      if (abandoned()) return;
      const config = await readJson<AppConfig>(configPath(priv), {});
      if (abandoned()) return;
      let shared: Store | null = null;
      if (config.spaceId && !abandoned()) {
        // The space MOUNT, and the `config.json` write below, are the two side effects
        // the gate has to stop — not just the `setState`. A callee that reached here
        // before its input landed must not grant itself the user's shared space, and
        // must not rewrite their config on the way out.
        shared = await openRememberedSpace(config.spaceId, SHARED_SUB);
        if (!shared) {
          // The grant is gone (revoked / space deleted): forget it.
          delete config.spaceId;
          delete config.spaceName;
          if (priv.mode === 'rw' && !abandoned()) await writeJson(configPath(priv), config).catch(() => undefined);
        } else if (shared.name && shared.name !== config.spaceName) {
          config.spaceName = shared.name;
        }
      }
      if (abandoned()) return;
      privRef.current = priv;
      configRef.current = config;
      setState({ ready: true, privateStore: priv, shared, config, error: null });
    })().catch((e: unknown) => {
      if (!cancelled)
        setState((s) => ({ ...s, ready: true, error: e instanceof Error ? e.message : 'Could not open storage' }));
    });
    return () => {
      cancelled = true;
    };
  }, [isCallee]);

  // The delegation may be announced a beat after the input. Wait, briefly — and if it
  // never comes, CANCEL rather than quietly rendering this user's own private board:
  // the caller asked us to open THEIR folder, and `invokeTask` should reject
  // `cancelled` instead of hanging to the liveness bound.
  const waitingForMount = isCallee && !taskStore && !taskFailed;
  useEffect(() => {
    if (!waitingForMount) return;
    const t = setTimeout(() => {
      setTaskFailed(true);
      cancelTask();
    }, MOUNT_GRACE_MS);
    return () => clearTimeout(t);
  }, [waitingForMount]);

  const saveConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const next: AppConfig = { ...configRef.current, ...patch };
    for (const k of Object.keys(next) as Array<keyof AppConfig>) if (next[k] === undefined) delete next[k];
    configRef.current = next;
    setState((s) => ({ ...s, config: next }));
    const priv = privRef.current;
    if (priv && priv.mode === 'rw') {
      await writeJson(configPath(priv), next).catch(() => undefined);
    }
  }, []);

  const adopt = useCallback(
    async (shared: Store) => {
      setState((s) => ({ ...s, shared }));
      await saveConfig({ spaceId: shared.spaceId, spaceName: shared.name });
    },
    [saveConfig],
  );

  const run = useCallback(
    async (op: () => Promise<Store>): Promise<ShareOutcome> => {
      try {
        const shared = await op();
        await adopt(shared);
        return 'ok';
      } catch (e: unknown) {
        const code = (e as { code?: string } | null)?.code;
        if (code === 'cancelled') return 'cancelled';
        const message =
          code === 'auth-required'
            ? 'Sign in to share a board.'
            : code === 'forbidden'
              ? 'This app is not allowed to open shared spaces here.'
              : e instanceof Error
                ? e.message
                : 'Could not open the shared space.';
        setLastError(message);
        return 'error';
      }
    },
    [adopt],
  );

  /** Host powerbox: the user picks an existing space and a rw/ro grant. */
  const openShared = useCallback(() => run(() => pickSharedStore(SHARED_SUB)), [run]);
  /** New space (host consent dialog). */
  const createShared = useCallback((name: string) => run(() => createSharedStore(name, SHARED_SUB)), [run]);
  /** Back to the private board; the grant itself stays with the platform. */
  const leaveShared = useCallback(async () => {
    setState((s) => ({ ...s, shared: null }));
    await saveConfig({ spaceId: undefined, spaceName: undefined });
  }, [saveConfig]);

  const rememberBoard = useCallback(
    (storeKey: string, boardId: string) => {
      const last = configRef.current.lastBoard ?? {};
      if (last[storeKey] === boardId) return;
      void saveConfig({ lastBoard: { ...last, [storeKey]: boardId } });
    },
    [saveConfig],
  );

  /** A task boot persists nothing: the config lives in the private store this callee
   *  never opened, and the delegated board is not this user's to remember. */
  const noRemember = useCallback(() => undefined, []);

  const clearError = useCallback(() => setLastError(null), []);

  const setDisplayName = useCallback(
    (name: string) => void saveConfig({ displayName: name.trim() || undefined }),
    [saveConfig],
  );

  // In task mode the private/shared pair is not merely unused, it is not REPORTED:
  // `App.tsx` renders `stores.store` and the share dialog reads `stores.shared`, so
  // reporting a store the callee must not touch is how it would get touched. (The pair
  // can exist if the input arrived after the boot effect started — the gate stops the
  // next run, not the one in flight.)
  const noShare = useCallback(async (): Promise<ShareOutcome> => 'cancelled', []);

  return {
    ...state,
    mode: isCallee ? ('task' as const) : ('app' as const),
    ready: isCallee ? !!taskStore || taskFailed : state.ready,
    privateStore: isCallee ? null : state.privateStore,
    shared: isCallee ? null : state.shared,
    error: isCallee ? (taskFailed ? 'The folder to open was not delivered. Try opening it again.' : null) : state.error,
    store: projectedStore ?? taskStore ?? (isCallee ? null : (state.shared ?? state.privateStore)),
    // R3-549: non-fatal projection diagnostics (an ignored `writable`, a vocabulary
    // fallback) — surfaced once each by `App` as toasts, never blocking the boot.
    bootNotices,
    openShared: isCallee ? noShare : openShared,
    createShared: isCallee ? noShare : createShared,
    leaveShared: isCallee ? noShare : leaveShared,
    rememberBoard: isCallee ? noRemember : rememberBoard,
    setDisplayName,
    lastError,
    clearError,
  };
}

/** The key a store's remembered board is filed under. A task store gets a key derived
 *  from its root and NOT the `'private'` fallback — otherwise the delegated board would
 *  be filed as, and re-opened as, the user's own private one. Nothing writes it (see
 *  `noRemember`); the distinct key is what makes that safe rather than lucky. */
export const storeKey = (store: Store) =>
  store.kind === 'task' ? `task:${store.root}` : (store.spaceId ?? 'private');
