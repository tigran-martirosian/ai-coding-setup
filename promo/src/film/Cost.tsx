import React from "react";
import { ease, FADE, Field, glide, Head, sec, useTick } from "./kit";
import { accent, color, MARGIN, TYPE } from "./look";
import { Shot } from "./script";
import { need } from "./need";

const ink = accent.Cost;
const CHART = {
  left: MARGIN + 40,
  right: 1920 - MARGIN,
  top: 330,
  bottom: 840,
};
const BAR_W = 150;

/** A plan week of usage, day by day. The days so far fill one after another up to what has been used; then the
 * forecast runs on in dashed outline until it meets the week's limit, and the day it lasts until is named. */
export const Usage: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { days, used, ahead, limit, forecast, note, axis, aheadLabel } = need(
    shot.body,
    "usage",
  );
  const column = (CHART.right - CHART.left) / days.length;
  const x = (i: number) => CHART.left + i * column + (column - BAR_W) / 2;
  const h = (share: number) => ((CHART.bottom - CHART.top) * share) / 100;
  const fillAt = (i: number) => sec(0.5 + i * 0.6);
  const aheadAt = (i: number) => fillAt(used.length) + sec(0.2 + i * 0.5);
  const lastAt = aheadAt(ahead.length - 1);
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div
        style={{
          position: "absolute",
          left: CHART.left,
          right: 1920 - CHART.right,
          top: CHART.top,
          borderTop: `2px dashed ${color.faint}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: 1920 - CHART.right,
          top: CHART.top - 44,
          fontSize: TYPE.label,
          color: color.dim,
        }}
      >
        {limit}
      </div>
      {/* Each group of bars is named above the limit's row, with a thin rule spanning its columns. */}
      {[
        { text: axis, from: 0, to: used.length - 1 },
        { text: aheadLabel, from: used.length, to: used.length + ahead.length - 1 },
      ].map((group) => (
        <div
          key={group.text}
          style={{
            position: "absolute",
            left: x(group.from),
            width: x(group.to) + BAR_W - x(group.from),
            top: CHART.top - 104,
            paddingBottom: 6,
            borderBottom: `1px solid ${color.faint}`,
            textAlign: "center",
            fontSize: TYPE.label,
            color: color.dim,
          }}
        >
          {group.text}
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: CHART.left,
          right: 1920 - CHART.right,
          top: CHART.bottom,
          height: 2,
          background: color.line,
        }}
      />
      {days.map((day, i) => {
        const isUsed = i < used.length;
        const share = isUsed ? used[i] : ahead[i - used.length];
        const grow =
          share === undefined
            ? 0
            : isUsed
              ? glide(t, fillAt(i), sec(0.6))
              : glide(t, aheadAt(i - used.length), sec(0.5));
        const height = share === undefined ? 0 : h(share) * grow;
        const runsOut = !isUsed && share === 100;
        return (
          <React.Fragment key={day}>
            {share !== undefined ? (
              <div
                style={{
                  position: "absolute",
                  left: x(i),
                  width: BAR_W,
                  top: CHART.bottom - height,
                  height,
                  borderRadius: "6px 6px 0 0",
                  background: isUsed ? ink : "transparent",
                  border: isUsed
                    ? undefined
                    : `3px dashed ${runsOut ? color.bad : ink}`,
                  borderBottom: "none",
                  boxSizing: "border-box",
                }}
              />
            ) : null}
            {share !== undefined ? (
              <div
                style={{
                  position: "absolute",
                  left: x(i),
                  width: BAR_W,
                  top: CHART.bottom - height - 46,
                  textAlign: "center",
                  fontSize: TYPE.label,
                  color: runsOut ? color.bad : color.dim,
                  opacity: ease(
                    t,
                    isUsed
                      ? fillAt(i) + sec(0.4)
                      : aheadAt(i - used.length) + sec(0.3),
                    FADE,
                  ),
                }}
              >
                {share}%
              </div>
            ) : null}
            <div
              style={{
                position: "absolute",
                left: x(i),
                width: BAR_W,
                top: CHART.bottom + 18,
                textAlign: "center",
                fontSize: TYPE.body,
                color: runsOut ? color.bad : isUsed ? color.text : color.dim,
              }}
            >
              {day}
            </div>
          </React.Fragment>
        );
      })}
      <div
        style={{
          position: "absolute",
          left: CHART.left,
          top: CHART.bottom + 96,
          fontSize: 40,
          fontWeight: 600,
          color: color.text,
          opacity: ease(t, lastAt + sec(0.5), sec(0.5)),
        }}
      >
        {forecast}
      </div>
      <div
        style={{
          position: "absolute",
          right: 1920 - CHART.right,
          top: CHART.bottom + 104,
          fontSize: TYPE.sub,
          color: color.dim,
        }}
      >
        {note}
      </div>
    </Field>
  );
};
