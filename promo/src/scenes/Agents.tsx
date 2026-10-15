import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Columns, StatusIcon, Window } from "../ui";

// The rows of the editor's "Agents & commands" list: what the app shows (the raw task text) and the
// title extensions/agents-panel gives it. `doneAt` is the frame the job finishes.
const ROWS = [
  { raw: 'cd "C:/Projects/shop" && npm test -- --runInBand 2>&1 | tail -40', title: "Runs the test suite", doneAt: 150 },
  { raw: "Web search: library sign-in steps", title: "Web search: library sign-in steps", doneAt: 96 },
  { raw: "Read files: invoice importer", title: "Read files: invoice importer", doneAt: 124 },
  { raw: "git log --oneline -20 && git diff --stat HEAD~3 -- src/", title: "Lists recent commits and changed files", doneAt: 70 },
  { raw: "Draft tests: empty-file import", title: "Draft tests: empty-file import", doneAt: 9999 },
] as const;

const ROW_HEIGHT = 64;

export const Agents: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const done = (row: (typeof ROWS)[number]) => frame >= row.doneAt;
  const finished = ROWS.filter(done).length;
  const running = ROWS.filter((row) => !done(row));

  return (
    <Scene
      tag="extension · agents-panel"
      caption="The list of helpers and commands Claude started: running ones on top, each named after its job, finished ones folded away."
      durationInFrames={durationInFrames}
    >
      <Columns>
        <Appear at={4} style={{ width: 760 }}>
          <Window title="Agents & commands" chip="THE APP" chipColor={color.faint} bodyStyle={{ gap: 6, padding: 16 }}>
            {ROWS.map((row) => (
              <div key={row.raw} style={{ display: "flex", alignItems: "center", gap: 12, height: 48, opacity: done(row) ? 0.55 : 1 }}>
                <StatusIcon status={done(row) ? "ok" : "running"} size={24} />
                <span style={{ fontFamily: mono, fontSize: 21, color: color.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {row.raw}
                </span>
              </div>
            ))}
          </Window>
        </Appear>

        <Appear at={22} from="left" style={{ flex: 1 }}>
          <Window title="Agents & commands" chip="AGENTS PANEL" bodyStyle={{ gap: 8, padding: 16 }}>
            <div style={{ position: "relative", height: ROW_HEIGHT * running.length + 8 }}>
              {running.map((row, i) => (
                <div
                  key={row.raw}
                  style={{
                    position: "absolute",
                    top: i * ROW_HEIGHT,
                    left: 0,
                    right: 0,
                    height: ROW_HEIGHT - 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "0 16px",
                    borderRadius: 10,
                    background: color.raised,
                    boxShadow: `inset 4px 0 0 ${color.sky}`,
                  }}
                >
                  <StatusIcon status="running" size={26} />
                  <span style={{ fontSize: 27, fontWeight: 600, whiteSpace: "nowrap" }}>{row.title}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 24,
                color: color.dim,
                opacity: appear(frame, ROWS[3].doneAt, 10),
              }}
            >
              <span>▸</span>
              <span>{finished} finished</span>
            </div>
          </Window>
        </Appear>
      </Columns>
    </Scene>
  );
};
