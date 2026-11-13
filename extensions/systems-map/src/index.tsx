/**
 * Systems map: the project's `.claude/systems-map.json` as a full-screen graph with pan and zoom,
 * a search box and a card for the selected part.
 *
 * The file is read by store.ts; the search rule is in search.ts, the places of the parts in layout.ts.
 * This file only draws them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { PanelHostProps } from "@nimbalyst/extension-sdk";
import "../../shared/tokens.css";
import "./panel.css";
import { t } from "./strings.ts";
import {
  absolute,
  checkLine,
  driftedLinks,
  legend,
  projectName,
  sizeLine,
} from "./map.ts";
import type { Check, Evidence, Link, MapData, Thing } from "./map.ts";
import { search } from "./search.ts";
import { layout, radius } from "./layout.ts";
import type { Place } from "./layout.ts";
import { REFRESH_MS, build, read } from "./store.ts";
import type { Snapshot } from "./store.ts";
import { hostError, hostInvoke as invoke } from "../../shared/host.ts";

const Sym = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined sm-sym" aria-hidden="true">
    {name}
  </span>
);

// ---- reading ------------------------------------------------------------------------------------------------------------------------

interface Reading {
  snapshot: Snapshot | null;
  error: string;
  /** Reading right now (not the first time: the old picture stays up). */
  busy: boolean;
  refresh: () => void;
}

