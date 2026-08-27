# Kanban board

A Trello-style board for [immediately.run](https://immediately.run) where **every
card is a file**. Boards have columns, columns have cards; drag cards between
columns (mouse, pen or touch), edit them in a modal, and — when you want a team on
it — put the board in a shared space so everyone with access sees the same board
and can move cards at the same time.

## Try it

Open it on immediately.run:

<https://immediately.run/present/github/immediately-run/kanban-board/main/files/src/App.tsx>

On first run you get a board with three columns (To do / Doing / Done) and four
sample cards. No sign-in prompt, no consent dialog: private boards live in the
app's own per-user folder.

## What you can do

- **Boards** — switch, create, rename and delete boards from the board menu in the
  top bar. Each store (private, or each shared space) remembers the board you had open.
- **Columns** — add, rename (double-click the name or use the column menu), move
  left/right, delete (its cards move to the first remaining column).
- **Cards** — quick-add at the bottom of a column; click a card to edit title,
  description, labels, due date and column, or delete it. Cards show who last
  touched them.
- **Drag and drop** — drag a card by its body (mouse) or by the grip handle on its
  right edge (touch), drop it in any column at any position. Every card also has a
  "Move to…" menu (top / bottom of any column) as the keyboard- and
  mobile-friendly fallback.
- **Share** — the "Share" button opens the platform's space picker
  (`pickSharedStore()`) or creates a new space (`createSharedStore(name)`). The
  chosen space is remembered and re-opened next time. With a read-only grant the
  board is view-only: editing affordances are hidden.

## How data is stored

Everything is plain JSON on the immediately.run filesystem, so it is
inspectable and hackable from the platform's file explorer:

```
<store>/boards/<boardId>/board.json            name, column order + column names
<store>/boards/<boardId>/cards/<cardId>.json   title, description, column, order,
                                               labels[], due, by, created, updated
```

`<store>` is the app's private settings folder by default, or
`<space>/kanban-board/` once the board is shared.

**One card = one file.** Two people moving different cards at the same time write
different files, so nothing gets clobbered; a conflict is only ever possible on
the *same* card, where the last save wins. Card order inside a column is a
fractional index (`order`), so a move rewrites exactly one file (the moved card)
and only renumbers a column when the gaps have collapsed.

## Multi-user notes

- Shared spaces have no remote change events, so the app polls the open board's
  `cards/` directory (and `board.json`) every 2.5 s while a shared store is open,
  and shows a small "Updated from *space*" toast when a poll brings in someone
  else's change. Your own writes don't toast.
- The app can't invite anyone. Share the space itself from the platform's Spaces
  page; members then open the app and the board appears (the space is remembered
  in the private config, so it re-opens on the next visit).
- A read-only grant (`mode: 'ro'`) hides add/edit/drag/delete controls and opens
  cards in a view-only modal.

## Local development

```bash
npm install
npm run dev      # vite dev; the fs module writes to ./devfs-playground/ (git-ignored)
npm run build    # tsc + vite build
npm run lint
```

Under `vite dev` the private store lives in `devfs-playground/settings/data/` and
"Share" switches to `devfs-playground/shared/` without any prompts — open two
browser tabs, share in both, and you can watch the poll pick up moves made in the
other tab.

To run the working tree inside the real host (consent prompts, real grants,
read-only mounts): `immediately.run dev . --origin https://local.immediately.run`.

## License

MIT — see [LICENSE](./LICENSE).
