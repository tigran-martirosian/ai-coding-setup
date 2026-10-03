import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 before `start`, 1 after `start + duration`, eased in between. */
export const appear = (frame: number, start: number, duration = 14): number =>
  interpolate(frame, [start, start + duration], [0, 1], { ...CLAMP, easing: EASE_OUT });

/** A value that moves from `from` to `to` while `appear` goes from 0 to 1. */
export const move = (frame: number, start: number, from: number, to: number, duration = 20): number =>
  from + (to - from) * appear(frame, start, duration);

/** The part of `text` that has been typed by `frame`. */
export const typed = (text: string, frame: number, start: number, charsPerFrame = 1.2): string =>
  text.slice(0, Math.max(0, Math.floor((frame - start) * charsPerFrame)));

/** Fades and slides its children in at frame `at`. */
export const Appear: React.FC<{
  at: number;
  from?: "bottom" | "left" | "right" | "none";
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ at, from = "bottom", style, children }) => {
  const t = appear(useCurrentFrame(), at);
  const offset = (1 - t) * 24;
  const translate =
    from === "bottom"
      ? `0px ${offset}px`
      : from === "left"
        ? `${-offset}px 0px`
        : from === "right"
          ? `${offset}px 0px`
          : "0px 0px";
  return <div style={{ opacity: t, translate, ...style }}>{children}</div>;
};
