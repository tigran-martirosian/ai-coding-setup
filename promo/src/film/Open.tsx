import React from "react";
import {
  clamp,
  Count,
  Fade,
  Field,
  glide,
  Head,
  sec,
  Typed,
  useTick,
} from "./kit";
import { accent, color, MARGIN, TYPE, WIDTH } from "./look";
import { ALONE_LABEL, SETUP_LABEL, Shot } from "./script";
import { need } from "./need";

const ink = accent.Overview;
const OPEN_SIZE = 68;
/** Typing speed of the opening lines, in letters a tick: about 18 a second. */
const SPEED = 0.75;

/** The film opens like a terminal: the problem and the answer type in as a command would, then the name fades in under them. */
export const Title: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { lines, name } = need(shot.body, "open");
  const starts = lines.reduce<number[]>(
    (at, line, i) => [
      ...at,
      i ? at[i - 1] + lines[i - 1].length / SPEED + sec(0.3) : sec(0.3),
    ],
    [],
  );
  const typedAt =
    starts[starts.length - 1] + lines[lines.length - 1].length / SPEED;
  return (
    <Field>
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          right: MARGIN,
          top: 380,
          fontSize: OPEN_SIZE,
          fontWeight: 600,
          lineHeight: 1.5,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={line}
            style={{
              display: "flex",
              gap: 28,
              whiteSpace: "nowrap",
              opacity: t >= starts[i] ? 1 : 0,
            }}
          >
            <span style={{ color: i === 0 ? color.faint : ink }}>›</span>
            <span style={{ color: i === lines.length - 1 ? ink : color.text }}>
              <Typed
                text={line}
                at={starts[i]}
                speed={SPEED}
                cursor={i === lines.length - 1 ? "stay" : true}
              />
            </span>
          </div>
        ))}
        <Fade
          at={typedAt + sec(0.4)}
          len={sec(0.6)}
          style={{
            marginTop: 90,
            fontSize: 44,
            fontWeight: 400,
            color: color.dim,
            paddingLeft: OPEN_SIZE * 0.6 + 28,
          }}
        >
          {name}
        </Fade>
      </div>
    </Field>
  );
};

const ROW = 128;
const ROWS_TOP = 300;
const SPLIT = 900;

/** The whole table is there from the first frame, every row readable. A quiet band rests on the first row, then
 * glides down it, one row every 1.4 s. */
export const Compare: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { rows } = need(shot.body, "compare");
  const place = rows.reduce(
    (sum, _, i) =>
      sum + (i ? glide(t, sec(2.5 + (i - 1) * 1.4), sec(0.6)) : 0),
    0,
  );
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div
        style={{
          position: "absolute",
          top: ROWS_TOP - 52,
          left: MARGIN,
          fontSize: TYPE.label,
          color: color.dim,
        }}
      >
        {ALONE_LABEL}
      </div>
      <div
        style={{
          position: "absolute",
          top: ROWS_TOP - 52,
          left: SPLIT + 40,
          fontSize: TYPE.label,
          fontWeight: 600,
          color: ink,
        }}
      >
        {SETUP_LABEL}
      </div>
      <div
        style={{
          position: "absolute",
          top: ROWS_TOP - 60,
          height: 60 + rows.length * ROW,
          left: SPLIT,
          width: 1,
          background: color.line,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: MARGIN - 28,
          right: MARGIN - 28,
          top: ROWS_TOP + 4 + place * ROW,
          height: ROW - 8,
          borderRadius: 10,
          background: color.raised,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 4,
            background: ink,
          }}
        />
      </div>
      {rows.map((row, i) => {
        const lit = clamp(1 - Math.abs(i - place));
        return (
          <div
            key={row.topic}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: ROWS_TOP + i * ROW,
              height: ROW,
              opacity: 0.85 + 0.15 * lit,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: MARGIN,
                width: SPLIT - MARGIN - 30,
                top: 20,
              }}
            >
              <div style={{ fontSize: TYPE.label, color: color.dim }}>
                {row.topic}
              </div>
              <div
                style={{
                  fontSize: 32,
                  lineHeight: 1.2,
                  marginTop: 8,
                  whiteSpace: "nowrap",
                  color: color.dim,
                }}
              >
                {row.alone}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: SPLIT + 40,
                right: MARGIN,
                top: 0,
                height: ROW,
                display: "flex",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  fontSize: TYPE.body,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  whiteSpace: "nowrap",
                  color: color.text,
                }}
              >
                {row.setup}
              </div>
            </div>
          </div>
        );
      })}
    </Field>
  );
};

const RESULTS_TOP = 290;
const RESULT_ROW = 190;

/** Three measured figures, strongest first, each with what it counts and where it comes from. Everything stands
 * from the first frame; the one motion is the three figures counting up together. */
export const Results: React.FC<{ shot: Shot }> = ({ shot }) => {
  const { figures } = need(shot.body, "results");
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      {figures.map((f, i) => {
        const row = RESULTS_TOP + i * RESULT_ROW;
        return (
          <React.Fragment key={f.head}>
            {i ? (
              <div
                style={{
                  position: "absolute",
                  left: MARGIN,
                  width: WIDTH - 2 * MARGIN,
                  top: row,
                  height: 1,
                  background: color.line,
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                left: MARGIN,
                top: row + 28,
                width: 520,
                fontSize: 112,
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: "nowrap",
                color: color.text,
              }}
            >
              {/* Counts while the shot fades in, so the true figure stands by 0.5 s. */}
              <Count to={f.to} suffix={f.suffix} at={0} len={sec(0.5)} />
            </div>
            <div
              style={{
                position: "absolute",
                left: 640,
                top: row + 30,
                fontSize: 44,
                fontWeight: 600,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                color: color.text,
              }}
            >
              {f.head}
            </div>
            <div
              style={{
                position: "absolute",
                left: 640,
                top: row + 98,
                fontSize: TYPE.sub,
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                color: color.dim,
              }}
            >
              {f.note}
            </div>
          </React.Fragment>
        );
      })}
    </Field>
  );
};