/** Reads on mount, every REFRESH_MS while the panel is on screen, and when it comes back on screen. */
function useReading(
  host: PanelHostProps["host"],
  rootRef: React.RefObject<HTMLDivElement | null>,
): Reading {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const refresh = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const next = await read(host.workspacePath, invoke, (command, options) =>
        host.exec(command, options),
      );
      setSnapshot((old) => (old && old.key === next.key ? old : next));
      setError("");
    } catch (e) {
      setError(hostError(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [host]);

  useEffect(() => {
    refresh();
    const onScreen = () => (rootRef.current?.offsetParent ?? null) !== null;
    const timer = setInterval(() => {
      if (onScreen()) refresh();
    }, REFRESH_MS);
    // A panel the app keeps mounted while another view is shown is read again when it returns.
    let wasOn = onScreen();
    const watcher = new ResizeObserver(() => {
      const now = onScreen();
      if (now && !wasOn) refresh();
      wasOn = now;
    });
    if (rootRef.current) watcher.observe(rootRef.current);
    return () => {
      clearInterval(timer);
      watcher.disconnect();
    };
  }, [refresh, rootRef]);

  return { snapshot, error, busy, refresh };
}

// ---- the graph ----------------------------------------------------------------------------------------------------------------------

const WORLD = { width: 1000, height: 700 };
const SEED = 7;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;
const LABEL_HEIGHT = 15;
const LABEL_CHAR = 6.3; // 12px UI font, average letter

interface View {
  x: number;
  y: number;
  k: number;
}

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** The view that shows the whole layout in a box of this size. */
function fitView(w: number, h: number): View {
  const k = Math.min(w / WORLD.width, h / WORLD.height) * 0.94;
  return { k, x: (w - WORLD.width * k) / 2, y: (h - WORLD.height * k) / 2 };
}

interface GraphProps {
  map: MapData;
  selected: string;
  onSelect: (id: string) => void;
  query: string;
  /** Asked to centre on a part (a changing token, so asking twice for the same part works). */
  focusRequest: { id: string; n: number };
  /** Links whose code changed, as `linkKey`. */
  drifted: Set<string>;
}

const linkKey = (from: string, to: string) => `${from}\u0000${to}`;

function Graph({
  map,
  selected,
  onSelect,
  query,
  focusRequest,
  drifted,
}: GraphProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState("");
  const touched = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const degree = useMemo(() => {
    const d = new Map<string, number>(map.things.map((n) => [n.id, 0]));
    for (const l of map.links) {
      d.set(l.from, (d.get(l.from) ?? 0) + 1);
      d.set(l.to, (d.get(l.to) ?? 0) + 1);
    }
    return d;
  }, [map]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>(
      map.things.map((n) => [n.id, new Set<string>()]),
    );
    for (const l of map.links) {
      m.get(l.from)?.add(l.to);
      m.get(l.to)?.add(l.from);
    }
    return m;
  }, [map]);
  const places = useMemo(
    () =>
      layout(
        map.things.map((n) => n.id),
        map.links.map((l): [string, string] => [l.from, l.to]),
        {
          ...WORLD,
          seed: SEED,
          pad: radius(Math.max(0, ...degree.values())) + 6,
          groups: map.things.map((n) => n.group),
          radii: map.things.map((n) => radius(degree.get(n.id) ?? 0)),
        },
      ),
    [map, degree],
  );
  const found = useMemo(
    () => search(query, map.things, map.links),
    [query, map],
  );

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const watcher = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  // The whole map is shown until the person moves it by hand; a new layout starts again from the whole.
  useEffect(() => {
    touched.current = false;
  }, [places]);
  useEffect(() => {
    if (size.w > 0 && size.h > 0 && !touched.current)
      setView(fitView(size.w, size.h));
  }, [size, places]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    touched.current = true;
    setView((v) => {
      const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  // React attaches wheel listeners as passive ones, which cannot stop the page from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      zoomAt(
        Math.exp(-e.deltaY * 0.0015),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Centre on a part when asked (Enter in the search box, a link in the card).
  useEffect(() => {
    const p = places.get(focusRequest.id);
    if (!p || !focusRequest.n || size.w === 0) return;
    touched.current = true;
    setView((v) => ({
      ...v,
      x: size.w / 2 - p.x * v.k,
      y: size.h / 2 - p.y * v.k,
    }));
  }, [focusRequest, places, size]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      vx: view.x,
      vy: view.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    touched.current = true;
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && (e.target as Element).closest(".sm-node") === null)
      onSelect("");
  };

  const focusId = hover || selected;
  const focusSet = useMemo(
    () =>
      focusId ? new Set([focusId, ...(neighbours.get(focusId) ?? [])]) : null,
    [focusId, neighbours],
  );
  const lit = focusSet ?? found?.shown ?? null;
  const matches = useMemo(() => new Set(found?.matches ?? []), [found]);
  const r = (id: string) =>
    radius(degree.get(id) ?? 0) * clamp(Math.sqrt(view.k), 0.75, 1.5);

  const screen = (p: Place) => ({
    x: p.x * view.k + view.x,
    y: p.y * view.k + view.y,
  });

  // Labels: the focused part and its neighbours first, then matches, then the busiest parts; one that
  // would cover an earlier label is left out. Zooming in makes room for the rest.
  const labels = useMemo(() => {
    const order = [...map.things].sort(
      (a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0),
    );
    const rank = (n: Thing) =>
      n.id === focusId
        ? 0
        : focusSet?.has(n.id)
          ? 1
          : matches.has(n.id)
            ? 2
            : lit && !lit.has(n.id)
              ? 4
              : 3;
    order.sort((a, b) => rank(a) - rank(b));
    const boxes: Array<[number, number, number, number]> = [];
    // label baseline per shown part: under its dot, or above it when the space below is taken
    const shown = new Map<string, number>();
    // dimmed dots fade into the background, so only lit ones keep a label off them
    const dots = map.things.flatMap((m) => {
      const p = places.get(m.id);
      return p && rank(m) !== 4 ? [{ id: m.id, ...screen(p), r: r(m.id) }] : [];
    });
    // a label that would sit on another part's dot is left out, unless it is the one in focus
    const underDot = (id: string, b: [number, number, number, number]) =>
      dots.some(
        (d) =>
          d.id !== id &&
          d.x + d.r > b[0] &&
          d.x - d.r < b[2] &&
          d.y + d.r > b[1] &&
          d.y - d.r < b[3],
      );
    for (const n of order) {
      const p = places.get(n.id);
      if (!p) continue;
      const rk = rank(n);
      if (rk === 4) continue;
      const s = screen(p);
      const w = n.name.length * LABEL_CHAR + 6;
      const rn = r(n.id);
      const below: [number, number, number, number] = [
        s.x - w / 2,
        s.y + rn + 2,
        s.x + w / 2,
        s.y + rn + 2 + LABEL_HEIGHT,
      ];
      const above: [number, number, number, number] = [
        s.x - w / 2,
        s.y - rn - 2 - LABEL_HEIGHT,
        s.x + w / 2,
        s.y - rn - 2,
      ];
      if (
        below[2] < 0 ||
        below[0] > size.w ||
        below[3] < 0 ||
        above[1] > size.h
      )
        continue;
      const free = (box: [number, number, number, number]) =>
        !boxes.some(
          (b) =>
            box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1],
        );
      let box: [number, number, number, number] | undefined;
      if (rk === 0)
        box = [below, above].find((b) => !underDot(n.id, b)) ?? below;
      else box = [below, above].find((b) => free(b) && !underDot(n.id, b));
      // the parts linked to the one in focus may sit over a dimmed dot; never over a label
      if (!box && rk === 1) box = [below, above].find(free);
      if (!box) continue;
      boxes.push(box);
      shown.set(n.id, box[3] - 4);
    }
    return shown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, places, view, size, focusId, focusSet, matches, lit, degree]);

  const name = new Map(map.things.map((n) => [n.id, n.name]));
  const keyRows = useMemo(() => legend(map), [map]);
  const slotOf = useMemo(
    () => new Map(keyRows.map((g) => [g.name, g.slot])),
    [keyRows],
  );
  const lineLit = (l: Link) =>
    focusId
      ? l.from === focusId || l.to === focusId
      : found
        ? found.shown.has(l.from) && found.shown.has(l.to)
        : true;
  const noMatch =
    query.trim() !== "" && found !== null && found.matches.length === 0;

  const key = (e: ReactKeyboardEvent, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="sm-canvas" ref={boxRef}>
      <svg
        ref={svgRef}
        className="sm-svg"
        role="group"
        aria-label={t.graph}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <g>
          {map.links.map((l, i) => {
            const a = places.get(l.from);
            const b = places.get(l.to);
            if (!a || !b) return null;
            const sa = screen(a);
            const sb = screen(b);
            const on = lineLit(l);
            return (
              <line
                key={i}
                className={`sm-edge t-${l.type}${drifted.has(linkKey(l.from, l.to)) ? " is-drift" : ""}${focusId && on ? " is-lit" : ""}${on ? "" : " is-dim"}`}
                x1={sa.x}
                y1={sa.y}
                x2={sb.x}
                y2={sb.y}
              />
            );
          })}
        </g>
        <g>
          {map.things.map((n) => {
            const p = places.get(n.id);
            if (!p) return null;
            const s = screen(p);
            const dim = lit !== null && !lit.has(n.id);
            const cls = [
              "sm-node",
              n.group ? `g${slotOf.get(n.group)}` : "",
              n.id === selected ? "is-selected" : "",
              matches.has(n.id) ? "is-match" : "",
              dim ? "is-dim" : "",
            ];
            return (
              <g
                key={n.id}
                className={cls.filter(Boolean).join(" ")}
                role="button"
                tabIndex={0}
                aria-pressed={n.id === selected}
                aria-label={t.partLabel(n.name, degree.get(n.id) ?? 0)}
                onClick={() => onSelect(n.id)}
                onKeyDown={(e) => key(e, n.id)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover("")}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover("")}
              >
                <circle className="sm-hit" cx={s.x} cy={s.y} r={r(n.id) + 6} />
                <circle className="sm-dot" cx={s.x} cy={s.y} r={r(n.id)} />
              </g>
            );
          })}
        </g>
        {/* labels in their own layer, above every dot, so a neighbour's dot never covers one */}
        <g aria-hidden="true">
          {map.things.map((n) => {
            const p = places.get(n.id);
            if (!p || !labels.has(n.id)) return null;
            const s = screen(p);
            return (
              <text
                key={n.id}
                className="sm-label"
                x={s.x}
                y={labels.get(n.id)}
                textAnchor="middle"
              >
                {name.get(n.id)}
              </text>
            );
          })}
        </g>
      </svg>
      <div className="sm-zoom">
        <button
          type="button"
          className="sm-icon"
          aria-label={t.zoomIn}
          title={t.zoomIn}
          onClick={() => zoomAt(1.4, size.w / 2, size.h / 2)}
        >
          <Sym name="add" />
        </button>
        <button
          type="button"
          className="sm-icon"
          aria-label={t.zoomOut}
          title={t.zoomOut}
          onClick={() => zoomAt(1 / 1.4, size.w / 2, size.h / 2)}
        >
          <Sym name="remove" />
        </button>
        <button
          type="button"
          className="sm-icon"
          aria-label={t.fit}
          title={t.fit}
          onClick={() => {
            touched.current = false;
            setView(fitView(size.w, size.h));
          }}
        >
          <Sym name="fit_screen" />
        </button>
      </div>
      {keyRows.length > 0 && (
        <ul className="sm-legend" aria-label={t.legend}>
          {keyRows.map((g) => (
            <li key={g.name} className="sm-legend-row">
              <span className={`sm-swatch g${g.slot}`} aria-hidden="true" />
              {g.name}
            </li>
          ))}
        </ul>
      )}
      {noMatch && <div className="sm-nomatch">{t.noMatch(query.trim())}</div>}
    </div>
  );
}

