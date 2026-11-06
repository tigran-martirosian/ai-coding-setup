import React from "react";
import { clamp, ease, FADE, Field, glide, Head, mix, sec, Typed, useTick, Wire } from "./kit";
import { accent, color, FLOOR, MARGIN, TOP, TYPE } from "./look";
import { Shot } from "./script";
import { need } from "./need";

const ink = accent.Steer;

/** Where each part of the sample project sits on the map, by its centre: the page on the left, what it calls in
 * the middle, the tests and docs on the right. */
const PLACES = [
  { x: 250, y: 580 },
  { x: 700, y: 580 },
  { x: 1180, y: 380 },
  { x: 1180, y: 780 },
  { x: 1180, y: 580 },
  { x: 1650, y: 620 },
  { x: 1650, y: 400 },
];
const NODE_W = 300;
const NODE_H = 84;

/** The map stands still. One link is changed and lights up along its length; the two parts at its ends light, then
 * the parts the change reaches next, and the map says what to check. */
export const SystemsMap: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { parts, links, changed, check } = need(shot.body, "map");
  if (parts.length !== PLACES.length) throw new Error(`The map has ${parts.length} parts and ${PLACES.length} places.`);
  const [from, to] = links[changed];
  const lightAt = sec(1);
  const endsAt = sec(2.2);
  const nextAt = sec(3);
  const next = links.filter(([a]) => a === to).map(([, b]) => b);
  const lit = (i: number) => (i === from || i === to ? ease(t, endsAt, sec(0.5)) : next.includes(i) ? 0.6 * ease(t, nextAt + next.indexOf(i) * sec(0.3), sec(0.5)) : 0);
  const out = (i: number) => ({ x: PLACES[i].x + NODE_W / 2, y: PLACES[i].y });
  const inn = (i: number) => ({ x: PLACES[i].x - NODE_W / 2, y: PLACES[i].y });
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      {links.map(([a, b], i) => (
        <Wire key={i} a={out(a)} b={inn(b)} draw={1} ink={color.faint} />
      ))}
      <Wire a={out(from)} b={inn(to)} draw={glide(t, lightAt, sec(1))} ink={ink} width={5} />
      {next.map((b, i) => (
        <Wire key={b} a={out(to)} b={inn(b)} draw={glide(t, nextAt + i * sec(0.3), sec(0.7))} ink={mix(color.faint, ink, 0.6)} width={4} />
      ))}
      <div style={{ position: "absolute", left: (out(from).x + inn(to).x) / 2 - 90, top: (PLACES[from].y + PLACES[to].y) / 2 - 64, width: 180, textAlign: "center", fontSize: TYPE.label, color: ink, opacity: ease(t, lightAt + sec(0.5), FADE) }}>changed</div>
      {parts.map((part, i) => {
        const on = lit(i);
        return (
          <div
            key={part}
            style={{
              position: "absolute",
              left: PLACES[i].x - NODE_W / 2,
              top: PLACES[i].y - NODE_H / 2,
              width: NODE_W,
              height: NODE_H,
              borderRadius: 10,
              border: `2px solid ${mix(color.line, ink, on)}`,
              background: on > 0 ? mix(color.window, "#2a2614", on) : color.window,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              whiteSpace: "nowrap",
              color: mix(color.dim, color.text, Math.max(on, 0.5)),
            }}
          >
            {part}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: MARGIN, top: 900, fontSize: 40, fontWeight: 600, opacity: ease(t, nextAt + sec(1), sec(0.5)) }}>
        <span style={{ color: ink }}>→ </span>
        {check}
      </div>
    </Field>
  );
};

const SESSION = { x: MARGIN, y: TOP, w: 1100, h: 700 };
const NOTE = { x: 1240, y: TOP, w: 1920 - MARGIN - 1240, h: 200 };
const LINE = 64;
const FIRST = TOP + 62 + 30;

/** The session keeps working, a line at a time. Beside it a note is typed and sent; it slides into the session
 * without stopping it, and the agent's next step is the note. */
