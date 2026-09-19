// @vitest-environment jsdom
//
// R3-549 — the projection source, tested against the REAL producer's bytes
// (BUNDLE_EMBEDDING §7.1 Phase 0, gates G-BE-3's fixture+DOM halves and G-BE-14's
// consumer half).
//
// The fixtures under `projectionFixtures/` are verbatim copies, named for their
// provenance:
//   · `board.immediately.run.json`  — docs/content/roadmap/board/immediately.run.json
//     (the marker this item lands)
//   · `wiki.immediately.run.json`   — docs/content/immediately.run.json (the owner's
//     layout declaration, R3-545)
//   · `R3-658.mdx`                  — a live item, `status: available`
//   · `R3-637.mdx`                  — a live item, `status: in-progress`
//   · `R3-434.mdx`                  — an archived item, `status: done` — the terminal
//     value, outside `values` by definition (§4a.1): the mid-move record that must
//     surface in the overflow group, never be dropped (CB-18)
//
// The fixture directory plays the host's part: the pruned layout is computed with the
// canonical `pruneLayoutToView` exactly as `mintDelegations` prunes it (G-BE-19), and
// the view directory holds the records at the mount's root, which is where the
// `(target, subtree)` chroot puts them (§5).

import { act } from 'react';
import React from 'react';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pruneLayoutToView, type BundleLayout } from '@immediately-run/mdx-plugins';
import type { SandboxMount } from '@immediately-run/sdk/mounts';
import {
  parseMarkerLayout,
  parseProjectionMarker,
  readProjectedBoard,
  resolveProjection,
  resolveProjectedStore,
  type ProjectedStore,
} from './projection';
import { cardsIn, type Card, type Column } from './board';
import { pollDir } from './store';
import CardModal from '../components/CardModal';

// Vitest runs with the repo root as cwd (vitest.config.ts sets no other root), which
// makes this the fixture directory without depending on import.meta.url's scheme.
const FIXTURES = join(process.cwd(), 'src', 'lib', 'projectionFixtures');

const boardMarker = () => JSON.parse(readFileSync(join(FIXTURES, 'board.immediately.run.json'), 'utf8'));
const wikiMarker = () => JSON.parse(readFileSync(join(FIXTURES, 'wiki.immediately.run.json'), 'utf8'));

/** The owner's layout, pruned to the board's declared `/roadmap` view — the exact
 *  hand-off the host performs (G-BE-19). */
const prunedLayout = (): BundleLayout => {
  const layout = parseMarkerLayout(wikiMarker());
  expect(layout).not.toBeNull();
  return pruneLayoutToView(layout as BundleLayout, '/roadmap');
};

/** A fresh "view mount" directory holding verbatim copies of the fixture records. */
const makeView = (...names: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'kanban-projection-'));
  for (const n of names) cpSync(join(FIXTURES, n), join(dir, n));
  return dir;
};

/** The full derivation, as the boot wiring performs it, against a real directory. */
const projectedOver = (view: string) => {
  const { projection, diagnostics } = parseProjectionMarker(boardMarker());
  expect(diagnostics).toEqual([]);
  expect(projection).not.toBeNull();
  const { resolved } = resolveProjection(projection!, prunedLayout(), view);
  expect(resolved).not.toBeNull();
  const store: ProjectedStore = {
    root: view,
    mode: 'ro',
    kind: 'task',
    bundle: { kind: 'wiki', layout: prunedLayout() },
    projection: resolved!,
  };
  return { store, projection: resolved! };
};

const scratch: string[] = [];
const roots: Array<{ root: Root; container: HTMLElement }> = [];
afterEach(() => {
  while (roots.length) {
    const { root, container } = roots.pop()!;
    act(() => root.unmount());
    container.remove();
  }
  while (scratch.length) rmSync(scratch.pop()!, { recursive: true, force: true });
});

