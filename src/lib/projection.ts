// The projection source (R3-549, BUNDLE_EMBEDDING §4/§4a.3/§5/§7.1 — rung C0).
//
// A marker-only board bundle (docs/content/roadmap/board/) reaches the items it shows
// through a declared by-reference mount (`bundle:../..`, §3) and projects them: cards
// materialized from the target bundle's RECORDS — never copied, never written. This
// module is the consumer half: parse the marker's `projection` block with §4.1's clamps,
// resolve it against the layout the host hands over on the mount descriptor
// (`SandboxMount.bundle.layout`, pruned to the view — G-BE-19), and read records into a
// BoardSnapshot through the canonical frontmatter parser.
//
// Read-only by construction: the resolved store is mode 'ro' whatever the mount says,
// `writable` is honoured only as `[]` (non-empty is inert, §4.1), and this module
// imports nothing that writes — the write helpers of store.ts are not in its imports.

import fs from 'fs';
import { parseBundleLayout, parseFrontmatter, pruneLayoutToView, type BundleLayout } from '@immediately-run/mdx-plugins';
import type { SandboxMount } from '@immediately-run/sdk/mounts';
import { readText, type Store } from './store';
import type { BoardMeta, BoardSnapshot, Card } from './board';

/** The overflow column (§4.1): records whose column value is outside `values` — or that
 *  fail to parse (§4.3 rule 4) — surface here, never dropped silently. The id is
 *  per-resolution and collision-proofed against the vocabulary (see `resolveProjection`)
 *  — column ids are React keys and drag targets, so a value that happens to equal the
 *  sentinel must not mint two columns with one id. */
const OVERFLOW_COLUMN_BASE_ID = '__overflow';
const OVERFLOW_COLUMN_NAME = 'Unmapped';

/** The record sources the `mdx-frontmatter` grammar defines (§4.1): fields from
 *  frontmatter, `content` = the body. The dotted `from` paths of the map walk this. */
const buildRecord = (data: Record<string, unknown>, body: string): object =>
  Object.assign(Object.create(null), {
    frontmatter: Object.assign(Object.create(null), data),
    content: body,
  });

// ── parse: the marker's `projection` block, clamped (§4.1) ──────────────────────

/** One declared `bundle:` mount of the marker (`requests.mounts`) — the consumer's
 *  coordinate pair for mapping the owner's bundle-absolute dirs into its own namespace
 *  (§5: a view path is the target path with `subtree` replaced by `at`). */
export interface ProjectionMount {
  at: string;
  subtree: string;
}

export interface ProjectionFieldMap {
  /** Dotted own-property path over a null-prototype record object. */
  from: string;
  /** For enum-like fields: the declared vocabulary, in display order. */
  values?: string[];
}

/** The parsed `projection` block (§4.1), plus the `bundle:` mount declarations it reads
 *  through. Null-prototype where the spec says so; hygiene-checked at parse. */
export interface Projection {
  source: { recordSet?: string; dir?: string; select?: string };
  record?: 'mdx-frontmatter' | 'json-file';
  /** Null-prototype: built with `Object.create(null)`. */
  map: Record<string, ProjectionFieldMap>;
  /** The marker's `bundle:` mount declarations (`requests.mounts`), in order. */
  mounts: ProjectionMount[];
}

export interface ProjectionDiagnostic {
  code: string;
  message: string;
}

export interface ParsedProjection {
  projection: Projection | null;
  diagnostics: ProjectionDiagnostic[];
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isUnsafeKey = (s: string) => UNSAFE_KEYS.has(s) || s.trim() === '';

/** A dotted `from` path (§4.1): non-empty segments, none of the prototype-pollution
 *  names. Rejected at parse, never sanitized into something else. */
const safeFromPath = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const segs = raw.trim().split('.');
  if (segs.some(isUnsafeKey)) return null;
  return segs.join('.');
};

/** A bundle-absolute directory (§4.1 `source.dir`): leading slash, traversal-free. */
const safeBundleDir = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const s = raw.trim();
  if (!s.startsWith('/') || s.includes('\0') || s.includes('\\')) return null;
  const trimmed = s.replace(/\/+$/, '') || '/';
  if (trimmed !== '/') {
    const segs = trimmed.slice(1).split('/');
    if (segs.some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  }
  return trimmed;
};

/** A basename select glob (§4.1): non-recursive — no separators, no traversal. */
const safeSelectGlob = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const s = raw.trim();
  if (s.includes('/') || s.includes('\\') || s.includes('\0') || s === '.' || s === '..') return null;
  return s;
};