export const Btw: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { work, note, picked } = need(shot.body, "btw");
  const lineAt = (i: number) => (i < 3 ? -1 : sec(0.8 + (i - 3) * 0.8));
  const typedAt = sec(0.4);
  const sendAt = typedAt + note.length / 0.8 + sec(0.3);
  // The note drops down beside the session, then slides left into it, so it never crosses the lines being written.
  const drop = glide(t, sendAt + sec(0.2), sec(0.5));
  const slide = glide(t, sendAt + sec(0.7), sec(0.7));
  const pickAt = lineAt(work.length - 1) + sec(0.9);
  const picking = ease(t, pickAt, sec(0.5));
  const strip = { x: SESSION.x + 28, y: SESSION.y + SESSION.h - 96 };
  const card = { x: NOTE.x + 28 + (strip.x - NOTE.x - 28) * slide, y: NOTE.y + 84 + (strip.y - NOTE.y - 84) * drop, w: NOTE.w - 56 + (SESSION.w - NOTE.w) * slide };
  const rows = [...work, picked];
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div style={{ position: "absolute", left: SESSION.x, top: SESSION.y, width: SESSION.w, height: SESSION.h, border: `2px solid ${color.line}`, borderRadius: 12, background: color.window }}>
        <div style={{ height: 62, display: "flex", alignItems: "center", gap: 16, padding: "0 30px", fontSize: TYPE.label, color: color.dim, borderBottom: `1px solid ${color.line}` }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: color.good }} />
          Session: working
        </div>
      </div>
      {rows.map((row, i) => {
        const at = i === work.length ? pickAt : lineAt(i);
        return (
          <div key={row} style={{ position: "absolute", left: SESSION.x + 30, top: FIRST + i * LINE, fontSize: 32, whiteSpace: "pre", opacity: at < 0 ? 1 : ease(t, at, FADE) }}>
            <span style={{ color: color.dim }}>{row.slice(0, 7)}</span>
            <span style={{ color: i === work.length ? ink : color.text }}>{row.slice(7)}</span>
          </div>
        );
      })}

      <div style={{ position: "absolute", left: NOTE.x, top: NOTE.y, width: NOTE.w, height: NOTE.h, border: `2px solid ${color.line}`, borderRadius: 12, background: color.window }}>
        <div style={{ height: 62, display: "flex", alignItems: "center", padding: "0 28px", fontSize: TYPE.label, color: color.dim, borderBottom: `1px solid ${color.line}` }}>Note, or /btw</div>
        <div style={{ padding: "28px 28px", fontSize: TYPE.body, color: color.text, opacity: t < sendAt + sec(0.2) ? 1 : 0 }}>
          <Typed text={note} at={typedAt} speed={0.8} cursor />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: NOTE.x + NOTE.w - 220,
          top: NOTE.y + NOTE.h + 24,
          width: 220,
          height: 70,
          borderRadius: 8,
          border: `2px solid ${mix(color.line, ink, ease(t, sendAt - sec(0.2), sec(0.3)) * (1 - ease(t, sendAt + sec(0.6), sec(0.5))))}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 30,
          color: color.text,
        }}
      >
        Send
      </div>
      {t >= sendAt + sec(0.2) ? (
        <div
          style={{
            position: "absolute",
            left: card.x,
            top: card.y,
            width: card.w,
            height: 70,
            borderRadius: 8,
            border: `2px solid ${mix(ink, color.line, picking)}`,
            background: color.raised,
            display: "flex",
            alignItems: "center",
            gap: 18,
            padding: "0 22px",
            fontSize: 32,
            whiteSpace: "nowrap",
            overflow: "hidden",
            color: color.text,
          }}
        >
          <span style={{ color: ink }}>Your note:</span>
          {note}
          <span style={{ marginLeft: "auto", fontSize: TYPE.label, color: color.good, opacity: picking }}>picked up</span>
        </div>
      ) : null}
    </Field>
  );
};

/** A quiet grid naming the rest of the setup. Nothing in it moves but one highlight, gliding from tile to tile. */
export const Also: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { tiles } = need(shot.body, "tiles");
  const across = 2;
  const gap = 16;
  const w = (1920 - 2 * MARGIN - (across - 1) * gap) / across;
  const h = (FLOOR - TOP - 20 - 3 * gap) / 4;
  const place = tiles.reduce((sum, _, i) => sum + (i ? glide(t, sec(0.6 + (i - 1) * 0.6), sec(0.4)) : 0), 0);
  const at = (i: number) => ({ x: MARGIN + (i % across) * (w + gap), y: TOP + 20 + Math.floor(i / across) * (h + gap) });
  const low = Math.floor(place);
  const share = place - low;
  const a = at(low);
  const b = at(Math.min(tiles.length - 1, low + 1));
  const band = { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={accent.Overview} />
      <div style={{ position: "absolute", left: band.x, top: band.y, width: w, height: h, borderRadius: 12, background: color.raised, border: `2px solid ${accent.Overview}` }} />
      {tiles.map((tile, i) => {
        const on = clamp(1 - Math.abs(i - place));
        return (
          <div key={tile.name} style={{ position: "absolute", left: at(i).x, top: at(i).y, width: w, height: h, borderRadius: 12, border: `2px solid ${color.line}`, padding: "22px 34px", boxSizing: "border-box" }}>
            <div style={{ fontSize: 56, fontWeight: 700, whiteSpace: "nowrap", color: mix(color.dim, color.text, Math.max(on, 0.6)) }}>{tile.name}</div>
            <div style={{ fontSize: 34, lineHeight: 1.35, marginTop: 8, color: color.dim }}>{tile.note}</div>
          </div>
        );
      })}
    </Field>
  );
};
