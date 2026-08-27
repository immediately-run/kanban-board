# immediately.run — starter template

A ready-to-run starter for building apps on
[immediately.run](https://immediately.run): React + TypeScript + Vite, wired to
the brand design system, with the project layout immediately.run expects.

## Try it instantly

Try this template on [immediately.run](https://immediately.run/present/github/immediately-run/new-project-template/main/files/src/App.tsx)

> Using this as a starting point for your own app? After you push to your repo,
> update the link above to
> `https://immediately.run/present/github/<owner>/<repo>/<ref>/files/src/App.tsx`.

## Use this template

1. Create a new repo from this template (or copy the files).
2. `npm install`
3. `npm run dev` and start editing `src/App.tsx`.
4. Push to GitHub and open it on immediately.run with the link above.

## Fast loading on immediately.run (auto-cache)

immediately.run normally reads your sources from the GitHub API, which is slow
and rate-limited for anonymous visitors. This template ships a GitHub Action
([`.github/workflows/cache.yml`](./.github/workflows/cache.yml)) that, on every
push to `main`, builds a pre-cached zip of your repo and publishes it to your
repo's **own GitHub Pages**. immediately.run finds it automatically at
`https://<owner>.github.io/<repo>/cached_repositories/main.zip` and loads from
there — falling back to the API if it's missing.

The cache also embeds a manifest sidecar, so visitors can push edits back to
GitHub even when the app was loaded from the zip.

### Enable the cache (one-time)

For a repo in your **own** GitHub account or org, there's a single one-time step:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or re-run the **Cache for immediately.run** workflow from the
   Actions tab).

That's it — no tokens and no secrets to configure. The workflow builds the zip and
publishes it to your repo's Pages; immediately.run finds it automatically on the
next load. The first publish can lag a push by up to ~10 minutes of GitHub Pages
CDN caching. If the app still loads from the API, check that the workflow run
succeeded and that Pages shows a green **github-pages** deployment.

> **immediately-run org repos** skip even that step: the org's internal **deploy
> GitHub App** self-provisions Pages on the first run (it holds Pages +
> Administration write and its `DEPLOY_APP_ID` / `DEPLOY_APP_PRIVATE_KEY` are org
> secrets). That App is org-internal — repos outside the org neither have nor need
> it, and `cache.yml` automatically falls back to the manual step above.

### Always run the newest commit

By default the cached version is served even if it's a few minutes behind
`main`. If your app must always reflect the very latest commit, add this to
`package.json`:

```jsonc
{
  "immediately.run": {
    "requireLatest": true
  }
}
```

immediately.run still boots instantly from the cache, then checks in the
background (one API request) whether the cache is current and, if not, reloads
from GitHub.

## How it's organized

immediately.run renders the **default export of `src/App.tsx`** — that's the
entry point, not `main.tsx`.

```
src/
  main.tsx              # local vite dev/build entry only — immediately.run IGNORES this
  App.tsx               # ROOT: default export + imports the global CSS
  index.css             # fonts, design tokens (dark + light), resets
  App.css               # layout + component styles
  mdx.d.ts              # type shim so `import X from './x.mdx'` works
  components/           # one default-exported React component per file
  data/                 # typed data arrays (NO components/JSX here)
  hooks/                # custom hooks (NO components here)
  assets/               # images you import, e.g. import logo from './assets/logo.png'
```

The included page shows the core patterns: a data array mapped to cards
(`data/features.ts` → `components/Features.tsx`), a custom hook
(`hooks/useTheme.ts` → `components/ThemeSwitch.tsx`), and local React state
(`components/Counter.tsx`).

## Filesystem access (`fs`)

immediately.run apps can read and write a filesystem by importing `fs` (async
only — `fs.promises.*` and callback style). This template has local-dev support
for it built in via [`@immediately-run/dev-fs`](https://github.com/immediately-run/dev-fs),
a Vite plugin (already wired into `vite.config.ts`) that bridges the same
filesystem to your real local disk during `vite dev`. See that repo for the
supported API and details.

```ts
import fs from 'fs'

await fs.promises.writeFile('/data/notes.txt', 'hello', 'utf8')
const text = await fs.promises.readFile('/data/notes.txt', 'utf8')
```

`main.tsx` runs a one-off round-trip smoke test in dev — check the browser
console for the `[dev-fs]` group, and delete it freely.

## The rules that keep it working on immediately.run

See [`CLAUDE.md`](./CLAUDE.md) for the full list. The essentials:

- **Global CSS is imported from `App.tsx`, never only from `main.tsx`.**
- **A file that exports a component exports *only* components** — data, consts,
  and helpers go in `data/`, `hooks/`, or `lib/`. `npm run lint` enforces this.
- **Pull colors, fonts, radii, and shadows from the tokens in `index.css`**
  rather than hard-coding values.

## Develop

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev      # local dev server
npm run build    # tsc -b && vite build — must pass with no type errors
npm run lint     # eslint — enforces the React Fast Refresh / HMR rule
npm run preview  # serve the production build
```
