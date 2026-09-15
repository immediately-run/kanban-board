import { defineConfig } from 'vitest/config';

// The repo's first test harness (R3-548). DELIBERATELY not `vite.config.ts`:
//
//  - `devFs()` aliases the bare `fs` specifier to the ZenFS bridge that stands in for
//    the host under `vite dev`. Under test we want the real `node:fs`, because the
//    thing being proved about `board.ts` is that it reads the SAME bytes whatever kind
//    of store points at them — a claim about the on-disk layout, not about a bridge.
//  - the MDX and React plugins have nothing to do: every module under test is pure
//    TypeScript. `App.tsx` and the hooks are not tested here (no DOM testing library in
//    this repo, and the logic they carry lives in `src/lib/`).
//
// `__APP_DEV__` is intentionally left undefined: `store.ts` reads it through
// `typeof __APP_DEV__`, which is exactly the guard that makes its absence mean "not a
// dev boot" rather than a ReferenceError.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    server: {
      deps: {
        // `board.ts` reaches the SDK through `store.ts` (for the `Store` type and the
        // mount helpers), and the SDK's published ESM uses extensionless relative
        // imports, which Node's own resolver rejects. Inlining routes it through Vite's
        // resolver — the same one the app is built with — instead of Node's.
        inline: ['@immediately-run/sdk'],
      },
    },
  },
});
