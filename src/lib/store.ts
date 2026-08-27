// Persistence over the immediately.run filesystem — the canonical pattern for the
// example apps. Validated on the host 2026-08-27 (spike): openSettings, createSpace,
// requestMount, mount('space:<id>') all work; fs.promises.watch fires ONLY for this
// tab's own writes, so shared stores are polled.
//
// Import from SDK subpaths (never the package barrel): the barrel has a module-eval
// side effect that throws under plain `vite dev` (no host transport).
import fs from 'fs';
import { openSettings, createSpace, requestMount, mount as mountById } from '@immediately-run/sdk/mounts';
import type { SandboxMount } from '@immediately-run/sdk/mounts';

export interface Store {
  /** Absolute root directory all app files live under. */
  root: string;
  mode: 'ro' | 'rw';
  kind: 'settings' | 'space' | 'dev' | 'memory';
  /** For spaces: the id to remember (re-mount with `openRememberedSpace`). */
  spaceId?: string;
  /** Space display name when the host knows it. */
  name?: string;
}

// Under local `vite dev` there is no host; @immediately-run/dev-fs bridges `fs` to
// disk, so we persist under `devfs-playground/` (git-ignored). NEVER write
// `import.meta` in files the sandbox transpiles — use a Vite `define`d global.
declare const __APP_DEV__: boolean | undefined;
const isDev = () => typeof __APP_DEV__ !== 'undefined' && __APP_DEV__;
const DEV_ROOT = '/devfs-playground';

const join = (...p: string[]) => p.join('/').replace(/\/+/g, '/');

let settingsMount: Promise<SandboxMount> | null = null;
/** The per-user, per-app private filesystem. Open it FIRST at boot and keep the
 *  handle: after a space grant, a fresh `openSettings()` resolves a different,
 *  space-scoped settings mount (observed on host 2026-08-27). */
export async function openPrivateStore(sub = 'data'): Promise<Store> {
  if (isDev()) return { root: join(DEV_ROOT, 'settings', sub), mode: 'rw', kind: 'dev' };
  settingsMount ??= openSettings();
  const m = await settingsMount;
  return { root: join(m.path, sub), mode: m.mode === 'ro' ? 'ro' : 'rw', kind: 'settings' };
}

const fromMount = (m: SandboxMount, sub: string): Store => ({
  root: join(m.path, sub),
  mode: m.mode === 'ro' ? 'ro' : 'rw',
  kind: 'space',
  spaceId: m.id,
  name: m.name,
});

/** Ask the user to pick (and grant) a space via the host powerbox. Rejects with a
 *  SpaceError (`cancelled` | `forbidden` | `auth-required`). */
export async function pickSharedStore(sub = ''): Promise<Store> {
  if (isDev()) return { root: join(DEV_ROOT, 'shared', sub), mode: 'rw', kind: 'dev', spaceId: 'dev' };
  return fromMount(await requestMount(), sub);
}

/** Create a brand-new space (host shows a consent dialog). */
export async function createSharedStore(name: string, sub = ''): Promise<Store> {
  if (isDev()) return { root: join(DEV_ROOT, 'shared', sub), mode: 'rw', kind: 'dev', spaceId: 'dev' };
  return fromMount(await createSpace({ name }), sub);
}

/** Re-mount a space the user already granted this app (no prompt when the grant is
 *  durable). Returns null when the grant is gone. */
export async function openRememberedSpace(spaceId: string, sub = ''): Promise<Store | null> {
  if (isDev()) return { root: join(DEV_ROOT, 'shared', sub), mode: 'rw', kind: 'dev', spaceId: 'dev' };
  try {
    return fromMount(await mountById(`space:${spaceId}`), sub);
  } catch {
    return null;
  }
}

// ── small fs helpers ───────────────────────────────────────────────────────────

export async function ensureDir(path: string): Promise<void> {
  await fs.promises.mkdir(path, { recursive: true });
}

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.promises.readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) await ensureDir(dir);
  await fs.promises.writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function writeText(path: string, text: string): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf('/'));
  if (dir) await ensureDir(dir);
  await fs.promises.writeFile(path, text, 'utf8');
}

export async function listFiles(dir: string, ext?: string): Promise<string[]> {
  try {
    const names = await fs.promises.readdir(dir);
    return names.filter((n) => !n.startsWith('.') && (!ext || n.endsWith(ext))).sort();
  } catch {
    return [];
  }
}

export async function removeFile(path: string): Promise<void> {
  try {
    await fs.promises.unlink(path);
  } catch {
    /* already gone */
  }
}

/** Sortable, collision-resistant id for one-file-per-record layouts. */
export const newId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Poll a directory for changes (shared spaces get NO remote watch events, so this is
 * the live-update mechanism). Calls `onChange` when the (name → mtime/size) map
 * differs from the last poll. Returns a stop function.
 */
export function pollDir(dir: string, onChange: () => void, intervalMs = 3000): () => void {
  let last: string | null = null; // null = never polled (an empty dir is a valid '' signature)
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const names = await fs.promises.readdir(dir);
      const sig = (
        await Promise.all(
          names.map(async (n) => {
            try {
              const s = await fs.promises.stat(join(dir, n));
              return `${n}:${s.mtimeMs}:${s.size}`;
            } catch {
              return `${n}:?`;
            }
          }),
        )
      ).join('|');
      if (last !== null && sig !== last) onChange();
      last = sig;
    } catch {
      /* dir missing yet */
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  void tick();
  return () => {
    stopped = true;
  };
}
