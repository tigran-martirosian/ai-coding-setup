// The map file: what it holds, which of the five screens it means, and what `map.mjs --check` says about it.

import { t } from './strings.ts';

export const MAP_REL = '.claude/systems-map.json';

export interface Thing {
  id: string;
  name: string;
  what: string;
  files: string[];
  notes: string[];
  /** Colours and clusters the part; '' when it has none. */
  group: string;
  /** Regexes for matching a brief; not shown. */
  words: string[];
}
export const LINK_TYPES = ['uses', 'feeds', 'spends', 'opens', 'boosts', 'limits'] as const;
export type LinkType = (typeof LINK_TYPES)[number];
export interface Evidence {
  file: string;
  /** Text that must still be in the file; absent when the entry is a plain path. */
  token?: string;
}
export interface Link {
  from: string;
  to: string;
  type: LinkType;
  /** The file names the type; an untyped link reads "to X" in the card, as in `map.mjs`. */
  typed: boolean;
  says: string;
  evidence: Evidence[];
}
export interface MapData {
  things: Thing[];
  links: Link[];
}

export type Loaded =
  | { kind: 'none' }
  | { kind: 'elsewhere'; by: string }
  | { kind: 'error'; message: string }
  | { kind: 'map'; map: MapData };

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
const text = (x: unknown): string => (typeof x === 'string' ? x : '');

/** An evidence entry is a path or `{ file, token }`; anything else is left out. */
function evidenceOf(x: unknown): Evidence[] {
  if (!Array.isArray(x)) return [];
  const out: Evidence[] = [];
  for (const e of x) {
    if (typeof e === 'string') out.push({ file: e });
    else if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).file === 'string') {
      const o = e as Record<string, unknown>;
      const file = o.file as string;
      out.push(typeof o.token === 'string' && o.token ? { file, token: o.token } : { file });
    }
  }
  return out;
}

/** The colour slots a group can take (`--x-group-1` to `--x-group-8` in panel.css). */
export const GROUP_SLOTS = 8;

/** The slot (1 to 8) of a group name: the same name gives the same slot in every map. */
export function groupSlot(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  return (h % GROUP_SLOTS) + 1;
}

/**
 * The legend: one row per group, by name; empty when no part has a group. Each group keeps its own slot
 * unless an earlier name already took it; then it moves to the next free one, so up to 8 groups never share
 * a colour.
 */
export function legend(map: MapData): Array<{ name: string; slot: number }> {
  const names = [...new Set(map.things.map((n) => n.group).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const taken = new Set<number>();
  return names.map((name) => {
    let slot = groupSlot(name);
    for (let i = 0; i < GROUP_SLOTS && taken.has(slot); i++) slot = (slot % GROUP_SLOTS) + 1;
    taken.add(slot);
    return { name, slot };
  });
}

/** The screen a file's text means. `null` is a file that does not exist. */
export function classify(raw: string | null): Loaded {
  if (raw === null) return { kind: 'none' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { kind: 'error', message: t.badJson((e as Error).message) };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { kind: 'error', message: t.notObject };
  const file = data as Record<string, unknown>;
  if (!Array.isArray(file.nodes)) {
    if (typeof file.handledBy === 'string') return { kind: 'elsewhere', by: file.handledBy };
    return { kind: 'error', message: t.noNodes };
  }
  if (file.links !== undefined && !Array.isArray(file.links)) return { kind: 'error', message: t.noLinks };

  const things: Thing[] = [];
  const seen = new Set<string>();
  for (const [k, n] of file.nodes.entries()) {
    const o = (n && typeof n === 'object' ? n : {}) as Record<string, unknown>;
    const id = text(o.id);
    if (!id) return { kind: 'error', message: t.noId(k + 1) };
    if (seen.has(id)) return { kind: 'error', message: t.twoIds(id) };
    seen.add(id);
    things.push({
      id,
      name: text(o.name) || id,
      what: text(o.what),
      files: strings(o.files),
      notes: strings(o.notes),
      group: text(o.group),
      words: strings(o.words),
    });
  }
  // A link to a part that is not on the map has nothing to draw; `--check` reports it.
  const links: Link[] = [];
  for (const l of (file.links ?? []) as unknown[]) {
    const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
    const from = text(o.from);
    const to = text(o.to);
    // An unknown type reads as `uses`; `--check` reports it.
    const typed = (LINK_TYPES as readonly string[]).includes(text(o.type));
    const type = typed ? (text(o.type) as LinkType) : 'uses';
    if (seen.has(from) && seen.has(to)) links.push({ from, to, type, typed, says: text(o.says), evidence: evidenceOf(o.evidence) });
  }
  return { kind: 'map', map: { things, links } };
}

export interface Check {
  /** Paths the map lists that are not on disk. */
  gone: string[];
  /** Files that no longer hold a link's token, one entry for each DRIFT line. */
  drift: string[];
  /** The same lines in full, so a card can flag the link. */
  driftLinks: Array<{ file: string; from: string; to: string; token: string }>;
  /** Mistakes in the JSON, as `map.mjs` words them. */
  bad: string[];
}

/** The output of `map.mjs --check`; null when it is not that output (script missing, node failed). */
export function parseCheck(stdout: string): Check | null {
  const lines = stdout.split(/\r?\n/);
  if (!lines.some((l) => /^(ok|FAIL): /.test(l))) return null;
  const gone: string[] = [];
  const bad: string[] = [];
  const drift: string[] = [];
  const driftLinks: Check['driftLinks'] = [];
  for (const l of lines) {
    const g = /^GONE (.+?) {2}\(/.exec(l);
    const d = /^DRIFT (.+?) {2}\(link (.+?) -> (.+?)\): no longer has: (.*)$/.exec(l);
    if (g) gone.push(g[1]);
    else if (d) {
      drift.push(d[1]);
      driftLinks.push({ file: d[1], from: d[2], to: d[3], token: d[4] });
    } else if (l.startsWith('BAD  ')) bad.push(l.slice(5));
  }
  return { gone, drift, driftLinks, bad };
}

/** How many links have code that changed under them (a link counts once, however many tokens went). */
export const driftedLinks = (check: Check): number => new Set(check.driftLinks.map((d) => `${d.from}\u0000${d.to}`)).size;

/** The quiet line under the title: how big the map is, in one sentence of parts. */
export function sizeLine(map: MapData): string {
  return `${t.parts(map.things.length)} · ${t.links(map.links.length)}`;
}

/** "3 paths gone", "all paths found" or nothing sure; `tone` says if it is shown in the error colour. */
export function checkLine(check: Check | null): { text: string; bad: boolean } {
  if (!check) return { text: t.checkUnavailable, bad: false };
  const parts: string[] = [];
  if (check.gone.length) parts.push(t.pathsGone(check.gone.length));
  if (check.drift.length) parts.push(t.linksChanged(driftedLinks(check)));
  if (check.bad.length) parts.push(t.mistakes(check.bad.length));
  return parts.length ? { text: parts.join(', '), bad: true } : { text: t.pathsFound, bad: false };
}

const ABSOLUTE = /^([A-Za-z]:[\\/]|\/)/;

/** The path a click opens: a path in the map is relative to the project unless it is already absolute. */
export function absolute(workspace: string, p: string): string {
  const w = workspace.replace(/\\/g, '/').replace(/\/+$/, '');
  const f = p.replace(/\\/g, '/');
  return ABSOLUTE.test(f) ? f : `${w}/${f.replace(/^\.\//, '')}`;
}

export const projectName = (workspace: string): string => workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