/** Render the card modal for real and let SafeContent's async parse settle. */
async function renderModal(card: Card, columns: Column[]): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => {
    root.render(
      React.createElement(CardModal, {
        card,
        columns,
        readOnly: true,
        onSave: () => undefined,
        onDelete: () => undefined,
        onClose: () => undefined,
      }),
    );
  });
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  return container;
}

// ── the real producer (G-BE-3's fixture half) ───────────────────────────────────

describe('the roadmap board over the real marker, layout and records (R3-549)', () => {
  it('materializes one column per declared value, in the map order, plus overflow', async () => {
    const view = makeView('R3-658.mdx', 'R3-637.mdx', 'R3-434.mdx');
    scratch.push(view);
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    expect(snap).not.toBeNull();
    const overflowId = projection.overflowId;
    expect(snap!.meta.columns.map((c) => c.id)).toEqual([
      'available',
      'in-progress',
      'in-review',
      'deferred',
      'deprioritized',
      'superseded',
      overflowId,
    ]);
    // Column names are the owner's vocabulary rendered as text (§5).
    expect(snap!.meta.columns.map((c) => c.name)).toEqual([
      'available',
      'in-progress',
      'in-review',
      'deferred',
      'deprioritized',
      'superseded',
      'Unmapped',
    ]);
  });

  it('puts each record in its status column; the terminal `done` lands in overflow', async () => {
    const view = makeView('R3-658.mdx', 'R3-637.mdx', 'R3-434.mdx');
    scratch.push(view);
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    expect(cardsIn(snap!.cards, 'available').map((c) => c.id)).toEqual(['R3-658']);
    expect(cardsIn(snap!.cards, 'in-progress').map((c) => c.id)).toEqual(['R3-637']);
    expect(cardsIn(snap!.cards, projection.overflowId).map((c) => c.id)).toEqual(['R3-434']);
    // `done` is neither a column nor a drop target (§7.1 honesty note) — the archived
    // fixture record is display-only, never dropped silently.
    expect(snap!.cards).toHaveLength(3);
  });

  it('projects id/title/body/labels/updated from frontmatter and content, and the path', async () => {
    const view = makeView('R3-658.mdx', 'R3-637.mdx', 'R3-434.mdx');
    scratch.push(view);
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    const card = snap!.cards.find((c) => c.id === 'R3-658')!;
    expect(card.title).toBe('R3-658 — The bleeding-edge channel: an unpinned release lock, refused in production');
    // `content` is the body AFTER the frontmatter block, through the canonical parser.
    expect(card.description).not.toContain('status:');
    expect(card.description.length).toBeGreaterThan(0);
    expect(card.labels).toContain('roadmap-item');
    expect(card.updated).toBe('2026-09-17');
    expect(card.sourcePath).toBe('R3-658.mdx');
    // order is projected as a number (the frontmatter `order:`), display-only.
    expect(card.order).toBe(730);
  });

  it('sorts a column by `order`; a missing order sorts last', async () => {
    const view = makeView();
    scratch.push(view);
    writeFileSync(
      join(view, 'R3-9001.mdx'),
      '---\ntitle: "First"\nid: R3-9001\nstatus: available\norder: 10\nupdated: 2026-09-19\n---\n\nBody one.\n',
    );
    writeFileSync(
      join(view, 'R3-9002.mdx'),
      '---\ntitle: "Second"\nid: R3-9002\nstatus: available\norder: 2\nupdated: 2026-09-19\n---\n\nBody two.\n',
    );
    writeFileSync(
      join(view, 'R3-9003.mdx'),
      '---\ntitle: "No order"\nid: R3-9003\nstatus: available\nupdated: 2026-09-19\n---\n\nBody three.\n',
    );
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    expect(cardsIn(snap!.cards, 'available').map((c) => c.id)).toEqual(['R3-9002', 'R3-9001', 'R3-9003']);
  });

  it('a record that cannot be read is display-only in overflow, its filename the title (§4.3 rule 4)', async () => {
    const view = makeView('R3-658.mdx');
    scratch.push(view);
    // A directory whose name matches the select glob: readdir lists it, the read of its
    // "content" fails — the class a mid-write or foreign-encoded record falls into.
    mkdirSync(join(view, 'R3-9600.mdx'));
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    const overflow = cardsIn(snap!.cards, projection.overflowId);
    expect(overflow.map((c) => c.id)).toEqual(['R3-9600']);
    expect(overflow[0].title).toBe('R3-9600');
    expect(overflow[0].sourcePath).toBe('R3-9600.mdx');
    // The readable record is unaffected.
    expect(cardsIn(snap!.cards, 'available').map((c) => c.id)).toEqual(['R3-658']);
  });

  it('a record that becomes unreadable mid-poll keeps the reader\'s card for that cycle', async () => {
    const view = makeView();
    scratch.push(view);
    writeFileSync(
      join(view, 'R3-9700.mdx'),
      '---\ntitle: "Was readable"\nid: R3-9700\nstatus: in-progress\norder: 1\nupdated: 2026-09-19\n---\n\nBody.\n',
    );
    const { store, projection } = projectedOver(view);
    const first = await readProjectedBoard(store, projection);
    expect(cardsIn(first!.cards, 'in-progress').map((c) => c.id)).toEqual(['R3-9700']);

    // Replace the record with an unreadable entry of the same name.
    rmSync(join(view, 'R3-9700.mdx'));
    mkdirSync(join(view, 'R3-9700.mdx'));
    const second = await readProjectedBoard(store, projection, first!);
    expect(second!.cards.find((c) => c.sourcePath === 'R3-9700.mdx')?.title).toBe('Was readable');
    expect(second!.cards.find((c) => c.sourcePath === 'R3-9700.mdx')?.column).toBe('in-progress');
  });

  it('an unreadable SOURCE DIRECTORY keeps the reader\'s board (null on a first read)', async () => {
    const view = makeView('R3-658.mdx');
    scratch.push(view);
    const { store, projection } = projectedOver(view);
    const first = await readProjectedBoard(store, projection);
    expect(first!.cards).toHaveLength(1);

    // The source dir gone (a torn-down view): the poll retries, the reader keeps
    // their board — never a flash of the empty state.
    rmSync(view, { recursive: true, force: true });
    expect(await readProjectedBoard(store, projection, first!)).toBe(first);
    const fresh: ProjectedStore = { ...store, projection: { ...projection, sourceDir: '/no/such/view' } };
    expect(await readProjectedBoard(fresh, fresh.projection)).toBeNull();
  });
});