/** `at`/`subtree` as §3/§8.0 normalize them: bundle-absolute, no trailing slash. */
const normalizeMountPath = (raw: unknown): string | null => {
  const d = safeBundleDir(raw);
  return d === '/' ? null : d; // the root is not a usable mount point (§8.0)
};

/**
 * Parse the app's own marker (already JSON-parsed) into a {@link Projection} — the
 * `parseContentMarker`-equivalent logic this app holds, since the SDK does not export
 * the host's parser. Clamps per §4.1: `writable` beyond `[]` is INERT (the caller
 * surfaces the diagnostic; nothing here can widen it), `from` paths and `select` are
 * hygiene-checked, the two `source` forms may not be restated beside each other. An
 * invalid block degrades to "no projection" (G-BE-2) — the bundle still opens.
 */
export function parseProjectionMarker(marker: unknown): ParsedProjection {
  const diagnostics: ProjectionDiagnostic[] = [];
  const refuse = (code: string, message: string): ParsedProjection => {
    diagnostics.push({ code, message });
    return { projection: null, diagnostics };
  };
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return refuse('marker-not-object', 'the marker is not an object');
  }
  const m = marker as Record<string, unknown>;
  const block = m.projection;
  if (block === undefined) return { projection: null, diagnostics };
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return refuse('projection-not-object', 'the projection block is not an object');
  }
  const p = block as Record<string, unknown>;

  // `source` — one of the two §4.1 forms; both at once is an ambiguity, and an
  // ambiguity is a surface, never a heuristic.
  const sourceRaw = p.source;
  if (!sourceRaw || typeof sourceRaw !== 'object' || Array.isArray(sourceRaw)) {
    return refuse('projection.source', 'source is missing or not an object');
  }
  const s = sourceRaw as Record<string, unknown>;
  const hasRecordSet = s.recordSet !== undefined;
  const hasInline = s.dir !== undefined || s.select !== undefined || s.record !== undefined;
  if (hasRecordSet && hasInline) {
    return refuse('projection.source', 'source names a recordSet and restates dir/select/record beside it');
  }
  let source: Projection['source'];
  if (hasRecordSet) {
    if (typeof s.recordSet !== 'string' || isUnsafeKey(s.recordSet.trim())) {
      return refuse('projection.source.recordSet', 'recordSet must be a non-empty, safe name');
    }
    source = { recordSet: s.recordSet.trim() };
  } else {
    const dir = safeBundleDir(s.dir ?? '/');
    if (dir === null) return refuse('projection.source.dir', 'dir must be a bundle-absolute, traversal-free path');
    let select: string | undefined;
    if (s.select !== undefined) {
      const sel = safeSelectGlob(s.select);
      if (sel === null) return refuse('projection.source.select', 'select must be a basename glob (no separators, no ..)');
      select = sel;
    }
    source = { dir, ...(select !== undefined ? { select } : {}) };
  }

  // `record` — the closed grammar set (§4.1). This consumer reads `mdx-frontmatter`
  // only; the other grammar parses (it is legal marker data) but resolves to nothing
  // here, with a diagnostic rather than a crash.
  let record: Projection['record'];
  if (p.record !== undefined) {
    if (p.record !== 'mdx-frontmatter' && p.record !== 'json-file') {
      return refuse('projection.record', `"${String(p.record)}" is not one of the two v1 grammars`);
    }
    record = p.record;
    if (record === 'json-file') {
      diagnostics.push({ code: 'projection.record', message: 'this board reads mdx-frontmatter records only' });
      return { projection: null, diagnostics };
    }
  }

  // `map` — projected field ← dotted source path, null-prototype.
  const mapRaw = p.map;
  if (!mapRaw || typeof mapRaw !== 'object' || Array.isArray(mapRaw)) {
    return refuse('projection.map', 'map is missing or not an object');
  }
  const entries = Object.entries(mapRaw as Record<string, unknown>);
  if (entries.length === 0) return refuse('projection.map', 'map is empty');
  const map: Record<string, ProjectionFieldMap> = Object.create(null);
  for (const [name, entryRaw] of entries) {
    if (isUnsafeKey(name)) return refuse('projection.map', `"${name}" is not a safe field name`);
    if (!entryRaw || typeof entryRaw !== 'object' || Array.isArray(entryRaw)) {
      return refuse(`projection.map.${name}`, 'a map entry must be an object');
    }
    const entry = entryRaw as Record<string, unknown>;
    const from = safeFromPath(entry.from);
    if (from === null) {
      return refuse(`projection.map.${name}.from`, 'from must be a dotted path of safe names');
    }
    const field: ProjectionFieldMap = { from };
    if (entry.values !== undefined) {
      if (!Array.isArray(entry.values) || entry.values.length === 0 || entry.values.some((v) => typeof v !== 'string' || v === '')) {
        return refuse(`projection.map.${name}.values`, 'values must be a non-empty list of non-empty strings');
      }
      field.values = entry.values as string[];
    }
    map[name] = field;
  }

  // `writable` — honoured only as `[]` in v1 (§4.1): non-empty is inert, surfaced.
  if (p.writable !== undefined && (!Array.isArray(p.writable) || p.writable.length > 0)) {
    diagnostics.push({
      code: 'projection.writable',
      message: 'the projection declares write-back, which this board ignores — it renders read-only',
    });
  }

  // The `bundle:` mount declarations the projection reads through (§3). Refused or
  // non-bundle entries are skipped: a refused binding simply does not exist.
  const mounts: ProjectionMount[] = [];
  const requests = m.requests;
  if (requests && typeof requests === 'object' && !Array.isArray(requests)) {
    const mountsRaw = (requests as Record<string, unknown>).mounts;
    if (Array.isArray(mountsRaw)) {
      for (const b of mountsRaw) {
        if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
        const decl = b as Record<string, unknown>;
        if (typeof decl.uri !== 'string' || !decl.uri.startsWith('bundle:')) continue;
        const at = normalizeMountPath(decl.at);
        const subtreeRaw = decl.subtree === undefined ? '/' : decl.subtree;
        const subtree = safeBundleDir(subtreeRaw);
        if (at === null || subtree === null) {
          diagnostics.push({ code: 'projection.mount', message: 'a bundle mount declaration was refused (unsafe at/subtree)' });
          continue;
        }
        mounts.push({ at, subtree });
      }
    }
  }

  return { projection: { source, ...(record !== undefined ? { record } : {}), map, mounts }, diagnostics };
}

