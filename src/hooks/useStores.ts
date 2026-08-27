// Boot the private store, re-open a remembered shared space, and expose the
// share / create / leave actions. The private store is opened FIRST and kept
// (see store.ts on why a later openSettings() would resolve differently).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSharedStore,
  openPrivateStore,
  openRememberedSpace,
  pickSharedStore,
  readJson,
  writeJson,
  type Store,
} from '../lib/store';

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
  // Written synchronously by the boot effect and by saveConfig (never during
  // render), so back-to-back saves never read a stale config.
  const privRef = useRef<Store | null>(null);
  const configRef = useRef<AppConfig>({});

  useEffect(() => {
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
  }, []);

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

  const clearError = useCallback(() => setLastError(null), []);

  const setDisplayName = useCallback(
    (name: string) => void saveConfig({ displayName: name.trim() || undefined }),
    [saveConfig],
  );

  return {
    ...state,
    store: state.shared ?? state.privateStore,
    openShared,
    createShared,
    leaveShared,
    rememberBoard,
    setDisplayName,
    lastError,
    clearError,
  };
}

export const storeKey = (store: Store) => store.spaceId ?? 'private';
