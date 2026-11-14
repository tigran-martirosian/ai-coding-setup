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
 * At rest the control is one line of worded buttons (Read aloud, Read full, Hands-free). While its block is
 * read it becomes the player box: line 1 the state word and the part, line 2 Pause or Resume, Next, speed and
 * Close. Close (or Esc inside the box) stops, clears and returns to rest.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import tokensCss from "../../shared/tokens.css?inline";
import { setAutoRead } from "./autoRead";
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

/** What to speak for a block: the hidden voice summary if there is one, and the full reply. */
export function speechForKey(
  key: string | null | undefined,
): { short: string; full: string; hasSummary: boolean } | undefined {
  const md = key ? texts.get(key) : undefined;
  if (md === undefined) return undefined;
  const { body, summary } = splitVoice(md);
  return { short: summary ?? body, full: body, hasSummary: summary !== null };
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
 * Marks the last control before each user message (and the very last one) with data-turn-end,
 * so a reply shows one strip at the end of its turn instead of one per text block.
 * One observer for the whole window, recomputed once per frame while the transcript changes.
 */
let turnObserver: MutationObserver | null = null;
let turnFrame = 0;

function markTurnEnds() {
  turnFrame = 0;
  const items = document.querySelectorAll<HTMLElement>(
    ".rich-transcript-message.user, .readaloud-control:not([hidden])",
  );
  items.forEach((el, i) => {
    if (!el.classList.contains("readaloud-control")) return;
    const next = items[i + 1];
    const end = !next || !next.classList.contains("readaloud-control");
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

  const speech = speechForKey(key);
  const readAloud = (full: boolean) => {
    if (key && speech) player.play(key, full ? speech.full : speech.short);
  };

  const toggleAuto = () => {
    const next = !settings.autoRead;
    void updateSetting("autoRead", next);
    setAutoRead(next);
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
          <WordButton
            icon="volume_up"
            word={t.readAloud}
            title={speech?.hasSummary ? t.readSummary : undefined}
            onClick={() => readAloud(false)}
          />
          {speech?.hasSummary && (
            <WordButton
              icon="article"
              word={t.readFullWord}
              title={t.readFull}
              onClick={() => readAloud(true)}
            />
          )}
          <WordButton
            icon="headphones"
            word={settings.autoRead ? t.autoOnWord : t.autoWord}
            title={settings.autoRead ? t.autoOnTip : t.autoOffTip}
            className={`readaloud-auto${settings.autoRead ? " on" : ""}`}
            aria-pressed={settings.autoRead}
            onClick={toggleAuto}
          />
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
