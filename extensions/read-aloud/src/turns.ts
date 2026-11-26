/**
 * What each chat session holds, in order, kept as its rows render. The chat is a virtual list: rows far from
 * view leave the page, so a long turn is read from this record, not from the rows on the page.
 *
 * Each time the page changes, the rows on it (one unbroken run of the chat) are laid over the record where
 * they match it: by the row element while it stays on the page, else by the block's key or the user message's
 * text. The record keeps each block's text, so the small text cache can drop it later.
 */

/** One row on the page: a user message, the app's "still working" line, or a text block's control. */
export type Seen =
  | { kind: "user"; id: string; row: object }
  | { kind: "waiting"; row: object }
  | { kind: "control"; key: string; text: string | undefined; row: object };

/** The text of a turn, or why it cannot be read: its start never came on the page, or a block's text is gone. */
export type Turn = { text: string } | { missing: "start" | "text" };

interface Entry {
  kind: Seen["kind"];
  /** What matches the row once its element is gone: the block's key or the user message's text. */
  id: string;
  /** The text to speak, for a block. */
  text?: string;
  /** Stands for the row element, which is not kept (a token per row, so a dropped row can be freed). */
  token: object;
}

function idOf(s: Seen): string {
  return s.kind === "control"
    ? `k:${s.key}`
    : s.kind === "user"
      ? `u:${s.id}`
      : "w";
}

export class SessionRecord {
  private entries: Entry[] = [];
  private tokens = new WeakMap<object, object>();
  /** Whether the first entry is the chat's first row: its list was scrolled to the top when it was seen. */
  private fromTop = false;

  /** Lays the rows on the page now over the record. `atTop`: the chat's list is scrolled to its top. */
  see(rows: Seen[], atTop: boolean) {
    if (!rows.length) return;
    const at = new Map<object, number>();
    const byId = new Map<string, number[]>();
    this.entries.forEach((e, i) => {
      at.set(e.token, i);
      const list = byId.get(e.id);
      if (list) list.push(i);
      else byId.set(e.id, [i]);
    });
    // Where each row may be in the record: its own row if known, else every entry with the same id
    const places = rows.map((r) => {
      const token = this.tokens.get(r.row);
      const i = token && at.get(token);
      return i !== undefined ? [i] : (byId.get(idOf(r)) ?? []);
    });
    const fresh = rows.map((r): Entry => {
      const id = idOf(r);
      let text = r.kind === "control" ? r.text : undefined;
      if (r.kind === "control" && text === undefined)
        text = byId
          .get(id)
          ?.map((i) => this.entries[i].text)
          .find((x) => x !== undefined);
      return { kind: r.kind, id, text, token: this.tokens.get(r.row) ?? {} };
    });

    const span = this.span(places, rows.length);
    if (!span) {
      // Nothing on the page matches what was seen before (a jump far up or down): start again from here
      this.entries = fresh;
      this.fromTop = atTop;
    } else {
      const from = Math.max(span.start, 0);
      const to = Math.min(span.end, this.entries.length - 1);
      this.entries.splice(from, to - from + 1, ...fresh);
      if (span.start < 0) this.fromTop = atTop;
      else if (span.start === 0) this.fromTop ||= atTop;
    }
    rows.forEach((r, i) => this.tokens.set(r.row, fresh[i].token));
  }

  /**
   * The record range the rows replace, as first and last index (either may lie outside the record), or null when
   * no row matches. The offset most rows agree on picks among repeated ids; the rows before the first match and
   * after the last one take the places next to them.
   */
  private span(
    places: number[][],
    n: number,
  ): { start: number; end: number } | null {
    const votes = new Map<number, number>();
    places.forEach((ps, i) => {
      for (const p of ps) votes.set(p - i, (votes.get(p - i) ?? 0) + 1);
    });
    let offset: number | null = null;
    for (const [o, v] of votes) {
      const best = offset === null ? 0 : (votes.get(offset) ?? 0);
      if (v > best || (v === best && offset !== null && o > offset)) offset = o;
    }
    if (offset === null) return null;
    const o = offset;
    const near = (i: number) => {
      let best: number | undefined;
      for (const p of places[i])
        if (
          Math.abs(p - i - o) <= n &&
          (best === undefined || Math.abs(p - i - o) < Math.abs(best - i - o))
        )
          best = p;
      return best;
    };
    let first = -1;
    let last = -1;
    for (let i = 0; i < n && first < 0; i++)
      if (near(i) !== undefined) first = i;
    for (let i = n - 1; i >= 0 && last < 0; i--)
      if (near(i) !== undefined) last = i;
    let a = near(first) as number;
    let b = near(last) as number;
    if (a > b) {
      // the first and last matches disagree: keep to the offset most rows agree on
      a = first + o;
      b = last + o;
    }
    return { start: a - first, end: b + (n - 1 - last) };
  }

  /** The turn that ends at the block in this row (or, when the row is unknown, the last block with this key). */
  turnEndingAt(row: object, key: string): Turn {
    const token = this.tokens.get(row);
    let end = token ? this.entries.findIndex((e) => e.token === token) : -1;
    for (let i = this.entries.length - 1; end < 0 && i >= 0; i--)
      if (this.entries[i].id === `k:${key}`) end = i;
    if (end < 0) return { missing: "text" };
    const parts: string[] = [];
    for (let i = end; ; i--) {
      if (i < 0) {
        if (!this.fromTop) return { missing: "start" };
        break;
      }
      const e = this.entries[i];
      if (e.kind === "user") break;
      if (e.kind !== "control") continue;
      if (e.text === undefined) return { missing: "text" };
      if (e.text.trim()) parts.unshift(e.text.trim());
    }
    return { text: parts.join("\n\n") };
  }
}