// ---- the card -----------------------------------------------------------------------------------------------------------------------

interface CardProps {
  thing: Thing;
  map: MapData;
  gone: Set<string>;
  drift: Check["driftLinks"];
  workspace: string;
  onSelect: (id: string) => void;
  onClose: () => void;
  onOpen: (path: string) => void;
}

function FileList({
  paths,
  gone,
  workspace,
  onOpen,
  changed,
}: {
  paths: string[];
  gone: Set<string>;
  workspace: string;
  onOpen: (p: string) => void;
  /** File to the token it no longer holds. */
  changed?: Map<string, string>;
}) {
  return (
    <ul className="sm-list">
      {paths.map((p) =>
        gone.has(p) ? (
          <li key={p} className="sm-file is-gone" title={t.fileGone}>
            <span className="sm-path">{breakable(p)}</span>
            <span className="sm-aside">{t.fileGone}</span>
          </li>
        ) : (
          <li key={p}>
            <button
              type="button"
              className="sm-file"
              title={absolute(workspace, p)}
              aria-label={t.openFile(p)}
              onClick={() => onOpen(absolute(workspace, p))}
            >
              <span className="sm-path">{breakable(p)}</span>
              {changed?.has(p) && (
                <span className="sm-aside sm-bad">
                  {t.lacks(changed.get(p) ?? "")}
                </span>
              )}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}

/** A path that wraps only after a slash, never inside a file name. */
const breakable = (p: string) =>
  p
    .split("/")
    .flatMap((part, i) => (i ? ["/", <wbr key={i} />, part] : [part]));

function Card({
  thing,
  map,
  gone,
  drift,
  workspace,
  onSelect,
  onClose,
  onOpen,
}: CardProps) {
  const names = new Map(map.things.map((n) => [n.id, n.name]));
  const mine = map.links.filter(
    (l) => l.from === thing.id || l.to === thing.id,
  );
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => setOpen(null), [thing.id]);
  return (
    <aside className="sm-card" aria-label={thing.name}>
      <div className="sm-card-head">
        <h2 className="sm-card-title">{thing.name}</h2>
        <button
          type="button"
          className="sm-icon"
          aria-label={t.close}
          title={t.close}
          onClick={onClose}
        >
          <Sym name="close" />
        </button>
      </div>
      {thing.what && <p className="sm-what">{thing.what}</p>}

      <h3 className="sm-heading">{t.files}</h3>
      {thing.files.length ? (
        <FileList
          paths={thing.files}
          gone={gone}
          workspace={workspace}
          onOpen={onOpen}
        />
      ) : (
        <p className="sm-quiet">{t.noFiles}</p>
      )}

      {thing.notes.length > 0 && (
        <>
          <h3 className="sm-heading">{t.notes}</h3>
          <FileList
            paths={thing.notes}
            gone={gone}
            workspace={workspace}
            onOpen={onOpen}
          />
        </>
      )}

      <h3 className="sm-heading">{t.linksHeading}</h3>
      {mine.length === 0 && <p className="sm-quiet">{t.noLinkRows}</p>}
      <ul className="sm-list">
        {mine.map((l, i) => {
          const out = l.from === thing.id;
          const other = out ? l.to : l.from;
          const hits = drift.filter((d) => d.from === l.from && d.to === l.to);
          const changed = new Map(hits.map((d) => [d.file, d.token]));
          const files = l.evidence.map((e: Evidence) => e.file);
          return (
            <li key={i} className="sm-link">
              <button
                type="button"
                className="sm-link-main"
                onClick={() => onSelect(other)}
              >
                <span className={`sm-link-name${hits.length ? " sm-bad" : ""}`}>
                  {out
                    ? t.linkOut(
                        l.typed ? l.type : "",
                        names.get(other) ?? other,
                      )
                    : t.linkIn(
                        l.typed ? l.type : "",
                        names.get(other) ?? other,
                      )}
                  {hits.length > 0 && (
                    <span className="sm-aside"> · {t.codeChanged}</span>
                  )}
                </span>
                {l.says && <span className="sm-says">{l.says}</span>}
              </button>
              {files.length > 0 && (
                <>
                  <button
                    type="button"
                    className="sm-more"
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {t.evidence(files.length)}
                  </button>
                  {open === i && (
                    <FileList
                      paths={[...new Set(files)]}
                      gone={gone}
                      workspace={workspace}
                      onOpen={onOpen}
                      changed={changed}
                    />
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ---- the panel ----------------------------------------------------------------------------------------------------------------------

function NoMap({ onStarted }: { onStarted: () => void }) {
  const [state, setState] = useState<"idle" | "starting" | "started">("idle");
  const [why, setWhy] = useState("");
  const press = async () => {
    setState("starting");
    setWhy("");
    const refusal = await build(invoke, t.buildSession);
    if (refusal) {
      setWhy(refusal);
      setState("idle");
    } else {
      setState("started");
      onStarted();
    }
  };
  return (
    <div className="sm-empty">
      <h2 className="sm-empty-title">{t.noMapTitle}</h2>
      <p className="sm-quiet">{t.noMapBody}</p>
      <button
        type="button"
        className="sm-btn"
        disabled={state !== "idle"}
        onClick={press}
      >
        {t.build}
      </button>
      {state === "started" && <p className="sm-quiet">{t.buildStarted}</p>}
      {why && <p className="sm-error">{t.buildFailed(why)}</p>}
    </div>
  );
}

function SystemsMapPanel({ host }: PanelHostProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { snapshot, error, busy, refresh } = useReading(host, rootRef);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [focusRequest, setFocusRequest] = useState({ id: "", n: 0 });

  const loaded = snapshot?.loaded;
  const map = loaded?.kind === "map" ? loaded.map : null;
  const thing = map?.things.find((n) => n.id === selected) ?? null;
  useEffect(() => {
    if (selected && !thing) setSelected("");
  }, [selected, thing]);

  const gone = useMemo(() => new Set(snapshot?.check?.gone ?? []), [snapshot]);
  const driftLinks = snapshot?.check?.driftLinks ?? [];
  const drifted = useMemo(
    () =>
      new Set(
        (snapshot?.check?.driftLinks ?? []).map((d) => linkKey(d.from, d.to)),
      ),
    [snapshot],
  );
  const changedCount = snapshot?.check ? driftedLinks(snapshot.check) : 0;
  const select = useCallback((id: string) => {
    setSelected(id);
    if (id) setFocusRequest((f) => ({ id, n: f.n + 1 }));
  }, []);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (selected) setSelected("");
    else if (query) setQuery("");
  };
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter" || !map) return;
    const first = search(query, map.things, map.links)?.matches[0];
    if (first) select(first);
  };

  const check = snapshot ? checkLine(snapshot.check) : null;
  const goneLine =
    snapshot?.check && snapshot.check.gone.length > 0
      ? snapshot.check.gone.join(", ")
      : "";

  let body;
  if (error && !snapshot) {
    body = (
      <div className="sm-empty">
        <h2 className="sm-empty-title">{t.errorTitle}</h2>
        <p className="sm-error">{error}</p>
        <button type="button" className="sm-btn" onClick={refresh}>
          {t.tryAgain}
        </button>
      </div>
    );
  } else if (!snapshot || !loaded) {
    body = <div className="sm-empty sm-quiet">{t.reading}</div>;
  } else if (loaded.kind === "none") {
    body = <NoMap onStarted={refresh} />;
  } else if (loaded.kind === "elsewhere") {
    body = (
      <div className="sm-empty">
        <p>{t.elsewhere(loaded.by)}</p>
      </div>
    );
  } else if (loaded.kind === "error") {
    body = (
      <div className="sm-empty">
        <h2 className="sm-empty-title">{t.errorTitle}</h2>
        <p className="sm-error">{loaded.message}</p>
        <button type="button" className="sm-btn" onClick={refresh}>
          {t.tryAgain}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="sm-main">
        <Graph
          map={loaded.map}
          selected={selected}
          onSelect={select}
          query={query}
          focusRequest={focusRequest}
          drifted={drifted}
        />
        {thing && (
          <Card
            thing={thing}
            map={loaded.map}
            gone={gone}
            drift={driftLinks}
            workspace={host.workspacePath}
            onSelect={select}
            onClose={() => setSelected("")}
            onOpen={(p) => host.openFile(p)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="sm" ref={rootRef} onKeyDown={onKeyDown} data-systems-map>
      <header className="sm-head">
        <div className="sm-titles">
          <h1 className="sm-title">
            {projectName(host.workspacePath) || t.title}
          </h1>
          {map && snapshot && check && (
            <p className="sm-caption">
              <span>{sizeLine(map)}</span>
              {/* changed links get their own line under the header, so the caption does not say it twice */}
              {changedCount === 0 && (
                <>
                  <span className="sm-sep" aria-hidden="true">
                    ·
                  </span>
                  <span className={check.bad ? "sm-bad" : ""} title={goneLine}>
                    {check.text}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        {map && (
          <div className="sm-search">
            <Sym name="search" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              placeholder={t.search}
              aria-label={t.search}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
            {query && (
              <button
                type="button"
                className="sm-icon sm-clear"
                aria-label={t.clearSearch}
                title={t.clearSearch}
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <Sym name="close" />
              </button>
            )}
          </div>
        )}
        {snapshot && (
          <button
            type="button"
            className="sm-icon"
            aria-label={t.refresh}
            title={t.refresh}
            disabled={busy}
            onClick={refresh}
          >
            <Sym name="refresh" />
          </button>
        )}
      </header>
      {changedCount > 0 && snapshot?.check && (
        <p
          className="sm-gone"
          role="status"
          title={snapshot.check.drift.join(", ")}
        >
          {t.banner(changedCount, snapshot.check.gone.length)}
        </p>
      )}
      {goneLine && (
        <p className="sm-gone" title={goneLine}>
          {goneLine}
        </p>
      )}
      {error && snapshot && <p className="sm-gone">{error}</p>}
      {body}
    </div>
  );
}

export function activate() {}
export function deactivate() {}

export const panels = {
  "systems-map": { component: SystemsMapPanel },
};