// ── resolve: the parsed block against the mount's pruned layout ─────────────────

/** A projection resolved against a real mount: everything `readProjectedBoard` needs,
 *  with the coordinate mapping and the §4a.3 vocabulary check already applied. */
export interface ResolvedProjection {
  /** The record directory in THIS app's namespace (the mount's path + the record-set
   *  dir below the declared `subtree` — §5's coordinate reconstruction). */
  sourceDir: string;
  /** The record-set `select` glob, as a matcher over basenames. */
  select: RegExp;
  map: Record<string, ProjectionFieldMap>;
  /** The effective column vocabulary, in display order (§4a.3: the consumer's order,
   *  clamped to the owner's — a value outside the owner's list falls back to it). */
  values: string[];
  /** The overflow column's id — distinct from every entry in `values` (the name stays
   *  "Unmapped" whatever the id has to become). */
  overflowId: string;
}

/** `select` as a matcher. Basenames only (the glob hygiene already refused separators),
 *  so `*` and `?` translate plainly and everything else is literal. */
const globToRegExp = (glob: string): RegExp => new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

/**
 * The declared mount that covers a record-set dir, **exact subtree first**: a
 * dir-equal declaration is the view the record set was pruned to; an ancestor
 * declaration is a wider view that merely contains it, and would compute the source
 * dir one segment too deep. Marker order breaks the tie between equal-preference
 * declarations.
 */
const coveringMountFor = (dir: string, mounts: ProjectionMount[]): ProjectionMount | undefined =>
  mounts.find((mo) => dir === mo.subtree) ??
  mounts.find((mo) => dir.startsWith(`${mo.subtree === '/' ? '' : mo.subtree}/`));

/**
 * Resolve a parsed {@link Projection} against the layout a mount descriptor carries
 * (`SandboxMount.bundle.layout`, already pruned to the view) and the mount's announced
 * path. Pure: no fs, no host — the whole mapping is testable without a store.
 *
 * The record set's `dir` is in the OWNER's bundle coordinates; the consumer reconstructs
 * its own path by replacing the declared `subtree` with the mount's announced path
 * (§5). A record set no declared mount covers is unresolvable — the projection degrades
 * to nothing with a diagnostic, never to a guess.
 */