// ── injection: values are held as text, bodies render inert (G-BE-3's DOM half) ──

describe('projected values and bodies are untrusted input (R3-549, §5)', () => {
  const injected = (view: string) => {
    writeFileSync(
      join(view, 'R3-9500.mdx'),
      '---\n' +
        'title: "<img src=x onerror=alert(1)>"\n' +
        'id: R3-9500\n' +
        'status: available\n' +
        'order: 1\n' +
        'updated: 2026-09-19\n' +
        'tags: [injection]\n' +
        '---\n' +
        '\n' +
        'Body with an html <script>alert(1)</script> tag, an <img src=x> tag and a [link](javascript:alert(1)).\n',
    );
  };

  it('the snapshot holds the raw string — nothing is interpreted as markup', async () => {
    const view = makeView();
    scratch.push(view);
    injected(view);
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    const card = snap!.cards.find((c) => c.id === 'R3-9500')!;
    expect(card.title).toBe('<img src=x onerror=alert(1)>');
    expect(card.description).toContain('<script>alert(1)</script>');
  });

  it('the rendered card modal contains no script or img element (G-BE-3 DOM half)', async () => {
    const view = makeView();
    scratch.push(view);
    injected(view);
    const { store, projection } = projectedOver(view);

    const snap = await readProjectedBoard(store, projection);
    const card = snap!.cards.find((c) => c.id === 'R3-9500')!;
    const container = await renderModal(card, snap!.meta.columns);

    // The title rendered as escaped TEXT (no img element), the body through
    // safe-content (no script element, no img element) — and the item id and path
    // show as text.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(container.textContent).toContain('R3-9500 · R3-9500.mdx');
    // A javascript: link never becomes an href (sanitizeUrl's allowlist).
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

// ── zero writes, across boot, poll and modal open (G-BE-3's no-write half) ──────

describe('a projected boot writes nothing (R3-549)', () => {
  it('read + poll + modal open make zero write calls', async () => {
    const view = makeView('R3-658.mdx', 'R3-637.mdx', 'R3-434.mdx');
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(view, delegated);
    cpSync(join(FIXTURES, 'board.immediately.run.json'), join(delegated, 'immediately.run.json'));

    const layout = prunedLayout();
    const mounts: SandboxMount[] = [
      { path: delegated, type: 'task', mode: 'ro' },
      { path: view, type: 'bundle', mode: 'rw', bundle: { kind: 'wiki', layout } },
    ];

    const writeFns = ['writeFile', 'appendFile', 'rename', 'copyFile', 'unlink', 'rm', 'rmdir', 'mkdir'] as const;
    const spies = writeFns.map((fn) => vi.spyOn(fs.promises as unknown as Record<(typeof writeFns)[number], () => unknown>, fn));
    try {
      // Boot: the marker read, the resolution, the first board read.
      const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, mounts);
      expect(r.kind).toBe('projected');
      if (r.kind !== 'projected') return;
      const snap = await readProjectedBoard(r.store, r.store.projection);
      expect(snap!.cards).toHaveLength(3);

      // Poll: a few real pollDir cycles over the source directory.
      const stop = pollDir(`${r.store.root}/`, () => undefined, 10);
      await new Promise((res) => setTimeout(res, 40));
      stop();

      // Modal open (the async safe-content parse included).
      const card = snap!.cards.find((c) => c.id === 'R3-658')!;
      await renderModal(card, snap!.meta.columns);

      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

// ── the vocabulary clamp (G-BE-14, consumer half) ───────────────────────────────

describe("the consumer's values are clamped to the owner's vocabulary (G-BE-14)", () => {
  it("a value outside the owner's status vocabulary falls back to the owner's list, with a diagnostic", () => {
    const marker = structuredClone(boardMarker());
    marker.projection.map.column.values = ['available', 'bogus'];
    const { projection, diagnostics } = parseProjectionMarker(marker);
    expect(diagnostics).toEqual([]);
    expect(projection).not.toBeNull();

    const { resolved, diagnostics: resolveDiags } = resolveProjection(projection!, prunedLayout(), '/items');
    expect(resolveDiags.map((d) => d.code)).toContain('projection.values');
    expect(resolved!.values).toEqual([
      'available',
      'in-progress',
      'in-review',
      'deferred',
      'deprioritized',
      'superseded',
    ]);
  });

  it('the consumer may show a subset, in its own display order', () => {
    const marker = structuredClone(boardMarker());
    marker.projection.map.column.values = ['in-progress', 'available'];
    const { projection } = parseProjectionMarker(marker);
    const { resolved, diagnostics } = resolveProjection(projection!, prunedLayout(), '/items');
    expect(diagnostics).toEqual([]);
    expect(resolved!.values).toEqual(['in-progress', 'available']);
  });

  it('a non-empty writable is inert — the projection still parses, with a diagnostic', () => {
    const marker = structuredClone(boardMarker());
    marker.projection.writable = ['column'];
    const { projection, diagnostics } = parseProjectionMarker(marker);
    expect(projection).not.toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain('projection.writable');
  });

  it('restating dir/select beside a recordSet is refused (G-BE-14 parse half)', () => {
    const marker = structuredClone(boardMarker());
    marker.projection.source.dir = '/items';
    const { projection, diagnostics } = parseProjectionMarker(marker);
    expect(projection).toBeNull();
    expect(diagnostics.map((d) => d.code)).toContain('projection.source');
  });

  it('an owner vocabulary containing the overflow sentinel cannot mint two columns with one id', () => {
    // A hostile/odd owner declares a status value equal to the sentinel: the overflow
    // column's id yields until it is distinct (column ids are React keys).
    const marker = structuredClone(boardMarker());
    marker.projection.map.column.values = ['available', '__overflow'];
    const layout = prunedLayout();
    (layout.recordSets['roadmap-items']!.wellKnown!['status'] as { values: string[] }).values = [
      'available',
      '__overflow',
    ];
    const { projection } = parseProjectionMarker(marker);
    const { resolved } = resolveProjection(projection!, layout, '/items');
    expect(resolved!.values).toContain('__overflow');
    expect(resolved!.overflowId).not.toBe('__overflow');
    expect(resolved!.values).not.toContain(resolved!.overflowId);
  });
});

// ── the boot resolution: which mount becomes the store ──────────────────────────

describe('resolveProjectedStore (R3-549)', () => {
  const layout = () => prunedLayout();

  it('derives the projected store from the announced bundle view, forcing ro', async () => {
    const view = makeView('R3-658.mdx');
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(view, delegated);
    cpSync(join(FIXTURES, 'board.immediately.run.json'), join(delegated, 'immediately.run.json'));

    const mounts: SandboxMount[] = [
      { path: delegated, type: 'task', mode: 'ro' },
      // rw on the wire: a projection is read-only whatever the mount says (§4.1).
      { path: view, type: 'bundle', mode: 'rw', bundle: { kind: 'wiki', layout: layout() } },
    ];
    const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, mounts);
    expect(r.kind).toBe('projected');
    if (r.kind !== 'projected') return;
    expect(r.store.root).toBe(view);
    expect(r.store.mode).toBe('ro');
    expect(r.store.kind).toBe('task');
    expect(r.store.bundle.layout.recordSets['roadmap-items']).toBeDefined();
    expect(r.store.projection.sourceDir).toBe(view);
    expect(r.diagnostics).toEqual([]);
  });

  it('waits when no announced mount carries the record set yet', async () => {
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(delegated);
    cpSync(join(FIXTURES, 'board.immediately.run.json'), join(delegated, 'immediately.run.json'));
    const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, []);
    expect(r.kind).toBe('waiting');
  });

  it('a delegated bundle without a projection stays native — today\'s read path', async () => {
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(delegated);
    writeFileSync(join(delegated, 'immediately.run.json'), JSON.stringify({ kind: 'board' }));
    const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, []);
    expect(r.kind).toBe('native');
    expect(r.diagnostics).toEqual([]);
  });

  it('an unparsable marker degrades to native with a diagnostic, not a crash', async () => {
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(delegated);
    writeFileSync(join(delegated, 'immediately.run.json'), '{not json');
    const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, []);
    expect(r.kind).toBe('native');
    expect(r.diagnostics.map((d) => d.code)).toContain('marker-unparsable');
  });

  it('with two announced views, the one matching the DECLARED mount wins, not the first announced', async () => {
    const narrow = makeView('R3-658.mdx');
    const wide = makeView('R3-658.mdx');
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(narrow, wide, delegated);
    cpSync(join(FIXTURES, 'board.immediately.run.json'), join(delegated, 'immediately.run.json'));

    const layout = prunedLayout();
    // The WIDE view (the FULL, unpruned layout — every record set, every tree entry) is
    // announced FIRST; the marker declares a /roadmap-subtree mount, so the narrow view
    // is its resolution and re-pruning the wide layout with /roadmap is NOT a no-op.
    const wideLayout = parseMarkerLayout(wikiMarker()) as BundleLayout;
    const mounts: SandboxMount[] = [
      { path: delegated, type: 'task', mode: 'ro' },
      { path: wide, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout: wideLayout } },
      { path: narrow, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout } },
    ];
    const r = await resolveProjectedStore({ root: delegated, mode: 'ro', kind: 'task' }, mounts);
    expect(r.kind).toBe('projected');
    if (r.kind !== 'projected') return;
    expect(r.store.root).toBe(narrow);
    expect(r.store.projection.sourceDir).toBe(narrow);
  });

  it('an ANCESTOR-only declaration resolves against the wide view, the exact declaration beating marker order', async () => {
    const narrow = makeView('R3-658.mdx');
    const wide = makeView('R3-658.mdx');
    const delegated = mkdtempSync(join(tmpdir(), 'kanban-delegated-'));
    scratch.push(narrow, wide, delegated);

    // (a) The marker declares ONLY a whole-bundle mount (subtree /): its resolution is
    // the wide view, and the records sit one segment under it — the narrow view is
    // consistent with '/' too (nothing sits outside it), so the LARGEST layout wins.
    const ancestorMarker = structuredClone(boardMarker());
    ancestorMarker.requests.mounts = [{ at: '/all/', uri: 'bundle:../..', subtree: '/', mode: 'ro', required: true }];
    writeFileSync(join(delegated, 'immediately.run.json'), JSON.stringify(ancestorMarker));
    const wideLayout = parseMarkerLayout(wikiMarker()) as BundleLayout;
    const layout = prunedLayout();
    const r = await resolveProjectedStore(
      { root: delegated, mode: 'ro', kind: 'task' },
      [
        { path: delegated, type: 'task', mode: 'ro' },
        { path: narrow, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout } },
        { path: wide, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout: wideLayout } },
      ],
    );
    expect(r.kind).toBe('projected');
    if (r.kind !== 'projected') return;
    expect(r.store.root).toBe(wide);
    expect(r.store.projection.sourceDir).toBe(`${wide}/roadmap`);

    // (b) Both declarations present, the ANCESTOR first: the exact one (subtree
    // /roadmap) must win over marker order, pairing the narrow view at its root.
    const bothMarker = structuredClone(boardMarker());
    bothMarker.requests.mounts = [
      { at: '/all/', uri: 'bundle:../..', subtree: '/', mode: 'ro', required: true },
      { at: '/items/', uri: 'bundle:../..', subtree: '/roadmap', mode: 'ro', required: true },
    ];
    writeFileSync(join(delegated, 'immediately.run.json'), JSON.stringify(bothMarker));
    const r2 = await resolveProjectedStore(
      { root: delegated, mode: 'ro', kind: 'task' },
      [
        { path: delegated, type: 'task', mode: 'ro' },
        { path: narrow, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout } },
        { path: wide, type: 'bundle', mode: 'ro', bundle: { kind: 'wiki', layout: wideLayout } },
      ],
    );
    expect(r2.kind).toBe('projected');
    if (r2.kind !== 'projected') return;
    expect(r2.store.root).toBe(narrow);
    expect(r2.store.projection.sourceDir).toBe(narrow);
  });
});

// ── the pruned layout's coordinate mapping ──────────────────────────────────────

describe('the record-set dir maps through the declared (subtree → mount) pair (§5)', () => {
  it('a record set deeper than the view maps under the mount path', () => {
    const { projection } = parseProjectionMarker(boardMarker());
    expect(projection).not.toBeNull();
    const layout = prunedLayout();
    // The pruned layout keeps OWNER coordinates: /roadmap and /roadmap/archive.
    expect(layout.recordSets['roadmap-archive']?.dir).toBe('/roadmap/archive');
    // Resolving the archive set (same marker shape, recordSet renamed) maps it under
    // the view mount — the §5 reconstruction, not a naive join.
    const marker = structuredClone(boardMarker());
    marker.projection.source.recordSet = 'roadmap-archive';
    const archive = parseProjectionMarker(marker).projection!;
    const { resolved } = resolveProjection(archive, layout, '/mnt/view');
    expect(resolved!.sourceDir).toBe('/mnt/view/archive');
  });
});
