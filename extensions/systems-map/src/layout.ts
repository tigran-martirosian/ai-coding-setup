// Where each part sits on the map: a force layout (Fruchterman-Reingold) that runs to the end at once,
// so the picture never moves while it is read. The same parts, links and seed give the same places.
// With label widths, each part takes the room of its dot and its name under it, so no two names overlap,
// and the result is spread to fill the box: the map opens fitted with every part named.

export interface Place {
  x: number;
  y: number;
}
export interface LayoutOptions {
  width: number;
  height: number;
  seed: number;
  /** Space kept free at every edge: the largest node radius plus a little. */
  pad: number;
  /** The group of each id, in the order of `ids` ('' for none): a weak pull toward the group's centre. */
  groups?: string[];
  /** The radius of each id, in the order of `ids`: parts are kept this far apart, edge to edge, in the result. */
  radii?: number[];
  /** The label width of each id, in the order of `ids` (labelWidth): each part then takes the room of its dot and
   *  its name under it (labelBox), and no two rooms overlap when the box has space for them. */
  labels?: number[];
}

/** A node's radius in the layout's own units: grows with the square root of its link count. */
export const radius = (links: number): number =>
  Math.min(16, 5 + 2.2 * Math.sqrt(links));

/** A small seeded random generator: the same seed gives the same list. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ITERATIONS = 300;
const GROUP_PULL = 0.3;
const GAP = 4;
const SEPARATE_PASSES = 200;
/** Space kept between a label's box and the edge of the box. */
const EDGE = 6;
const OUTLIER_REACH = 1.15;

