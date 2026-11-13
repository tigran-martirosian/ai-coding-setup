// The search box matches the way `map.mjs --near <word>` does, so a word finds the same parts here
// and in a session: an exact id; else a name or id that holds the word; else a word of the
// description; else a file of the part or evidence file of one of its links.

import type { Link, Thing } from "./map.ts";

/** The ids one word means (the `--near` rule), in map order. */
export function find(word: string, things: Thing[], links: Link[]): string[] {
  const w = word.toLowerCase();
  const exact = things.filter((n) => n.id.toLowerCase() === w);
  if (exact.length) return exact.map((n) => n.id);
  const named = things.filter(
    (n) => n.id.toLowerCase().includes(w) || n.name.toLowerCase().includes(w),
  );
  if (named.length) return named.map((n) => n.id);
  const told = things.filter((n) => n.what.toLowerCase().includes(w));
  if (told.length) return told.map((n) => n.id);
  const ids = new Set<string>();
  for (const n of things)
    if (n.files.some((f) => f.toLowerCase().includes(w))) ids.add(n.id);
  for (const l of links) {
    if (l.evidence.some((e) => e.file.toLowerCase().includes(w))) {
      ids.add(l.from);
      ids.add(l.to);
    }
  }
  return things.filter((n) => ids.has(n.id)).map((n) => n.id);
}

export interface Found {
  /** The parts the words mean, in map order. */
  matches: string[];
  /** The matches and the parts one link away from them. */
  shown: Set<string>;
}

/** The words of a query: several words add their parts together. */
export const words = (query: string): string[] =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** null for an empty query (nothing is filtered). */
export function search(
  query: string,
  things: Thing[],
  links: Link[],
): Found | null {
  const ws = words(query);
  if (!ws.length) return null;
  const hit = new Set<string>();
  for (const w of ws) for (const id of find(w, things, links)) hit.add(id);
  const shown = new Set(hit);
  for (const l of links) {
    if (hit.has(l.from)) shown.add(l.to);
    if (hit.has(l.to)) shown.add(l.from);
  }
  return {
    matches: things.filter((n) => hit.has(n.id)).map((n) => n.id),
    shown,
  };
}
