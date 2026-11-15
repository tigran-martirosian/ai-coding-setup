import type React from "react";
import { Img, staticFile } from "remotion";
import {
  Count,
  ease,
  FADE,
  Field,
  glide,
  Head,
  mix,
  sec,
  useTick,
  Window,
  Wire,
} from "./kit";
import { accent, color, FLOOR, MARGIN, TOP, TYPE } from "./look";
import { need } from "./need";
import type { Shot } from "./script";

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

/** The map stands still. One part is changed and lights up; the links that touch it draw over, the parts at their
 * other ends light dimmer, and the map says what to check next and how. */
export const SystemsMap: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { parts, links, changed, check, howTo } = need(shot.body, "map");
  if (parts.length !== PLACES.length)
    throw new Error(
      `The map has ${parts.length} parts and ${PLACES.length} places.`,
    );
  if (!parts[changed])
    throw new Error(
      `The map's changed part ${changed} is not one of its ${parts.length} parts.`,
    );
  const lightAt = sec(1);
  const wireAt = sec(1.6);
  const nextAt = sec(2);
  const step = sec(0.3);
  // The links that touch the changed part, in either direction, and the part at each one's other end.
  const touched = links.filter(([a, b]) => a === changed || b === changed);
  const next = touched.map(([a, b]) => (a === changed ? b : a));
  const lit = (i: number) =>
    i === changed
      ? ease(t, lightAt, sec(0.5))
      : next.includes(i)
        ? 0.6 * ease(t, nextAt + next.indexOf(i) * step, sec(0.5))
        : 0;
  const out = (i: number) => ({ x: PLACES[i].x + NODE_W / 2, y: PLACES[i].y });
  const inn = (i: number) => ({ x: PLACES[i].x - NODE_W / 2, y: PLACES[i].y });
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      {links.map(([a, b], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn once per video frame; it never reorders and holds no state
        <Wire key={i} a={out(a)} b={inn(b)} draw={1} ink={color.faint} />
      ))}
      {touched.map(([a, b], k) => (
        <Wire
          key={`${a}-${b}`}
          a={out(a)}
          b={inn(b)}
          draw={glide(t, wireAt + k * step, sec(0.7))}
          ink={mix(color.faint, ink, 0.6)}
          width={4}
        />
      ))}
      <div
        style={{
          position: "absolute",
          left: PLACES[changed].x - 90,
          top: PLACES[changed].y - NODE_H / 2 - 52,
          width: 180,
          textAlign: "center",
          fontSize: TYPE.label,
          color: ink,
          opacity: ease(t, sec(1.3), FADE),
        }}
      >
        changed
      </div>
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
              background:
                on > 0 ? mix(color.window, "#2a2614", on) : color.window,
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
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          top: 872,
          fontSize: 40,
          fontWeight: 600,
          opacity: ease(t, sec(3.2), sec(0.5)),
        }}
      >
        <span style={{ color: ink }}>→ </span>
        {check}
      </div>
      <div
        style={{
          position: "absolute",
          left: MARGIN + 48,
          top: 936,
          fontSize: TYPE.sub,
          color: color.dim,
          opacity: ease(t, sec(3.7), sec(0.5)),
        }}
      >
        {howTo}
      </div>
    </Field>
  );
};

/** The window around the page picture: the full width between the margins, from under the headline to the floor. */
const PAGE = {
  x: MARGIN,
  y: TOP + 20,
  w: 1920 - 2 * MARGIN,
  h: FLOOR - TOP - 20,
};
/** Film px to a CSS px of the page, set by hand from public/job-page.png (the page column, 984 CSS px wide, taken at
 * 2x from the fixture at a 1724 px wide window): the window's inner width over the column's width, about 1.8, so the
 * page's 14 px rows show at about 25 px. */
const PAGE_SCALE = (PAGE.w - 4) / 984;
/** The picture's width in film px: the whole inner width of the window. */
const PAGE_PICTURE_W = 984 * PAGE_SCALE;
/** How far the picture glides up, in film px, set by hand from the same picture: the glide ends with the top of the
 * Needs you group (204 CSS px down the picture) 14 px under the window's label bar; the end of the Running group then
 * leaves the frame at the bottom. Take both again when the picture changes. */
const PAGE_GLIDE = 204 * PAGE_SCALE - 14;

/** A real picture of a Nimbalyst page in a window frame. It stands still on the page's top (the job's name, its
 * progress line and bar), glides down once to show the groups, then stays. */
export const JobPage: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { label, picture } = need(shot.body, "page");
  const t = useTick();
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <Window
        label={label}
        style={{ left: PAGE.x, top: PAGE.y, width: PAGE.w, height: PAGE.h }}
        bodyStyle={{ padding: 0 }}
      >
        <Img
          src={staticFile(picture)}
          style={{
            position: "absolute",
            // Centred in the window's inner width (its 2 px outline on each side)
            left: (PAGE.w - 4 - PAGE_PICTURE_W) / 2,
            top: -PAGE_GLIDE * glide(t, 30, 84),
            width: PAGE_PICTURE_W,
          }}
        />
      </Window>
    </Field>
  );
};

/** A quiet grid naming what is in the setup. Every tile stands from the first frame; the one motion is the numbers in
 * the names counting up once, together. */
export const Also: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { tiles } = need(shot.body, "tiles");
  const across = 2;
  const gap = 16;
  const w = (1920 - 2 * MARGIN - (across - 1) * gap) / across;
  const h = (FLOOR - TOP - 20 - 3 * gap) / 4;
  const at = (i: number) => ({
    x: MARGIN + (i % across) * (w + gap),
    y: TOP + 20 + Math.floor(i / across) * (h + gap),
  });
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={accent.Overview} />
      {tiles.map((tile, i) => {
        // A name that starts with a number, like "51 hooks", counts up to it while the shot fades in, so it lands by
        // 0.5 s; any other name prints as it is.
        const counted = tile.name.match(/^(\d+) (.+)$/);
        return (
          <div
            key={tile.name}
            style={{
              position: "absolute",
              left: at(i).x,
              top: at(i).y,
              width: w,
              height: h,
              borderRadius: 12,
              border: `2px solid ${color.line}`,
              padding: "22px 34px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                fontSize: 56,
                fontWeight: 700,
                whiteSpace: "nowrap",
                color: color.text,
              }}
            >
              {counted ? (
                <>
                  <Count to={Number(counted[1])} at={0} len={sec(0.5)} />{" "}
                  {counted[2]}
                </>
              ) : (
                tile.name
              )}
            </div>
            <div
              style={{
                fontSize: 34,
                lineHeight: 1.35,
                marginTop: 8,
                color: color.dim,
              }}
            >
              {tile.note}
            </div>
          </div>
        );
      })}
    </Field>
  );
};