export function resolveProjection(
  projection: Projection,
  layout: BundleLayout,
  mountPath: string,
): { resolved: ResolvedProjection | null; diagnostics: ProjectionDiagnostic[] } {
  const diagnostics: ProjectionDiagnostic[] = [];
  const rsName = projection.source.recordSet;
  if (rsName === undefined) {
    diagnostics.push({
      code: 'projection.source',
      message: 'an inline source needs a target that declares no layout — this consumer resolves record sets only',
    });
    return { resolved: null, diagnostics };
  }
  const rs = layout.recordSets[rsName];
  if (rs === undefined) {
    diagnostics.push({ code: 'projection.source.recordSet', message: `the layout declares no record set "${rsName}"` });
    return { resolved: null, diagnostics };
  }
  if (rs.record !== undefined && rs.record !== 'mdx-frontmatter') {
    diagnostics.push({ code: 'projection.record', message: `record set "${rsName}" is not mdx-frontmatter` });
    return { resolved: null, diagnostics };
  }
  const covering = coveringMountFor(rs.dir, projection.mounts);
  if (covering === undefined) {
    diagnostics.push({
      code: 'projection.mount',
      message: `no declared bundle mount covers "${rs.dir}" — the records are unreachable`,
    });
    return { resolved: null, diagnostics };
  }
  const under = covering.subtree === '/' ? rs.dir.slice(1) : rs.dir.slice(covering.subtree.length + 1);
  const sourceDir = [mountPath.replace(/\/+$/, ''), under].filter(Boolean).join('/');

  // §4a.3 (G-BE-14, consumer half): the consumer's `values` must be a subset of the
  // owner's `wellKnown.status.values`. A value outside it is a boot-time diagnostic and
  // the field falls back to the owner's list — never an overflow entry, never a crash.
  const statusField = rs.wellKnown?.status;
  const ownerValues =
    statusField !== undefined && 'values' in statusField && Array.isArray(statusField.values)
      ? (statusField.values as string[])
      : undefined;
  let values: string[] | undefined = projection.map.column?.values;
  if (ownerValues !== undefined && values !== undefined && values.some((v) => !ownerValues.includes(v))) {
    diagnostics.push({
      code: 'projection.values',
      message: 'the projection declares columns outside the owner\'s status vocabulary — using the owner\'s',
    });
    values = ownerValues;
  }
  if (values === undefined) values = ownerValues ?? [];

  // Collision-proof the overflow id against the vocabulary: a value equal to the
  // sentinel would mint two columns with one id (duplicate React keys, ambiguous
  // drag targets), so the sentinel yields until it is distinct.
  let overflowId = OVERFLOW_COLUMN_BASE_ID;
  for (let n = 2; values.includes(overflowId); n++) overflowId = `${OVERFLOW_COLUMN_BASE_ID}-${n}`;

  return {
    resolved: { sourceDir, select: globToRegExp(rs.select ?? '*'), map: projection.map, values, overflowId },
    diagnostics,
  };
}

// ── the store seam (board.ts branches on this) ──────────────────────────────────

/** A Store over a federated bundle view: the mount's announced path as root, the mount's
 *  bundle facts, and the projection resolved against them. Read-only by construction. */
export interface ProjectedStore extends Store {
  bundle: { kind?: string; layout: BundleLayout; diagnostics?: readonly string[] };
  projection: ResolvedProjection;
}

/** The branch condition of `readBoard`/`listBoards`/`cardsDir` (R3-549): a store that
 *  carries BOTH a bundle layout (the host's G-BE-19 hand-off) and a projection resolved
 *  against it. Every other store — including a delegated one whose bundle the app could
 *  not project — takes today's native path unchanged. */
export function isProjectedStore(store: Store): store is ProjectedStore {
  return store.bundle?.layout !== undefined && store.projection !== undefined;
}

/** One `bundle:`-mounted record source announced to this app. */
type BundleViewMount = SandboxMount & { bundle: { kind?: string; layout: BundleLayout; diagnostics?: readonly string[] } };

export type ProjectedResolution =
  | { kind: 'native'; diagnostics: ProjectionDiagnostic[] }
  | { kind: 'waiting'; diagnostics: ProjectionDiagnostic[] }
  | { kind: 'projected'; store: ProjectedStore; diagnostics: ProjectionDiagnostic[] };

