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

import { useLayoutEffect, useRef, useState } from 'react';
import { player, usePlayer } from './player';
import { updateSetting, useSettings } from './settings';
import { setAutoRead } from './autoRead';
import { splitVoice } from './cleanText';

export const CONTROL_TAG = 'readaloud-control';

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
export function speechForKey(key: string | null | undefined): { short: string; full: string; hasSummary: boolean } | undefined {
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
  node.children = node.children.filter((c) => !(c.type === 'raw' && /^\s*<!--\s*voice:/i.test(c.value ?? '')));
  node.children.forEach(stripVoiceMarkers);
}

const SPEEDS = [1, 1.25, 1.5, 2];

export function rehypeReadAloud() {
  return (tree: HastNode, file: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : String(file?.value ?? '');
    if (!source.trim() || !tree.children) return;
    stripVoiceMarkers(tree);
    tree.children.push({
      type: 'element',
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
  const msg = el.closest('.rich-transcript-message');
  if (!msg || msg.classList.contains('user')) return false;
  if (el.closest('.rich-transcript-tool-container, .rich-transcript-tool-messages, .rich-transcript-thinking, details')) {
    return false;
  }
  return true;
}

function Icon({ name, spin }: { name: string; spin?: boolean }) {
  return <span className={`material-symbols-outlined${spin ? ' readaloud-spin' : ''}`}>{name}</span>;
}

export function ReadAloudControl(props: Record<string, unknown>) {
  const key = (props['data-key'] ?? props.dataKey) as string | undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const [eligible, setEligible] = useState(false);
  const st = usePlayer();
  const settings = useSettings();

  useLayoutEffect(() => {
    setEligible(isAssistantText(ref.current));
  }, []);

  const visible = eligible && settings.enabled && !!key;
  const mine = !!key && st.key === key;
  const error = st.error && st.error.key === key ? st.error.message : null;

  const speech = speechForKey(key);
  const readAloud = (full: boolean) => {
    if (key && speech) player.play(key, full ? speech.full : speech.short);
  };

  const cycleSpeed = () => {
    const next = SPEEDS.find((v) => v > settings.speed + 0.01) ?? SPEEDS[0];
    void updateSetting('speed', next);
  };

  const toggleAuto = () => {
    const next = !settings.autoRead;
    void updateSetting('autoRead', next);
    setAutoRead(next);
  };

  return (
    <span ref={ref} className={`readaloud-control${mine ? ' active' : ''}`} data-readaloud-key={key} hidden={!visible}>
      {!mine && (
        <button type="button" className="readaloud-btn" title={speech?.hasSummary ? 'Read the short spoken summary' : 'Read aloud'} onClick={() => readAloud(false)}>
          <Icon name="volume_up" />
        </button>
      )}
      {!mine && speech?.hasSummary && (
        <button type="button" className="readaloud-btn" title="Read the full reply" onClick={() => readAloud(true)}>
          <Icon name="article" />
        </button>
      )}
      {mine && st.status === 'synthesizing' && (
        <>
          <span className="readaloud-btn" title="Preparing speech">
            <Icon name="progress_activity" spin />
          </span>
          <button type="button" className="readaloud-btn" title="Pause" onClick={() => player.pause()}>
            <Icon name="pause" />
          </button>
        </>
      )}
      {mine && st.status === 'playing' && (
        <button type="button" className="readaloud-btn on" title="Pause" onClick={() => player.pause()}>
          <Icon name="pause" />
        </button>
      )}
      {mine && st.status === 'paused' && (
        <button type="button" className="readaloud-btn on" title="Resume" onClick={() => player.resume()}>
          <Icon name="play_arrow" />
        </button>
      )}
      {mine && (
        <button type="button" className="readaloud-btn" title="Skip ahead" onClick={() => void player.skip()}>
          <Icon name="skip_next" />
        </button>
      )}
      {mine && (
        <button type="button" className="readaloud-btn" title="Stop" onClick={() => player.stop()}>
          <Icon name="stop" />
        </button>
      )}
      <button
        type="button"
        className="readaloud-btn readaloud-speed"
        title="Speech speed (click to change; applies from the next sentence)"
        onClick={cycleSpeed}
      >
        {settings.speed}×
      </button>
      {mine && st.total > 1 && (
        <span className="readaloud-status">
          {st.chunk + 1}/{st.total}
        </span>
      )}
      <button
        type="button"
        className={`readaloud-btn readaloud-auto${settings.autoRead ? ' on' : ''}`}
        title={settings.autoRead ? 'Hands-free reading is on: finished replies and questions are read aloud. Click to turn off.' : 'Turn on hands-free reading (reads finished replies and questions aloud)'}
        onClick={toggleAuto}
      >
        <Icon name="headphones" />
      </button>
      {error && (
        <span className="readaloud-error" title={error} onClick={() => player.clearError()}>
          <Icon name="error" /> {error}
        </span>
      )}
    </span>
  );
}

export const TRANSCRIPT_CSS = `
.readaloud-control { display: flex; align-items: center; gap: 2px; margin-top: 4px; opacity: 0.4; transition: opacity 120ms; flex-wrap: wrap; }
.readaloud-control[hidden] { display: none; }
.rich-transcript-message:hover .readaloud-control, .readaloud-control.active, .readaloud-control:focus-within { opacity: 1; }
.readaloud-control .readaloud-auto, .readaloud-control .readaloud-speed { opacity: 0; }
.rich-transcript-message:hover .readaloud-control .readaloud-auto, .readaloud-control .readaloud-auto.on,
.rich-transcript-message:hover .readaloud-control .readaloud-speed, .readaloud-control.active .readaloud-speed { opacity: 1; }
.readaloud-speed { font-size: 11px; min-width: 30px; }
.readaloud-btn { display: inline-flex; align-items: center; justify-content: center; background: none; border: 0; padding: 2px; border-radius: 4px; color: var(--nim-text-muted); cursor: pointer; line-height: 1; }
.readaloud-btn:hover { background: var(--nim-bg-tertiary); color: var(--nim-text); }
.readaloud-btn.on { color: var(--nim-primary); }
.readaloud-btn .material-symbols-outlined, .readaloud-error .material-symbols-outlined { font-size: 16px; }
.readaloud-status { font-size: 11px; color: var(--nim-text-faint); margin-left: 2px; }
.readaloud-error { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--nim-error); margin-left: 4px; cursor: pointer; max-width: 100%; }
.readaloud-spin { animation: readaloud-spin 1s linear infinite; }
@keyframes readaloud-spin { to { transform: rotate(360deg); } }
`;
