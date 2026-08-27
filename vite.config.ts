import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import { devFs } from '@immediately-run/dev-fs'

// MDX must run before @vitejs/plugin-react so the JSX it emits is handled by
// React's transform (Fast Refresh included). immediately.run processes .mdx
// natively; this wiring keeps the local `vite dev`/`build` in sync.
//
// devFs() (@immediately-run/dev-fs) makes `import ... from 'fs'` work during
// local `vite dev`, bridging the same async ZenFS surface immediately.run
// provides to your real disk. It is dev-only and absent from production builds.
//
// `__APP_DEV__` is how src/lib/store.ts tells local `vite dev` apart from the
// immediately.run host. It is a build-time define because `import.meta` is a
// parse error in the sandbox transpiler.
// https://vite.dev/config/
export default defineConfig({
  define: { __APP_DEV__: JSON.stringify(process.env.NODE_ENV !== 'production') },
  plugins: [
    devFs(),
    { enforce: 'pre', ...mdx() },
    react(),
  ],
})