/**
 * Derive the projected store for a task boot: read the delegated bundle's own marker,
 * parse its `projection`, and find the announced mount whose layout declares the named
 * record set — the view the marker's `bundle:` mount resolves to. That mount becomes the
 * store (its path is the root the records are read through; its layout is the
 * description), with `mode` forced to `ro`.
 *
 * - `native` — the delegated bundle is not a projection (no marker, no block, or a block
 *   this consumer cannot resolve): the app renders it with today's native read layer.
 * - `waiting` — the projection names a record set no announced mount carries yet; the
 *   view mount may still arrive, so the caller retries on mounts change.
 * - `projected` — the store to render.
 */
export async function resolveProjectedStore(taskStore: Store, mounts: readonly SandboxMount[]): Promise<ProjectedResolution> {
  const text = await readText(`${taskStore.root.replace(/\/+$/, '')}/immediately.run.json`);
  if (text === null) return { kind: 'native', diagnostics: [] };
  let marker: unknown;
  try {
    marker = JSON.parse(text);
  } catch {
    return { kind: 'native', diagnostics: [{ code: 'marker-unparsable', message: 'the bundle marker is not valid JSON' }] };
  }
  const { projection, diagnostics } = parseProjectionMarker(marker);
  if (projection === null) return { kind: 'native', diagnostics };

  const recordSet = projection.source.recordSet;
  if (recordSet === undefined) return { kind: 'native', diagnostics };
  const views = mounts.filter(
    (m): m is BundleViewMount =>
      m.path !== taskStore.root && m.bundle?.layout?.recordSets?.[recordSet] !== undefined,
  );
  if (views.length === 0) return { kind: 'waiting', diagnostics };
  // Correlate the announced views with the marker's own declarations. Re-pruning a
  // view's layout with a declared covering subtree is a no-op when the view's own
  // subtree is AT MOST that covering (nothing the view carries sits outside the
  // covering) — so consistency filters out WIDER views and keeps narrower-or-equal
  // ones; among the consistent, the LARGEST layout is the covering's own resolution
  // (a root covering makes every view consistent, and its resolution is the full
  // prune — the widest of them). Without this, a wide and a narrow view over the same
  // target would be picked by announcement order and the source dir mapped against
  // the wrong one.
  const rsDir = views[0].bundle.layout.recordSets[recordSet]?.dir;
  const covering = rsDir === undefined ? undefined : coveringMountFor(rsDir, projection.mounts);
  const viewFor = (cov: ProjectionMount | undefined): BundleViewMount => {
    if (cov === undefined) return views[0];
    const consistent = views.filter(
      (v) => JSON.stringify(pruneLayoutToView(v.bundle.layout, cov.subtree)) === JSON.stringify(v.bundle.layout),
    );
    const size = (v: BundleViewMount) => JSON.stringify(v.bundle.layout).length;
    return (consistent.length > 0 ? consistent : views).reduce((best, v) => (size(v) > size(best) ? v : best));
  };
  const view = viewFor(covering);
  if (views.length > 1 && covering !== undefined) {
    diagnostics.push({
      code: 'projection.mount',
      message: 'several bundle views announce these records — using the one matching the declared mount',
    });
  }

  const { resolved, diagnostics: resolveDiags } = resolveProjection(projection, view.bundle.layout, view.path);
  const all = [...diagnostics, ...resolveDiags];
  if (resolved === null) return { kind: 'native', diagnostics: all };
  return {
    kind: 'projected',
    // `mode` is the mount's word narrowed to what a projection may ever be: read-only
    // (§4.1 honours `writable` only as `[]`, and no `rw` ride exists in v1).
    store: {
      root: view.path,
      mode: 'ro',
      kind: 'task',
      ...(view.name !== undefined ? { name: view.name } : {}),
      bundle: view.bundle,
      projection: resolved,
    },
    diagnostics: all,
  };
}

// ── read: records → BoardSnapshot ───────────────────────────────────────────────

/** The projected board's meta: one board per bundle, columns from the map's `values` in
 *  display order, plus the overflow column (§4.1 — always present, so an unmapped
 *  record is visible the moment it appears). */
