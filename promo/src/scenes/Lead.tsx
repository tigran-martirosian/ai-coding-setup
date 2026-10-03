import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color } from "../theme";
import { Chip, Status, StatusIcon } from "../ui";

const RESEARCH_DONE_AT = 60;
const BUILD_DONE_AT = 110;
const REVIEW_DONE_AT = 146;
const FIX_DONE_AT = 190;

type Child = { title: string; job: string; bornAt: number; doneAt: number };

const CHILDREN: Child[] = [
  { title: "Research", job: "Read the old importer", bornAt: 24, doneAt: RESEARCH_DONE_AT },
  { title: "Build: importer", job: "Read orders from CSV", bornAt: RESEARCH_DONE_AT, doneAt: BUILD_DONE_AT },
  { title: "Build: report", job: "Monthly totals", bornAt: RESEARCH_DONE_AT + 6, doneAt: BUILD_DONE_AT - 8 },
  { title: "Review", job: "A session that built none of it", bornAt: BUILD_DONE_AT, doneAt: REVIEW_DONE_AT },
];

const card: React.CSSProperties = {
  background: color.panel,
  border: `1.5px solid ${color.line}`,
  borderRadius: 16,
  padding: "20px 24px",
  boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
};

export const Lead: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const fixing = frame >= REVIEW_DONE_AT + 10 && frame < FIX_DONE_AT;
  const validated = frame >= FIX_DONE_AT + 10;

  return (
    <Scene
      tag="/lead"
      caption="/lead splits a big request across child sessions that run side by side. A separate session reviews the work, fixes go back, and the lead reports what it checked."
      durationInFrames={durationInFrames}
      stageStyle={{ flexDirection: "column", gap: 0 }}
    >
      <Appear at={6}>
        <div style={{ ...card, border: `1.5px solid ${color.sky}`, display: "flex", alignItems: "center", gap: 24, minWidth: 900 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: color.sky, letterSpacing: 0.6 }}>LEAD SESSION</div>
            <div style={{ fontSize: 32, fontWeight: 600, marginTop: 4 }}>Add a CSV import with a monthly report</div>
          </div>
          <Chip color={validated ? color.green : color.sky}>{validated ? "CHECKED" : "RUNNING"}</Chip>
        </div>
      </Appear>

      <Appear at={20} from="none">
        <div style={{ width: 2, height: 44, background: color.line }} />
      </Appear>
      <Appear at={20} from="none" style={{ width: "100%" }}>
        <div style={{ height: 2, background: color.line, margin: "0 210px" }} />
      </Appear>

      <div style={{ display: "flex", gap: 28, width: "100%", marginTop: 28, alignItems: "flex-start" }}>
        {CHILDREN.map((child, i) => {
          const isImporter = i === 1;
          const status: Status =
            isImporter && fixing ? "running" : frame >= (isImporter && frame >= REVIEW_DONE_AT ? FIX_DONE_AT : child.doneAt) ? "ok" : "running";
          return (
            <Appear key={child.title} at={child.bornAt} style={{ flex: 1 }}>
              <div style={{ ...card, minHeight: 210, boxSizing: "border-box" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ fontSize: 28, fontWeight: 600, whiteSpace: "nowrap" }}>{child.title}</span>
                  <StatusIcon status={status} />
                </div>
                <div style={{ fontSize: 24, color: color.dim, marginTop: 8 }}>{child.job}</div>
                {i === 3 ? (
                  <Appear at={REVIEW_DONE_AT}>
                    <div
                      style={{
                        marginTop: 16,
                        fontSize: 23,
                        border: `1px solid ${color.red}88`,
                        background: `${color.red}1c`,
                        borderRadius: 10,
                        padding: "8px 12px",
                      }}
                    >
                      Found: an empty file crashes it
                    </div>
                  </Appear>
                ) : null}
                {isImporter ? (
                  <Appear at={REVIEW_DONE_AT + 10}>
                    <div
                      style={{
                        marginTop: 16,
                        fontSize: 23,
                        border: `1px solid ${frame >= FIX_DONE_AT ? color.green : color.amber}88`,
                        background: `${frame >= FIX_DONE_AT ? color.green : color.amber}1c`,
                        borderRadius: 10,
                        padding: "8px 12px",
                      }}
                    >
                      {frame >= FIX_DONE_AT ? "Fixed: empty files are skipped" : "Fix sent back by the lead"}
                    </div>
                  </Appear>
                ) : null}
              </div>
            </Appear>
          );
        })}
      </div>
    </Scene>
  );
};