/** Place for each id; every place lies inside the box minus `pad`. Links to unknown ids are ignored. */
export function layout(
  ids: string[],
  links: Array<[string, string]>,
  o: LayoutOptions,
): Map<string, Place> {
  const n = ids.length;
  const out = new Map<string, Place>();
  if (n === 0) return out;
  const cx = o.width / 2;
  const cy = o.height / 2;
  if (n === 1) return out.set(ids[0], { x: cx, y: cy });

  const index = new Map(ids.map((id, i) => [id, i]));
  const edges: Array<[number, number]> = [];
  for (const [a, b] of links) {
    const i = index.get(a);
    const j = index.get(b);
    if (i !== undefined && j !== undefined && i !== j) edges.push([i, j]);
  }

  const rand = random(o.seed);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const ring = Math.min(o.width, o.height) * 0.35;
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + rand() * 0.5;
    const r = ring * (0.6 + 0.4 * rand());
    x[i] = cx + r * Math.cos(angle);
    y[i] = cy + r * Math.sin(angle);
  }

  // Parts of one group are pulled to the group's centre; a part with no group is not.
  const groupOf = new Int32Array(n).fill(-1);
  const groupIds = new Map<string, number>();
  o.groups?.forEach((g, i) => {
    if (!g || i >= n) return;
    if (!groupIds.has(g)) groupIds.set(g, groupIds.size);
    // biome-ignore lint/style/noNonNullAssertion: the line above sets it
    groupOf[i] = groupIds.get(g)!;
  });
  const gx = new Float64Array(groupIds.size);
  const gy = new Float64Array(groupIds.size);
  const gn = new Float64Array(groupIds.size);

  const k = Math.sqrt((o.width * o.height) / n) * 0.8;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let step = 0; step < ITERATIONS; step++) {
    const temperature = (o.width / 8) * (1 - step / ITERATIONS) + 0.5;
    dx.fill(0);
    dy.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ex = x[i] - x[j];
        let ey = y[i] - y[j];
        let d = Math.hypot(ex, ey);
        if (d < 0.01) {
          ex = rand() - 0.5;
          ey = rand() - 0.5;
          d = Math.hypot(ex, ey) || 1;
        }
        const f = (k * k) / d / d; // repulsion k^2/d, spread over the unit direction
        dx[i] += ex * f;
        dy[i] += ey * f;
        dx[j] -= ex * f;
        dy[j] -= ey * f;
      }
    }
    for (const [i, j] of edges) {
      const ex = x[i] - x[j];
      const ey = y[i] - y[j];
      const d = Math.hypot(ex, ey) || 0.01;
      const f = d / k; // attraction d^2/k, spread over the unit direction
      dx[i] -= ex * f;
      dy[i] -= ey * f;
      dx[j] += ex * f;
      dy[j] += ey * f;
    }
    if (groupIds.size) {
      gx.fill(0);
      gy.fill(0);
      gn.fill(0);
      for (let i = 0; i < n; i++) {
        const g = groupOf[i];
        if (g < 0) continue;
        gx[g] += x[i];
        gy[g] += y[i];
        gn[g]++;
      }
      for (let i = 0; i < n; i++) {
        const g = groupOf[i];
        if (g < 0 || gn[g] < 2) continue;
        dx[i] += (gx[g] / gn[g] - x[i]) * GROUP_PULL;
        dy[i] += (gy[g] / gn[g] - y[i]) * GROUP_PULL;
      }
    }
    for (let i = 0; i < n; i++) {
      dx[i] += (cx - x[i]) * 0.05; // a weak pull to the middle keeps unlinked parts near
      dy[i] += (cy - y[i]) * 0.05;
      const d = Math.hypot(dx[i], dy[i]) || 0.01;
      const m = Math.min(d, temperature);
      x[i] += (dx[i] / d) * m;
      y[i] += (dy[i] / d) * m;
    }
  }

  // A part with few links drifts far out and would shrink everything else to fit it in: bring each part
  // no further from the middle than a little past the 90th percentile of the linked ones (parts with no link
  // at all are often a fifth of a map, so counting them would leave them on the far rim).
  const linked = new Uint8Array(n);
  for (const [i, j] of edges) linked[i] = linked[j] = 1;
  if (n >= 10) {
    let mx = 0,
      my = 0;
    for (let i = 0; i < n; i++) {
      mx += x[i];
      my += y[i];
    }
    mx /= n;
    my /= n;
    const dist = Array.from({ length: n }, (_, i) =>
      Math.hypot(x[i] - mx, y[i] - my),
    );
    const near = dist.filter((_, i) => linked[i]);
    const base = near.length >= 10 ? near : dist;
    const limit =
      [...base].sort((a, b) => a - b)[Math.floor(base.length * 0.9)] *
      OUTLIER_REACH;
    for (let i = 0; i < n; i++) {
      if (dist[i] <= limit) continue;
      x[i] = mx + ((x[i] - mx) / dist[i]) * limit;
      y[i] = my + ((y[i] - my) / dist[i]) * limit;
    }
  }

  // Scale and centre the result to fill the box, whatever size the forces settled at.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  const s = Math.min((o.width - 2 * o.pad) / w, (o.height - 2 * o.pad) / h);
  for (let i = 0; i < n; i++) {
    x[i] = cx + (x[i] - (minX + maxX) / 2) * s;
    y[i] = cy + (y[i] - (minY + maxY) / 2) * s;
  }

  // Each part's room around its centre: its dot, and with a label the name's box under the dot.
  const rad = (i: number) => o.radii?.[i] ?? radius(0);
  const half = new Float64Array(n);
  const up = new Float64Array(n);
  const down = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lw = o.labels?.[i];
    half[i] = lw === undefined ? rad(i) : Math.max(rad(i), lw / 2);
    up[i] = rad(i);
    down[i] = lw === undefined ? rad(i) : labelBox(0, 0, rad(i), lw)[3];
  }
  // Where a centre may go: the dot keeps `pad` from the edges, the label EDGE.
  const lo = (i: number, axis: 0 | 1) =>
    Math.max(o.pad, (axis ? up[i] : half[i]) + EDGE);
  const hi = (i: number, axis: 0 | 1) =>
    (axis ? o.height : o.width) -
    Math.max(o.pad, (axis ? down[i] : half[i]) + EDGE);
  const keep = (i: number) => {
    x[i] = within(x[i], lo(i, 0), hi(i, 0));
    y[i] = within(y[i], lo(i, 1), hi(i, 1));
  };

  // Collision: parts whose rooms overlap are pushed apart along the shorter overlap, half each, until none
  // overlap or the passes run out; the box is kept.
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ox =
          Math.min(x[i] + half[i], x[j] + half[j]) -
          Math.max(x[i] - half[i], x[j] - half[j]) +
          GAP;
        const oy =
          Math.min(y[i] + down[i], y[j] + down[j]) -
          Math.max(y[i] - up[i], y[j] - up[j]) +
          GAP;
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        // Split along the axis they are already further apart on, measured in room sizes, so the picture keeps
        // its shape. Two parts on one spot are split along a fixed direction, so the result stays the same.
        const fx = Math.abs(x[i] - x[j]) / (half[i] + half[j]);
        const fy =
          Math.abs(y[i] - y[j]) / ((up[i] + down[i] + up[j] + down[j]) / 2);
        if (fx >= fy) {
          const s =
            x[i] !== x[j] ? Math.sign(x[i] - x[j]) : (i + j) % 2 ? 1 : -1;
          x[i] += (s * ox) / 2;
          x[j] -= (s * ox) / 2;
        } else {
          const s =
            y[i] !== y[j] ? Math.sign(y[i] - y[j]) : (i + j) % 2 ? 1 : -1;
          y[i] += (s * oy) / 2;
          y[j] -= (s * oy) / 2;
        }
      }
    }
    for (let i = 0; i < n; i++) keep(i);
    if (!moved) break;
  }

  // Fill the box: move the drawing to the middle of its free room, then spread the centres apart as far as the
  // room allows. Spreading never brings two rooms closer, so rooms that were apart stay apart.
  for (const axis of [0, 1] as const) {
    const v = axis ? y : x;
    const mid = (axis ? o.height : o.width) / 2;
    let before = Infinity;
    let after = Infinity;
    for (let i = 0; i < n; i++) {
      before = Math.min(before, v[i] - lo(i, axis));
      after = Math.min(after, hi(i, axis) - v[i]);
    }
    const shift = before >= 0 && after >= 0 ? (after - before) / 2 : 0;
    let spread = Infinity;
    for (let i = 0; i < n; i++) {
      v[i] += shift;
      const d = v[i] - mid;
      if (d > 0.5) spread = Math.min(spread, (hi(i, axis) - mid) / d);
      else if (d < -0.5) spread = Math.min(spread, (lo(i, axis) - mid) / d);
    }
    if (Number.isFinite(spread) && spread > 1)
      for (let i = 0; i < n; i++) v[i] = mid + (v[i] - mid) * spread;
  }
  for (let i = 0; i < n; i++) keep(i);
  for (let i = 0; i < n; i++) out.set(ids[i], { x: x[i], y: y[i] });
  return out;
}

