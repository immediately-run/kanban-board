// R3-901 — watchDir's smoke test (the one app repo in the wave WITH a harness;
// the helper is byte-identical across the thirteen, so this pins it once):
// a write under the watched dir fires onChange, and stop() ends the watch
// (via the iterator's own return() — the only stop ZenFS core and the sandbox
// relay honour).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchDir } from './store';

describe('watchDir (R3-901)', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('fires onChange when a file appears under the watched dir (recursive), and stays dead after stop()', async () => {
    dir = mkdtempSync(join(tmpdir(), 'watchdir-'));
    mkdirSync(join(dir, 'sub'), { recursive: true });
    let calls = 0;
    const stop = watchDir(dir, () => calls++);
    // let the async setup (ensureDir + watch attach) land
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(dir, 'sub', 'a.json'), '{}');
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0), { timeout: 3000 });
    stop();
    const at = calls;
    writeFileSync(join(dir, 'b.json'), '{}');
    await new Promise((r) => setTimeout(r, 700));
    expect(calls).toBe(at);
  });

  it('create-then-watch: a watch on a not-yet-existing dir still fires once it appears', async () => {
    dir = join(mkdtempSync(join(tmpdir(), 'watchdir-')), 'not-yet');
    let calls = 0;
    const stop = watchDir(dir, () => calls++);
    await new Promise((r) => setTimeout(r, 300));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.json'), '{}');
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0), { timeout: 3000 });
    stop();
  });
});
