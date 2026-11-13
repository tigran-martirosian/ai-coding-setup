// Where each part sits on the map: a force layout (Fruchterman-Reingold) that runs to the end at once,
// so the picture never moves while it is read. The same parts, links and seed give the same places.

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
const SEPARATE_PASSES = 40;
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
  // no further from the middle than a little past the 90th percentile of the others.
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
    const limit =
      [...dist].sort((a, b) => a - b)[Math.floor(n * 0.9)] * OUTLIER_REACH;
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

  // Collision: parts that touch are pushed apart, half each, a few passes; the box is kept.
  const rad = (i: number) => o.radii?.[i] ?? radius(0);
  for (let pass = 0; pass < SEPARATE_PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ex = x[i] - x[j];
        const ey = y[i] - y[j];
        const want = rad(i) + rad(j) + GAP;
        const d = Math.hypot(ex, ey);
        if (d >= want) continue;
        moved = true;
        // Two parts on one spot are split along a fixed direction, so the result stays the same for a seed.
        const ux = d > 0.01 ? ex / d : Math.cos(i + j);
        const uy = d > 0.01 ? ey / d : Math.sin(i + j);
        const push = (want - d) / 2;
        x[i] += ux * push;
        y[i] += uy * push;
        x[j] -= ux * push;
        y[j] -= uy * push;
      }
    }
    for (let i = 0; i < n; i++) {
      x[i] = Math.min(o.width - o.pad, Math.max(o.pad, x[i]));
      y[i] = Math.min(o.height - o.pad, Math.max(o.pad, y[i]));
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) out.set(ids[i], { x: x[i], y: y[i] });
  return out;
}
