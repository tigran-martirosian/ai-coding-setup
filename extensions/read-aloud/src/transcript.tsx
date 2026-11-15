/**
 * Transcript integration through the documented contribution point:
 * a rehype plugin appends one <readaloud-control data-key> element to every
 * rendered transcript markdown block, and a component override renders it.
 * The custom tag name is unique to this extension, so it cannot collide with
 * other extensions' `components` overrides (last-registered-wins is per key).
 *
 * The Markdown source for each block is kept in a small in-memory map keyed by
 * a hash, so the visible transcript is never modified.
 *
 * Only one control shows in the whole transcript: at the end of the last finished turn, and it reads that
 * whole turn (every text block since the last user message). At rest it is
 * one worded button, Read aloud. While the turn is read it becomes the player box: line 1 the state word and the part, line 2 Pause or Resume, Next, speed and
 * Close. Close (or Esc inside the box) stops, clears and returns to rest.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import tokensCss from "../../shared/tokens.css?inline";
import { splitVoice } from "./cleanText";
import panelCss from "./panel.css?inline";
import { type PlayerState, player, usePlayer } from "./player";
import { updateSetting, useSettings } from "./settings";
import { formatSpeed, t } from "./strings";
// The shared thinking-orbs mount (plain script, one copy per window): draws every canvas[data-orb] on the page
import "../../shared/orbs/orbs.js";

export const CONTROL_TAG = "readaloud-control";

const texts = new Map<string, string>();
const MAX_TEXTS = 500;

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function remember(markdown: string): string {
  const key = hash(markdown);
  texts.delete(key);
  texts.set(key, markdown);
  if (texts.size > MAX_TEXTS) texts.delete(texts.keys().next().value as string);
  return key;
}

/** What to speak for one block: its Markdown without a hidden voice summary line. */
function bodyForKey(key: string): string | undefined {
  const md = texts.get(key);
  return md === undefined ? undefined : splitVoice(md).body;
}

// ---- The last turn: which control ends it, and the text of the whole turn ----

/** One item of the transcript in document order: a user message, the app's "still working" line, or a control. */
export type Item =
  | { kind: "user" }
  | { kind: "waiting" }
  | { kind: "control"; key: string };

/**
 * The index of the control that ends the last finished turn, or -1. It is the very last item: a user message
 * after it starts a new turn, and the "still working" line after it means the turn still runs.
 */
export function lastTurnEnd(items: Item[]): number {
  const i = items.length - 1;
  return i >= 0 && items[i].kind === "control" ? i : -1;
}

/**
 * The whole turn that ends at `index`: every text block back to the user message before it, joined in
 * order. Null when there is no text, or when a block's text is no longer kept.
 */
export function turnText(
  items: Item[],
  index: number,
  body: (key: string) => string | undefined = bodyForKey,
): string | null {
  const parts: string[] = [];
  for (let i = index; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user") break;
    if (item.kind !== "control") continue;
    const md = body(item.key);
    if (md === undefined) return null;
    if (md.trim()) parts.unshift(md.trim());
  }
  return parts.length ? parts.join("\n\n") : null;
}

const ITEMS =
  ".rich-transcript-message.user, .rich-transcript-waiting, .readaloud-control:not([hidden])";

function readItems(): { els: HTMLElement[]; items: Item[] } {
  const els = [...document.querySelectorAll<HTMLElement>(ITEMS)];
  const items = els.map(
    (el): Item =>
      el.classList.contains("readaloud-control")
        ? { kind: "control", key: el.dataset.readaloudKey ?? "" }
        : el.classList.contains("rich-transcript-waiting")
          ? { kind: "waiting" }
          : { kind: "user" },
  );
  return { els, items };
}

