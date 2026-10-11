import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Appear } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Chip, Columns, Step, Window } from "../ui";

const SWAP_AT = 140;
const FADE = 10;
const INBOX = [
  { name: "photo-0412.jpg", note: "photo" },
  { name: "note-0412.txt", note: "note" },
  { name: "link-0412.txt", note: "link" },
] as const;
const SHEETS = ["0:00 to 0:40", "0:40 to 1:20", "1:20 to 2:00", "2:00 to 2:40"] as const;

const Button: React.FC<{ hot?: boolean; children: React.ReactNode }> = ({ hot, children }) => (
  <span
    style={{
      padding: "8px 22px",
      borderRadius: 12,
      fontSize: 26,
      fontWeight: 600,
      border: `1.5px solid ${hot ? color.sky : color.line}`,
      background: hot ? `${color.sky}22` : color.raised,
      color: hot ? color.sky : color.text,
    }}
  >
    {children}
  </span>
);

const Line: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      alignSelf: "flex-start",
      background: color.raised,
      border: `1px solid ${color.line}`,
      borderRadius: 14,
      padding: "10px 18px",
      fontSize: 27,
    }}
  >
    {children}
  </div>
);

export const Phone: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const first = frame < SWAP_AT;
  const opacity = interpolate(frame, [SWAP_AT - FADE, SWAP_AT, SWAP_AT + FADE], [1, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const local = first ? frame : frame - SWAP_AT;
  const tapped = frame >= 92;
  const picked = frame >= 124;

  return (
    <Scene
      tag={first ? "/phone-bot" : "/watch"}
      caption={
        first
          ? "A Telegram bot of your own, on your computer. What you send from the phone lands in one folder that /phone reads in any session."
          : "Give a YouTube link or a video file and a question. A cheap model reads the subtitles and sheets of timed stills, for a few thousand tokens."
      }
      durationInFrames={durationInFrames}
    >
      <div style={{ width: "100%", opacity }}>
        {first ? (
          <Columns>
            <Window title="Telegram · your bot" chip="ON YOUR PHONE" style={{ width: 760 }} bodyStyle={{ gap: 12, padding: 20 }}>
              <Appear at={8} from="right" style={{ alignSelf: "flex-end" }}>
                <Chip>photo, note, link</Chip>
              </Appear>
              <Appear at={30} from="right" style={{ alignSelf: "flex-end" }}>
                <div style={{ background: "#0c2a40", border: "1px solid #164e68", borderRadius: 14, padding: "10px 18px", fontSize: 27 }}>
                  Rename the report files
                </div>
              </Appear>
              <Appear at={56}>
                <Line>Hand this to a session?</Line>
              </Appear>
              <Appear at={62}>
                <div style={{ display: "flex", gap: 12 }}>
                  <Button hot={tapped}>Send</Button>
                  <Button>Cancel</Button>
                </div>
              </Appear>
              <Appear at={102}>
                <Line>Which folder?</Line>
              </Appear>
              <Appear at={108}>
                <div style={{ display: "flex", gap: 12 }}>
                  <Button>reports</Button>
                  <Button hot={picked}>archive</Button>
                  <Button>both</Button>
                </div>
              </Appear>
            </Window>

            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 24 }}>
              <Appear at={14} from="left">
                <Window title="phone-inbox" chip="ONE FOLDER" chipColor={color.violet} bodyStyle={{ gap: 8 }}>
                  {INBOX.map((item, i) => (
                    <Appear key={item.name} at={20 + i * 8}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 27 }}>
                        <span style={{ fontFamily: mono, fontSize: 25 }}>{item.name}</span>
                        <span style={{ color: color.dim }}>{item.note}</span>
                      </div>
                    </Appear>
                  ))}
                </Window>
              </Appear>
              <Appear at={66} from="left">
                <Window title="Session" chip={tapped ? "STARTED" : "WAITING FOR SEND"} chipColor={tapped ? color.green : color.amber}>
                  <Step status={tapped ? "ok" : "plain"}>Request handed over after the tap</Step>
                  <Appear at={106}>
                    <Step status={picked ? "ok" : "running"}>Question arrives as buttons</Step>
                  </Appear>
                </Window>
              </Appear>
            </div>
          </Columns>
        ) : (
          <Columns>
            <Window title="/watch" style={{ width: 760 }} bodyStyle={{ gap: 14 }}>
              <Appear at={6}>
                <div style={{ fontFamily: mono, fontSize: 25, color: color.sky }}>youtube.com/watch?v=…</div>
              </Appear>
              <Appear at={14}>
                <div style={{ fontSize: 29 }}>What does the speaker say about the price?</div>
              </Appear>
              <Appear at={26}>
                <Step status={local >= 50 ? "ok" : "running"}>Fetch the subtitles</Step>
              </Appear>
              <Appear at={44}>
                <Step status={local >= 76 ? "ok" : "running"}>Make sheets of timed stills</Step>
              </Appear>
              <Appear at={70}>
                <Step status={local >= 100 ? "ok" : "running"}>A cheap model reads them</Step>
              </Appear>
            </Window>

            <Window title="Sheets" chip="A FEW THOUSAND TOKENS" chipColor={color.green} style={{ flex: 1 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {SHEETS.map((label, i) => (
                  <Appear key={label} at={50 + i * 8}>
                    <div style={{ width: 300, background: color.raised, border: `1px solid ${color.line}`, borderRadius: 12, padding: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        {Array.from({ length: 6 }, (_, k) => (
                          <span key={k} style={{ height: 40, borderRadius: 6, background: color.line }} />
                        ))}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 21, color: color.dim, marginTop: 8 }}>{label}</div>
                    </div>
                  </Appear>
                ))}
              </div>
              <Appear at={96}>
                <div style={{ fontSize: 27 }}>
                  <span style={{ color: color.sky, fontFamily: mono }}>1:12</span> The price is set per seat, billed monthly.
                </div>
              </Appear>
            </Window>
          </Columns>
        )}
      </div>
    </Scene>
  );
};
