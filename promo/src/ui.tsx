import React from "react";
import { useCurrentFrame } from "remotion";
import { color, mono } from "./theme";

/** A panel with a title bar, drawn like the editor's chat and form panels. */
export const Window: React.FC<{
  title: string;
  chip?: string;
  chipColor?: string;
  active?: boolean;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ title, chip, chipColor = color.sky, active, style, bodyStyle, children }) => (
  <div
    style={{
      background: color.panel,
      border: `1.5px solid ${active ? color.sky : color.line}`,
      borderRadius: 16,
      overflow: "hidden",
      boxShadow: "0 30px 80px rgba(0, 0, 0, 0.45)",
      ...style,
    }}
  >
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "16px 24px",
        background: color.panelHead,
        borderBottom: `1px solid ${color.line}`,
        fontSize: 28,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      <span>{title}</span>
      {chip ? <Chip color={chipColor}>{chip}</Chip> : null}
    </div>
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16, ...bodyStyle }}>{children}</div>
  </div>
);

export const Chip: React.FC<{ color?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({
  color: c = color.sky,
  style,
  children,
}) => (
  <span
    style={{
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: 0.6,
      color: c,
      background: `${c}22`,
      border: `1px solid ${c}55`,
      borderRadius: 999,
      padding: "4px 14px",
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
  </span>
);

/** One chat message. `struck` greys it out and strikes it through (a reply that was sent back). */
export const Bubble: React.FC<{ who: "you" | "agent"; struck?: boolean; children: React.ReactNode }> = ({
  who,
  struck,
  children,
}) => (
  <div
    style={{
      alignSelf: who === "you" ? "flex-end" : "flex-start",
      maxWidth: "88%",
      background: who === "you" ? "#0c2a40" : color.raised,
      border: `1px solid ${struck ? color.red : who === "you" ? "#164e68" : color.line}`,
      borderRadius: 14,
      padding: "14px 20px",
      fontSize: 29,
      lineHeight: 1.35,
    }}
  >
    <div style={{ fontSize: 20, fontWeight: 600, color: color.dim, marginBottom: 4 }}>{who === "you" ? "You" : "Agent"}</div>
    <div style={{ opacity: struck ? 0.5 : 1, textDecoration: struck ? "line-through" : "none" }}>{children}</div>
  </div>
);

export type Status = "plain" | "running" | "ok" | "blocked";

export const StatusIcon: React.FC<{ status: Status; size?: number }> = ({ status, size = 30 }) => {
  const frame = useCurrentFrame();
  if (status === "plain") return <span style={{ width: size, height: size, flexShrink: 0 }} />;
  if (status === "running") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ rotate: `${frame * 14}deg`, flexShrink: 0 }}>
        <circle cx="12" cy="12" r="9" fill="none" stroke={color.line} strokeWidth="3" />
        <path d="M12 3 a9 9 0 0 1 9 9" fill="none" stroke={color.sky} strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  const ok = status === "ok";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="11" fill={ok ? color.green : color.red} />
      <path
        d={ok ? "M7 12.5 l3.4 3.4 l6.6 -7.4" : "M8 8 l8 8 M16 8 l-8 8"}
        fill="none"
        stroke={color.panel}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** One tool call of the agent: the tool's name, what it was called with, and how it ended. */
export const ToolRow: React.FC<{ tool: string; text: string; status: Status }> = ({ tool, text, status }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 16,
      background: color.raised,
      border: `1px solid ${status === "blocked" ? color.red : color.line}`,
      borderRadius: 12,
      padding: "14px 18px",
      fontFamily: mono,
      fontSize: 25,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ color: color.violet, fontWeight: 600 }}>{tool}</span>
    <span
      style={{
        flex: 1,
        whiteSpace: "pre",
        opacity: status === "blocked" ? 0.55 : 1,
        textDecoration: status === "blocked" ? "line-through" : "none",
      }}
    >
      {text}
    </span>
    <StatusIcon status={status} />
  </div>
);

/** The message a hook sends back when it blocks a step. */
export const BlockNote: React.FC<{ hook: string; children: React.ReactNode }> = ({ hook, children }) => (
  <div
    style={{
      background: `${color.red}1c`,
      border: `1px solid ${color.red}88`,
      borderRadius: 12,
      padding: "12px 18px",
      fontSize: 26,
      lineHeight: 1.35,
    }}
  >
    <span style={{ fontFamily: mono, fontWeight: 600, color: "#fca5a5", marginRight: 12 }}>{hook}</span>
    {children}
  </div>
);

/** A step in a session's work list. */
export const Step: React.FC<{ status: Status; children: React.ReactNode }> = ({ status, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 29 }}>
    <StatusIcon status={status} />
    <span>{children}</span>
  </div>
);

/** Panels side by side at the same height. */
export const Columns: React.FC<{ gap?: number; height?: number; children: React.ReactNode }> = ({
  gap = 40,
  height,
  children,
}) => <div style={{ display: "flex", gap, height, width: "100%", alignItems: "stretch" }}>{children}</div>;

export const Bar: React.FC<{ value: number; color: string; height?: number }> = ({ value, color: c, height = 10 }) => (
  <div style={{ height, borderRadius: height, background: color.line, overflow: "hidden" }}>
    <div style={{ width: `${Math.min(100, value)}%`, height: "100%", borderRadius: height, background: c }} />
  </div>
);
