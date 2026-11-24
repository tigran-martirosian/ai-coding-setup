import type React from "react";
import { ease, FADE, Field, Head, sec, Typed, useTick } from "./kit";
import { accent, color, MARGIN, TOP, TYPE } from "./look";
import { need } from "./need";
import type { Shot } from "./script";

const ink = accent.Install;
const TERM = { x: MARGIN, y: TOP, w: 1920 - 2 * MARGIN, h: 650 };
const LINE = 58;
const SPEED = 0.6;

/** The clone and the step into its folder stand from the first frame; then one command types into the terminal and its
 * output prints a line at a time; then the line about updates. */
export const Install: React.FC<{ shot: Shot }> = ({ shot }) => {
  const t = useTick();
  const { code, output, update, link } = need(shot.body, "install");
  const folder = link.split("/").pop();
  const typedAt = sec(0.3) + code.length / SPEED;
  const lineAt = (i: number) => typedAt + sec(0.4 + i * 0.4);
  const updateAt = lineAt(output.length - 1) + sec(0.6);
  return (
    <Field>
      <Head title={shot.title} sub={shot.sub} ink={ink} />
      <div
        style={{
          position: "absolute",
          left: TERM.x,
          top: TERM.y,
          width: TERM.w,
          height: TERM.h,
          border: `2px solid ${color.line}`,
          borderRadius: 12,
          background: color.window,
        }}
      >
        <div
          style={{
            height: 62,
            display: "flex",
            alignItems: "center",
            padding: "0 30px",
            fontSize: TYPE.sub,
            color: color.soft,
            borderBottom: `1px solid ${color.line}`,
          }}
        >
          Terminal
        </div>
        <div
          style={{
            padding: "26px 30px",
            fontSize: 34,
            lineHeight: `${LINE}px`,
            whiteSpace: "pre",
          }}
        >
          {[`git clone https://${link}`, `cd ${folder}`].map((line) => (
            <div key={line}>
              <span style={{ color: ink }}>$ </span>
              <span style={{ color: color.text }}>{line}</span>
            </div>
          ))}
          <div>
            <span style={{ color: ink }}>$ </span>
            <Typed text={code} at={sec(0.3)} speed={SPEED} cursor />
          </div>
          {output.map((line, i) => {
            const last = i === output.length - 1;
            return (
              <div
                key={line}
                style={{
                  opacity: ease(t, lineAt(i), FADE),
                  color: last ? color.text : color.dim,
                  fontWeight: last ? 600 : 400,
                }}
              >
                <span style={{ color: last ? color.good : ink }}>
                  {last ? "✓ " : "  "}
                </span>
                {line}
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: MARGIN,
          top: TERM.y + TERM.h + 30,
          fontSize: 44,
          fontWeight: 600,
          opacity: ease(t, updateAt, sec(0.5)),
        }}
      >
        {update.split(": ")[0]}:{" "}
        <span style={{ color: ink }}>{update.split(": ")[1]}</span>
      </div>
    </Field>
  );
};