export function projectedBoardMeta(store: ProjectedStore): BoardMeta {
  return {
    id: store.root,
    name: store.name ?? 'Board',
    columns: [
      ...store.projection.values.map((v) => ({ id: v, name: v })),
      { id: store.projection.overflowId, name: OVERFLOW_COLUMN_NAME },
    ],
    created: '',
    updated: '',
  };
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const fieldOf = (record: object, from: string): unknown => {
  let cur: unknown = record;
  for (const seg of from.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
};

/** A missing or non-numeric `order` sorts last within its column (it is display order
 *  only, never written back); the sentinel is JSON-stable, unlike `Infinity`. */
const orderOf = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

/**
 * Materialize the board from the projected records: one card per record in the source
 * record set, `column` from the mapped status (inside `values`) or the overflow group
 * (outside it, or unparseable — display-only, §4.3 rule 4), sorted by `order`. Values
 * render as text downstream; the body rides `description` until the card modal renders
 * it through safe-content.
 */
export async function readProjectedBoard(
  store: ProjectedStore,
  projection: ResolvedProjection,
  previous?: BoardSnapshot,
): Promise<BoardSnapshot | null> {
  const { sourceDir, select, map, values } = projection;
  let names: string[];
  try {
    names = await fs.promises.readdir(sourceDir);
  } catch {
    // The source dir is unreadable (or gone): keep what the reader had rather than
    // flashing an empty board — the poll retries either way.
    return previous ?? null;
  }
  // Keyed by the record FILE, not the projected id: the mid-poll fallback below looks
  // up the reader's previous copy of the SAME record, and an id the frontmatter names
  // need not equal the filename stem.
  const prev = new Map((previous?.cards ?? []).map((c) => [c.sourcePath, c]));
  const cards: Card[] = [];
  for (const name of names.sort()) {
    if (name.startsWith('.') || !select.test(name)) continue;
    const stem = name.replace(/\.mdx?$/, '');
    const record = await readRecord(`${sourceDir}/${name}`);
    if (record === null) {
      // Unreadable mid-poll: keep the reader's copy of the card for this cycle (the
      // native read layer's own precedent) rather than dropping it.
      const fallback = prev.get(name);
      if (fallback) {
        cards.push(fallback);
        continue;
      }
    }
    const column = record === null ? undefined : asString(fieldOf(record, map.column?.from ?? ''));
    const inColumn = column !== undefined && values.includes(column);
    if (record === null || !inColumn) {
      // Unparseable or unmapped: display-only in the overflow group, filename as the
      // title when the record names none (§4.3 rule 4, §4.1) — never written back,
      // never repaired.
      cards.push({
        id: asString(record !== null ? fieldOf(record, map.id?.from ?? '') : undefined) ?? stem,
        title: record !== null ? (asString(fieldOf(record, map.title?.from ?? '')) ?? stem) : stem,
        description: '',
        column: projection.overflowId,
        order: orderOf(record !== null ? fieldOf(record, map.order?.from ?? '') : undefined),
        labels: [],
        due: null,
        by: '',
        // A kind field the map does not name renders empty (§4.1); `created` is never
        // projected by the worked marker, so it stays empty rather than borrowing
        // `updated`.
        created: '',
        updated: asString(record !== null ? fieldOf(record, map.updated?.from ?? '') : undefined) ?? '',
        sourcePath: name,
      });
      continue;
    }
    const labelsRaw = fieldOf(record, map.labels?.from ?? '');
    cards.push({
      id: asString(fieldOf(record, map.id?.from ?? '')) ?? stem,
      title: asString(fieldOf(record, map.title?.from ?? '')) ?? '',
      description: asString(fieldOf(record, map.body?.from ?? '')) ?? '',
      column,
      order: orderOf(fieldOf(record, map.order?.from ?? '')),
      labels: Array.isArray(labelsRaw) ? labelsRaw.filter((l): l is string => typeof l === 'string') : [],
      due: null,
      by: '',
      // A kind field the map does not name renders empty (§4.1): the worked marker
      // projects no `created`, so it stays empty rather than borrowing `updated`.
      created: '',
      updated: asString(fieldOf(record, map.updated?.from ?? '')) ?? '',
      sourcePath: name,
    });
  }
  return { meta: projectedBoardMeta(store), cards };
}

/** One record through the canonical parser (`@immediately-run/mdx-plugins` — never a
 *  regex, never a second YAML library). A read or parse failure is `null`: the record is
 *  display-only, not dropped. */
async function readRecord(path: string): Promise<object | null> {
  const text = await readText(path);
  if (text === null) return null;
  try {
    const { data, body } = parseFrontmatter(text);
    return buildRecord(data as Record<string, unknown>, body);
  } catch {
    return null;
  }
}

/** Re-exported for the fixture tests: the layout half of the marker, through the one
 *  canonical parser, exactly as the host reads it. */
export function parseMarkerLayout(marker: unknown): BundleLayout | null {
  if (!marker || typeof marker !== 'object') return null;
  const layout = (marker as Record<string, unknown>).layout;
  if (layout === undefined) return null;
  return parseBundleLayout(layout).layout;
}
