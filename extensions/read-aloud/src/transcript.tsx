/**
 * Transcript integration through the documented contribution point:
 * a rehype plugin appends one <readaloud-control data-key> element to every
 * rendered transcript markdown block, and a component override renders it.
 * The custom tag name is unique to this extension, so it cannot collide with
 * other extensions' `components` overrides (last-registered-wins is per key).
 *
 * The Markdown source for each block is kept in a small in-memory map keyed by
 * a hash, so the visible transcript is never modified.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { player, usePlayer } from "./player";
import { updateSetting, useSettings } from "./settings";
import { setAutoRead } from "./autoRead";
import { splitVoice } from "./cleanText";
import { formatSpeed, t } from "./strings";
import tokensCss from "../../shared/tokens.css?inline";
import panelCss from "./panel.css?inline";

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

export function ReadAloudControl(props: Record<string, unknown>) {
  const key = (props["data-key"] ?? props.dataKey) as string | undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const [eligible, setEligible] = useState(false);
  const st = usePlayer();
  const settings = useSettings();

  useLayoutEffect(() => {
    setEligible(isAssistantText(ref.current));
  }, []);

  const visible = eligible && settings.enabled && !!key;
  useLayoutEffect(watchTurnEnds, [visible]);
  const mine = !!key && st.key === key;
  const error = st.error && st.error.key === key ? st.error.message : null;

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
    <span
      ref={ref}
      className={`readaloud-control${mine ? " active" : ""}`}
      data-readaloud-key={key}
      hidden={!visible}
    >
      {!mine && (
        <button
          type="button"
          className="readaloud-btn"
          title={speech?.hasSummary ? t.readSummary : t.readAloud}
          onClick={() => readAloud(false)}
        >
          <Icon name="volume_up" />
        </button>
      )}
      {!mine && speech?.hasSummary && (
        <button
          type="button"
          className="readaloud-btn"
          title={t.readFull}
          onClick={() => readAloud(true)}
        >
          <Icon name="article" />
        </button>
      )}
      {mine && st.status === "synthesizing" && (
        <button
          type="button"
          className="readaloud-btn"
          title={t.pause}
          aria-label={t.pause}
          onClick={() => player.pause()}
        >
          <Icon name="pause" />
        </button>
      )}
      {mine && st.status === "playing" && (
        <button
          type="button"
          className="readaloud-btn on"
          title={t.pause}
          onClick={() => player.pause()}
        >
          <Icon name="pause" />
        </button>
      )}
      {mine && st.status === "paused" && (
        <button
          type="button"
          className="readaloud-btn on"
          title={t.resume}
          onClick={() => player.resume()}
        >
          <Icon name="play_arrow" />
        </button>
      )}
      {mine && (
        <button
          type="button"
          className="readaloud-btn"
          title={t.skipAhead}
          onClick={() => void player.skip()}
        >
          <Icon name="skip_next" />
        </button>
      )}
      {mine && (
        <button
          type="button"
          className="readaloud-btn"
          title={t.stop}
          onClick={() => player.stop()}
        >
          <Icon name="stop" />
        </button>
      )}
      {mine && (
        <span className="readaloud-state">
          <span
            className={`readaloud-dot${st.status === "paused" ? "" : " live"}`}
          />
          {st.status === "synthesizing"
            ? t.statePreparing
            : st.status === "paused"
              ? t.statePaused
              : t.statePlaying}
          {st.total > 1 && (
            <span className="readaloud-count">
              {st.chunk + 1}/{st.total}
            </span>
          )}
        </span>
      )}
      {mine && (
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
      )}
      <button
        type="button"
        className={`readaloud-btn readaloud-auto${settings.autoRead ? " on" : ""}`}
        title={settings.autoRead ? t.autoOnTip : t.autoOffTip}
        aria-label={settings.autoRead ? t.autoOnTip : t.autoOffTip}
        aria-pressed={settings.autoRead}
        onClick={toggleAuto}
      >
        <Icon name="headphones" />
      </button>
      {error && (
        <span className="readaloud-error">
          <span className="readaloud-dot error" />
          {error}
          <button
            type="button"
            className="readaloud-btn"
            title={t.dismiss}
            aria-label={t.dismiss}
            onClick={() => player.clearError()}
          >
            <Icon name="close" />
          </button>
        </span>
      )}
    </span>
  );
}

/** Tokens plus the panel stylesheet, handed to the host as css-text and also mounted by the settings page. */
export const TRANSCRIPT_CSS = `${tokensCss}\n${panelCss}`;