/** v kept between a and b; the middle of the two when there is no room between them. */
const within = (v: number, a: number, b: number) =>
  a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v));

// ---- labels ----

/** The token the labels are drawn in (panel.css `.sm-label`) and measured at, so the two never differ. */
export const LABEL_FONT = "--x-row-title";
/** A label's box height: the 14 px text's ascent and descent (about 17 px) plus a pixel of air. */
export const LABEL_HEIGHT = 18;
/** Where the text's baseline sits, up from the bottom of its box: room for the descenders. */
export const LABEL_BASELINE = 4;
/** Free space left and right of the text inside its box. */
export const LABEL_PAD = 3;
/** Space between a dot and the top of its label's box. */
export const LABEL_GAP = 2;

/** A label's box as [left, top, right, bottom]: always centred under its dot, never above or beside it. */
export const labelBox = (
  x: number,
  y: number,
  r: number,
  width: number,
): [number, number, number, number] => [
  x - width / 2,
  y + r + LABEL_GAP,
  x + width / 2,
  y + r + LABEL_GAP + LABEL_HEIGHT,
];

/** A label's box width: the name as the font draws it, rounded up, plus the space on each side. */
export const labelWidth = (name: string, measure: (text: string) => number) =>
  Math.ceil(measure(name)) + 2 * LABEL_PAD;

/**
 * Measures text in the label font as the browser draws it. The font comes from the shared token, so a change of
 * the type scale changes the boxes too; a missing token is an error, not a guess.
 */
export function labelMeasure(): (text: string) => number {
  const font = getComputedStyle(document.documentElement)
    .getPropertyValue(LABEL_FONT)
    .trim();
  if (!font)
    throw new Error(
      `${LABEL_FONT} is not set: the shared tokens did not load, so the map labels cannot be measured`,
    );
  const pen = document.createElement("canvas").getContext("2d");
  if (!pen) throw new Error("no 2d canvas to measure the map labels with");
  pen.font = font;
  const widths = new Map<string, number>();
  return (text) => {
    let w = widths.get(text);
    if (w === undefined) widths.set(text, (w = pen.measureText(text).width));
    return w;
  };
}