/** The text of the turn this control ends, read from the page at the moment of the press. */
function turnTextFor(el: HTMLElement | null): string | null {
  const { els, items } = readItems();
  const i = el ? els.indexOf(el) : -1;
  return i < 0 ? null : turnText(items, i);
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** The host has no rehype-raw, so raw HTML would show as text; drop our voice marker before that. */
function stripVoiceMarkers(node: HastNode) {
  if (!node.children) return;
  node.children = node.children.filter(
    (c) => !(c.type === "raw" && /^\s*<!--\s*voice:/i.test(c.value ?? "")),
  );
  node.children.forEach(stripVoiceMarkers);
}

export function rehypeReadAloud() {
  return (tree: HastNode, file: { value?: unknown }) => {
    const source =
      typeof file?.value === "string" ? file.value : String(file?.value ?? "");
    if (!source.trim() || !tree.children) return;
    stripVoiceMarkers(tree);
    tree.children.push({
      type: "element",
      tagName: CONTROL_TAG,
      properties: { dataKey: remember(source) },
      children: [],
    });
  };
}

/**
 * Show only on assistant text inside the agent transcript. Uses the host's
 * stable transcript class names (see README "Limitations").
 */
function isAssistantText(el: HTMLElement | null): boolean {
  if (!el) return false;
  const msg = el.closest(".rich-transcript-message");
  if (!msg || msg.classList.contains("user")) return false;
  if (
    el.closest(
      ".rich-transcript-tool-container, .rich-transcript-tool-messages, .rich-transcript-thinking, details",
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Marks the control that ends the last finished turn with data-turn-end; every other control stays hidden
 * (panel.css) unless it is the one playing. One observer for the whole window, recomputed once per frame
 * while the transcript changes.
 */
let turnObserver: MutationObserver | null = null;
let turnFrame = 0;

function markTurnEnds() {
  turnFrame = 0;
  const { els, items } = readItems();
  const last = lastTurnEnd(items);
  els.forEach((el, i) => {
    if (items[i].kind !== "control") return;
    const end = i === last;
    if (end !== el.hasAttribute("data-turn-end"))
      el.toggleAttribute("data-turn-end", end);
  });
}

function watchTurnEnds() {
  if (!turnFrame) turnFrame = requestAnimationFrame(markTurnEnds);
  if (turnObserver) return;
  turnObserver = new MutationObserver((records) => {
    // our own attribute writes are not childList changes, so they do not loop back here
    if (
      records.some(
        (r) => r.type === "childList" || r.attributeName === "hidden",
      ) &&
      !turnFrame
    ) {
      turnFrame = requestAnimationFrame(markTurnEnds);
    }
  });
  turnObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}

function Icon({ name }: { name: string }) {
  return <span className="material-symbols-outlined">{name}</span>;
}

/** A button with its icon and its word; the tooltip only where it says more than the word. */
function WordButton({
  icon,
  word,
  title,
  className = "",
  onClick,
  ...rest
}: {
  icon: string;
  word: string;
  title?: string;
  className?: string;
  onClick: () => void;
  "aria-pressed"?: boolean;
  "aria-keyshortcuts"?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`readaloud-btn ${className}`.trim()}
      title={title}
      onClick={onClick}
      {...rest}
    >
      <Icon name={icon} />
      <span className="readaloud-word">{word}</span>
    </button>
  );
}

/** The preparing orb shows only when preparing lasts longer than this, so a quick start does not flicker. */
export const ORB_DELAY_MS = 300;

/** Close: stop the player, clear its item and any error, back to rest. The one way out of the player box. */
export function closePlayer() {
  player.stop();
  player.clearError();
}

/**
 * Esc inside the player box closes it. The key stops here, so the app's own Esc (which stops a running turn)
 * does not fire too; outside the box Esc is left to the app. Returns whether the key was taken.
 */
export function boxKeyDown(
  e: { key: string; preventDefault(): void; stopPropagation(): void },
  close: () => void = closePlayer,
): boolean {
  if (e.key !== "Escape") return false;
  e.preventDefault();
  e.stopPropagation();
  close();
  return true;
}

export interface BoxView {
  state: "preparing" | "playing" | "paused";
  /** The state word, line 1's lead ("Playing"). */
  word: string;
  /** Where it is ("part 2 of 5"); empty for a one-part reply. */
  detail: string;
  /** What sits before the word: the breathing orb (preparing, after ORB_DELAY_MS), a still dot, or nothing yet. */
  mark: "orb" | "dot" | "none";
}

/** What the player box shows for one block, or null when that block is at rest (no box). */
export function boxView(
  st: PlayerState,
  key: string | null | undefined,
  orbShown: boolean,
): BoxView | null {
  if (!key || st.key !== key || st.status === "idle") return null;
  const n = st.chunk + 1;
  const many = st.total > 1;
  if (st.status === "paused")
    return {
      state: "paused",
      word: t.statePaused,
      detail: many ? t.pausedAt(n, st.total) : "",
      mark: "dot",
    };
  const detail = many ? t.partOf(n, st.total) : "";
  if (st.status === "synthesizing")
    return {
      state: "preparing",
      word: t.statePreparing,
      detail,
      mark: orbShown ? "orb" : "none",
    };
  return { state: "playing", word: t.statePlaying, detail, mark: "dot" };
}

export function ReadAloudControl(props: Record<string, unknown>) {
  const key = (props["data-key"] ?? props.dataKey) as string | undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const [eligible, setEligible] = useState(false);
  const [orbShown, setOrbShown] = useState(false);
  const refocus = useRef(false);
  const st = usePlayer();
  const settings = useSettings();

  useLayoutEffect(() => {
    setEligible(isAssistantText(ref.current));
  }, []);

  const visible = eligible && settings.enabled && !!key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: visible (the control shown or hidden) is the trigger: the effect must run again when it changes
  useLayoutEffect(watchTurnEnds, [visible]);

  const preparing = !!key && st.key === key && st.status === "synthesizing";
  useEffect(() => {
    if (!preparing) {
      setOrbShown(false);
      return;
    }
    const timer = setTimeout(() => setOrbShown(true), ORB_DELAY_MS);
    return () => clearTimeout(timer);
  }, [preparing]);

  const view = boxView(st, key, orbShown);
  const error = st.error && st.error.key === key ? st.error.message : null;

  // Closing from inside the box hands the focus to "Read aloud", so the keyboard is not dropped on the page
  const close = () => {
    refocus.current = !!ref.current?.contains(document.activeElement);
    closePlayer();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the player opens or closes, not when the open view changes
  useLayoutEffect(() => {
    if (view || !refocus.current) return;
    refocus.current = false;
    ref.current?.querySelector<HTMLButtonElement>(".readaloud-btn")?.focus();
  }, [!!view]);

  const readAloud = () => {
    const text = turnTextFor(ref.current);
    if (key && text) player.play(key, text);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: catches the keys of the focusable player inside the control
    <span
      ref={ref}
      className={`readaloud-control${view ? " active" : ""}`}
      data-readaloud-key={key}
      hidden={!visible}
      onKeyDown={view ? (e) => void boxKeyDown(e, close) : undefined}
    >
      {view ? (
        <>
          <span className="readaloud-status" aria-live="polite">
            <span className="readaloud-mark">
              {view.mark === "orb" && (
                <canvas data-orb="breathing" data-orb-px="24" aria-hidden />
              )}
              {view.mark === "dot" && (
                <span className={`readaloud-dot ${view.state}`} />
              )}
            </span>
            <span className={`readaloud-state-word ${view.state}`}>
              {view.word}
            </span>
            {view.detail && (
              <span className="readaloud-detail">{view.detail}</span>
            )}
          </span>
          <span className="readaloud-actions">
            {view.state === "paused" ? (
              <WordButton
                icon="play_arrow"
                word={t.resume}
                onClick={() => player.resume()}
              />
            ) : (
              <WordButton
                icon="pause"
                word={t.pause}
                onClick={() => player.pause()}
              />
            )}
            <WordButton
              icon="skip_next"
              word={t.next}
              title={t.skipAhead}
              disabled={view.state === "preparing"}
              onClick={() => void player.skip()}
            />
            <label className="readaloud-speed" title={t.speedLabel}>
              <input
                type="range"
                className="readaloud-range"
                aria-label={t.speedLabel}
                min={0.5}
                max={2}
                step={0.05}
                value={settings.speed}
                onChange={(e) =>
                  void updateSetting("speed", Number(e.target.value))
                }
              />
              <span className="readaloud-speed-value">
                {formatSpeed(settings.speed)}
              </span>
            </label>
            <WordButton
              icon="close"
              word={t.close}
              title={t.closeTip}
              className="readaloud-close"
              aria-keyshortcuts="Escape"
              onClick={close}
            />
          </span>
        </>
      ) : (
        <>
          <WordButton icon="volume_up" word={t.readAloud} onClick={readAloud} />
          {error && (
            <span className="readaloud-error" role="alert">
              <span className="readaloud-dot error" />
              <span className="readaloud-error-text">{error}</span>
              <button
                type="button"
                className="readaloud-dismiss"
                onClick={() => player.clearError()}
              >
                {t.dismiss}
              </button>
            </span>
          )}
        </>
      )}
    </span>
  );
}

/** Tokens plus the panel stylesheet, handed to the host as css-text and also mounted by the settings page. */
export const TRANSCRIPT_CSS = `${tokensCss}\n${panelCss}`;
