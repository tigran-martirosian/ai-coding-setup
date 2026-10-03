import React from "react";
import { useCurrentFrame } from "remotion";
import { Appear, appear, move, typed } from "../anim";
import { Scene, SceneProps } from "../Scene";
import { color, mono } from "../theme";
import { Bar, Chip, Columns, Window } from "../ui";

const COLUMNS = [
  { name: "Planning", dot: color.sky },
  { name: "Implementing", dot: color.amber },
  { name: "Validating", dot: color.violet },
  { name: "Complete", dot: color.green },
] as const;

const COLUMN_WIDTH = 279;
const COLUMN_GAP = 16;
const HEADER = 62;
const CARD_HEIGHT = 104;
const CARD_GAP = 14;

const HANDOFF_AT = 84;
const CLEANUP_AT = 136;

type Stop = { at: number; column: number; slot: number };
type Card = { title: string; tags: string; stops: Stop[]; bornAt?: number; running?: boolean };

// Each card's path over the board: where it starts and the moves it makes.
const CARDS: Card[] = [
  { title: "Pricing page copy", tags: "docs", stops: [{ at: 0, column: 0, slot: 0 }] },
  {
    title: "Import orders",
    tags: "feature",
    stops: [
      { at: 0, column: 1, slot: 0 },
      { at: HANDOFF_AT + 14, column: 3, slot: 0 },
    ],
  },
  {
    title: "Import orders (cont.)",
    tags: "feature",
    bornAt: HANDOFF_AT,
    running: true,
    stops: [
      { at: 0, column: 1, slot: 1 },
      { at: HANDOFF_AT + 30, column: 1, slot: 0 },
    ],
  },
  {
    title: "Fix login redirect",
    tags: "bug-fix",
    stops: [
      { at: 0, column: 2, slot: 0 },
      { at: CLEANUP_AT + 12, column: 3, slot: 1 },
    ],
  },
  {
    title: "Export to CSV",
    tags: "feature",
    stops: [
      { at: 0, column: 2, slot: 1 },
      { at: CLEANUP_AT + 22, column: 3, slot: 2 },
    ],
  },
  {
    title: "Search filters",
    tags: "waits for your check",
    stops: [
      { at: 0, column: 2, slot: 2 },
      { at: CLEANUP_AT + 40, column: 2, slot: 0 },
    ],
  },
];

const left = (column: number): number => column * (COLUMN_WIDTH + COLUMN_GAP) + 10;
const top = (slot: number): number => HEADER + 12 + slot * (CARD_HEIGHT + CARD_GAP);

const position = (card: Card, frame: number): { x: number; y: number } =>
  card.stops
    .slice(1)
    .reduce((at, stop) => ({ x: move(frame, stop.at, at.x, left(stop.column)), y: move(frame, stop.at, at.y, top(stop.slot)) }), {
      x: left(card.stops[0].column),
      y: top(card.stops[0].slot),
    });

const briefLine: React.CSSProperties = { fontSize: 24, lineHeight: 1.4 };

export const Handoff: React.FC<SceneProps> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();

  return (
    <Scene
      tag="/handoff · /board-cleanup"
      caption={
        <span>
          /handoff writes a short brief and a fresh session carries on from it.{" "}
          <span style={{ whiteSpace: "nowrap" }}>/board-cleanup</span> moves finished sessions to Complete.
        </span>
      }
      durationInFrames={durationInFrames}
    >
      <Columns gap={32} height={540}>
        <Window title="Import orders" style={{ width: 540 }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, marginBottom: 8 }}>
              <span style={{ color: color.dim }}>Context</span>
              <span style={{ color: color.amber, fontWeight: 600 }}>{Math.round(214 * appear(frame, 6, 30))}k tokens</span>
            </div>
            <Bar value={92 * appear(frame, 6, 30)} color={color.amber} />
          </div>
          <Appear at={26}>
            <div style={{ fontSize: 24, color: color.dim }}>
              <span style={{ fontFamily: mono, color: color.amber }}>context-guard</span> This session is long.
            </div>
          </Appear>
          <div
            style={{
              fontFamily: mono,
              fontSize: 27,
              border: `1.5px solid ${color.sky}`,
              borderRadius: 12,
              padding: "12px 16px",
              background: color.raised,
            }}
          >
            {typed("/handoff", frame, 40, 0.6) || " "}
          </div>
          <Appear at={62}>
            <div style={{ border: `1px solid ${color.line}`, borderRadius: 12, padding: "14px 18px", background: color.raised }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: color.sky, marginBottom: 6 }}>BRIEF</div>
              <div style={briefLine}>
                <b>Goal:</b> import orders from CSV
              </div>
              <div style={briefLine}>
                <b>State:</b> importer written, tests pass
              </div>
              <div style={briefLine}>
                <b>Next:</b> add the monthly report
              </div>
            </div>
          </Appear>
        </Window>

        <div
          style={{
            position: "relative",
            flex: 1,
            background: color.panel,
            border: `1.5px solid ${color.line}`,
            borderRadius: 16,
            boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
          }}
        >
          {COLUMNS.map((column, i) => (
            <div
              key={column.name}
              style={{
                position: "absolute",
                left: left(i) - 4,
                top: 6,
                bottom: 6,
                width: COLUMN_WIDTH + 8,
                borderRadius: 12,
                background: color.panelHead,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  height: HEADER - 6,
                  padding: "0 14px",
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  borderBottom: `1px solid ${color.line}`,
                }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 6, background: column.dot }} />
                {column.name.toUpperCase()}
              </div>
            </div>
          ))}

          {CARDS.map((card) => {
            const { x, y } = position(card, frame);
            const born = card.bornAt === undefined ? 1 : appear(frame, card.bornAt, 16);
            return (
              <div
                key={card.title}
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: COLUMN_WIDTH - 12,
                  height: CARD_HEIGHT,
                  boxSizing: "border-box",
                  background: color.panel,
                  border: `1.5px solid ${card.running ? color.sky : color.line}`,
                  borderRadius: 10,
                  padding: "12px 14px",
                  // A card on the move passes over the ones that stay.
                zIndex: card.stops.slice(1).some((stop) => frame >= stop.at && frame < stop.at + 20) ? 2 : 1,
                opacity: born,
                  scale: String(0.9 + 0.1 * born),
                }}
              >
                <div style={{ fontSize: 23, fontWeight: 600, whiteSpace: "nowrap" }}>{card.title}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <Chip color={color.dim} style={{ fontSize: 18, padding: "2px 10px" }}>
                    {card.tags}
                  </Chip>
                  {card.running ? <Chip style={{ fontSize: 18, padding: "2px 10px" }}>running</Chip> : null}
                </div>
              </div>
            );
          })}

          <Appear at={CLEANUP_AT} style={{ position: "absolute", left: left(0), bottom: 20 }}>
            <span
              style={{
                fontFamily: mono,
                fontSize: 25,
                color: color.sky,
                border: `1.5px solid ${color.sky}`,
                borderRadius: 10,
                padding: "8px 16px",
                background: color.raised,
              }}
            >
              /board-cleanup
            </span>
          </Appear>
        </div>
      </Columns>
    </Scene>
  );
};
