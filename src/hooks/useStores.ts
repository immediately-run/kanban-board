// Boot the private store, re-open a remembered shared space, and expose the
// share / create / leave actions. The private store is opened FIRST and kept
// (see store.ts on why a later openSettings() would resolve differently).
//
// …UNLESS this boot is a task invocation (R3-548). A callee's store is the directory
// the caller delegated, and the private/shared pair must not exist beside it: one board
// id, two stores, and the `lastBoard` map would cross them. So the task branch is a
// GATE on the same boot, not a second boot path — `App.tsx` has one store to render.
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const taskStore = storeFromTaskInput(taskInput, useMounts() ?? []);
  // Written synchronously by the boot effect and by saveConfig (never during
  // render), so back-to-back saves never read a stale config.
  const privRef = useRef<Store | null>(null);
  const configRef = useRef<AppConfig>({});

  useEffect(() => {
    // The gate. A callee opens nothing of its own — not even to read `config.json`,
    // which would create the settings mount this invocation has no use for.
    if (isCallee) return;
    let cancelled = false;
    (async () => {
      const priv = await openPrivateStore('data');
      const config = await readJson<AppConfig>(configPath(priv), {});
      let shared: Store | null = null;
      if (config.spaceId) {
        shared = await openRememberedSpace(config.spaceId, SHARED_SUB);
        if (!shared) {
          // The grant is gone (revoked / space deleted): forget it.
          delete config.spaceId;
          delete config.spaceName;
          if (priv.mode === 'rw') await writeJson(configPath(priv), config).catch(() => undefined);
        } else if (shared.name && shared.name !== config.spaceName) {
          config.spaceName = shared.name;
        }
      }
      if (cancelled) return;
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
    store: taskStore ?? (isCallee ? null : (state.shared ?? state.privateStore)),
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
