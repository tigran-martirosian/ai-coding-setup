import React from "react";
import {
  clamp,
  ease,
  FADE,
  Field,
  glide,
  Head,
  mix,
  Stamp,
  sec,
  useTick,
  Wire,
} from "./kit";
import { accent, color, MARGIN, TOP, TYPE } from "./look";
import { need } from "./need";
import {
  CLAIM_AT,
  LOG_LABEL,
  PASSED,
  REPLY_LABEL,
  SENT_BACK,
  type Shot,
} from "./script";

// The two claim shots share one diagram: the agent's reply on the left, its session log on the right. A red wire
// runs from the claim to the empty place in the log where the step should be, the reply is sent back, the agent
// does the step, and the wire and the log line turn green.

const WINDOW_H = 600;
const REPLY = { x: MARGIN, w: 860 };
const LOG = { x: 1080, w: 1920 - MARGIN - 1080 };
const LABEL_H = 62;
/** Where the first line inside either window sits, and the spacing of the lines. */
const FIRST = TOP + LABEL_H + 34;
const REPLY_SIZE = 54;
const REPLY_LINE = 90;
const LOG_SIZE = 38;
const LOG_LINE = 92;
const INSET = 30;

/** An empty window: its outline and the small label on top. The words are placed over it by position. */
const Frame: React.FC<{
  x: number;
  w: number;
  label: string;
  edge?: string;
}> = ({ x, w, label, edge = color.line }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: TOP,
      width: w,
      height: WINDOW_H,
      background: color.window,
      border: `2px solid ${edge}`,
      borderRadius: 12,
    }}
  >
    <div
      style={{
        height: LABEL_H,
        display: "flex",
        alignItems: "center",
        padding: `0 ${INSET}px`,
        fontSize: TYPE.sub,
        color: color.soft,
        borderBottom: `1px solid ${color.line}`,
      }}
    >
      {label}
    </div>
  </div>
);

/** A log line: the kind of step dim, what it touched bright. */
const Step: React.FC<{ text: string; ink?: string }> = ({
  text,
  ink = color.text,
}) => (
  <>
    <span style={{ color: color.dim }}>{text.slice(0, 7)}</span>
    <span style={{ color: ink }}>{text.slice(7)}</span>
  </>
);

export const Claim: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { reply, claim, fixed, log, missing, found, reason } = need(
    shot.body,
    "claim",
  );
  const ink = accent.Checks;
  const wire = glide(t, CLAIM_AT.wire, sec(1.3));
  const arrived = ease(t, CLAIM_AT.wire + sec(1.1), FADE);
  const done = ease(t, CLAIM_AT.fixed, sec(0.6));
  const passed = ease(t, CLAIM_AT.passed, FADE);
  const sent =
    ease(t, CLAIM_AT.sent, FADE) * (1 - ease(t, CLAIM_AT.fixed - FADE, FADE));
  const wrong = mix(color.bad, color.good, done);

  const isLink = (i: number) =>
    i === reply.length - 1 && reply[i].includes(".") && !reply[i].includes(" ");
  const size = (i: number) => (isLink(i) ? TYPE.body : REPLY_SIZE);
  const lineY = (i: number) => FIRST + i * REPLY_LINE;
  const slotY = FIRST + log.length * LOG_LINE;
  // The wire starts just after the claim, and moves with its end when the corrected line is longer.
  const swapped = ease(t, CLAIM_AT.fixed + sec(0.3), sec(0.6));
  const claimLength =
    reply[claim].length + (fixed[claim].length - reply[claim].length) * swapped;
  const from = {
    x: REPLY.x + INSET + claimLength * size(claim) * 0.6 + 18,
    y: lineY(claim) + size(claim) * 0.62,
  };
  const to = { x: LOG.x + INSET - 8, y: slotY + 34 };

  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <Frame x={REPLY.x} w={REPLY.w} label={REPLY_LABEL} />
      <Frame x={LOG.x} w={LOG.w} label={LOG_LABEL} />

      {reply.map((line, i) => {
        const after = fixed[i];
        const changes = after !== line;
        const swap = changes ? ease(t, CLAIM_AT.fixed + sec(0.3), sec(0.6)) : 0;
        const base: React.CSSProperties = {
          position: "absolute",
          left: REPLY.x + INSET,
          top: lineY(i),
          fontSize: size(i),
          lineHeight: 1.25,
          whiteSpace: "nowrap",
        };
        const lineInk = isLink(i) ? color.dim : color.text;
        // The wrong line, the one the fix replaces, is struck through in red just after the reply is sent back, and
        // fades out with it in the swap.
        const strike = changes ? ease(t, CLAIM_AT.sent + sec(0.3), FADE) : 0;
        const struck = strike > 0;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list drawn once per video frame; it never reorders and holds no state
          <React.Fragment key={i}>
            <div
              style={{
                ...base,
                opacity: 1 - swap,
                color: i === claim ? mix(lineInk, wrong, arrived) : lineInk,
                textDecorationLine: struck
                  ? "line-through"
                  : isLink(i)
                    ? "underline"
                    : undefined,
                textDecorationColor: struck
                  ? mix(`${color.bad}00`, color.bad, strike)
                  : undefined,
                textDecorationThickness: struck ? 4 : undefined,
                textUnderlineOffset: 8,
              }}
            >
              {line}
            </div>
            {changes ? (
              <div style={{ ...base, opacity: swap, color: color.good }}>
                {after}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}

      {log.map((line, i) => (
        <div
          key={line}
          style={{
            position: "absolute",
            left: LOG.x + INSET,
            top: FIRST + i * LOG_LINE + 10,
            fontSize: LOG_SIZE,
            whiteSpace: "pre",
          }}
        >
          <Step text={line} />
        </div>
      ))}
      <div
        style={{
          position: "absolute",
          left: LOG.x + INSET - 8,
          width: LOG.w - 2 * INSET + 16,
          top: slotY,
          height: 68,
          borderRadius: 8,
          border: `2px ${done > 0.5 ? "solid" : "dashed"} ${mix(mix(color.faint, color.bad, arrived), color.good, done)}`,
          display: "flex",
          alignItems: "center",
          padding: "0 8px",
          fontSize: LOG_SIZE,
          whiteSpace: "pre",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: 28,
            opacity: 1 - done,
            color: mix(color.faint, color.bad, arrived),
          }}
        >
          {missing}
        </span>
        <span style={{ position: "absolute", left: 28, opacity: done }}>
          <Step text={found} ink={color.good} />
        </span>
      </div>

      <Wire a={from} b={to} draw={wire} ink={wrong} width={4} />
      <div
        style={{
          position: "absolute",
          left: to.x - 9,
          top: to.y - 9,
          width: 18,
          height: 18,
          borderRadius: 9,
          background: wrong,
          opacity: arrived,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: REPLY.x,
          top: TOP + WINDOW_H + 40,
          display: "flex",
          alignItems: "center",
          gap: 28,
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 28,
            opacity: sent,
          }}
        >
          <Stamp at={0} text={SENT_BACK} ink={color.bad} size={40} />
          <span style={{ fontSize: TYPE.body, color: color.text }}>
            {reason}
          </span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: REPLY.x,
          top: TOP + WINDOW_H + 40,
          opacity: clamp(passed),
        }}
      >
        <Stamp at={0} text={PASSED} ink={color.good} size={40} />
      </div>
    </Field>
  );
};
