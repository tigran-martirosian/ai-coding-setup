/**
 * The copy row at the end of each finished assistant turn: Copy, "Copied" for 2 s, or a plain error with Dismiss.
 *
 * It comes in through the transcript markdown contribution (registered in index.tsx): a rehype plugin adds one
 * <cb-copy-row data-key> element to every rendered markdown block and keeps the block's Markdown in a map. Only the
 * element of a turn's last text block shows (data-turn-end, set by one observer below); its Copy joins every text
 * block of the turn, so the whole reply is copied as Markdown, not one block.
 *
 * Read Aloud adds its own strip to the same blocks; the plugin puts this element before it, so Copy comes first on
 * the shared line (copy-row.css draws the divider).
 */

import { copyToClipboard } from "@nimbalyst/extension-sdk";
import type { RefObject } from "react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { t } from "./strings";

export const COPY_TAG = "cb-copy-row";
/** Read Aloud's element in the same blocks (extensions/read-aloud/src/transcript.tsx, CONTROL_TAG). */
const READ_ALOUD_TAG = "readaloud-control";
/** How long "Copied" stays before the button returns to rest. */
export const COPIED_MS = 2000;

// ---- The Markdown of each block, kept by key so the visible transcript is never changed ----

const texts = new Map<string, string>();
const MAX_TEXTS = 1000;

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

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export function rehypeCopyRow() {
  return (tree: HastNode, file: { value?: unknown }) => {
    const source =
      typeof file?.value === "string" ? file.value : String(file?.value ?? "");
    if (!source.trim() || !tree.children) return;
    const node: HastNode = {
      type: "element",
      tagName: COPY_TAG,
      properties: { dataKey: remember(source) },
      children: [],
    };
    const readAloud = tree.children.findIndex(
      (c) => c.type === "element" && c.tagName === READ_ALOUD_TAG,
    );
    if (readAloud < 0) tree.children.push(node);
    else tree.children.splice(readAloud, 0, node);
  };
}

// ---- Turns: which element ends a turn, and which blocks make up its reply ----

/** One item of the transcript in document order: a user message, the app's "Thinking" line, or a copy element. */
export type Item =
  | { kind: "user" }
  | { kind: "waiting" }
  | { kind: "copy"; key: string };

/**
 * For each copy element: whether it ends a finished turn, and whether that turn is the last one.
 * A turn ends at the last copy element before a user message or the end of the list; a "Thinking" line after it
 * means the turn still runs, so it gets no row yet.
 */
export function turnEnds(items: Item[]): { end: boolean; last: boolean }[] {
  return items.map((item, i) => {
    if (item.kind !== "copy") return { end: false, last: false };
    const next = items[i + 1];
    return { end: !next || next.kind === "user", last: !next };
  });
}

/**
 * The whole reply of the turn that ends at `index`: the Markdown of every text block back to the user message
 * before it, joined in order. Null when a block's text is no longer kept.
 */
export function replyMarkdown(
  items: Item[],
  index: number,
  kept: ReadonlyMap<string, string> = texts,
): string | null {
  const parts: string[] = [];
  for (let i = index; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "user") break;
    if (item.kind !== "copy") continue;
    const md = kept.get(item.key);
    if (md === undefined) return null;
    parts.unshift(md.trim());
  }
  return parts.join("\n\n");
}

const ITEMS = `.rich-transcript-message.user, .rich-transcript-waiting, .cb-copy:not([hidden])`;

function readItems(): { els: HTMLElement[]; items: Item[] } {
  const els = [...document.querySelectorAll<HTMLElement>(ITEMS)];
  const items = els.map(
    (el): Item =>
      el.classList.contains("cb-copy")
        ? { kind: "copy", key: el.dataset.cbKey ?? "" }
        : el.classList.contains("rich-transcript-waiting")
          ? { kind: "waiting" }
          : { kind: "user" },
  );
  return { els, items };
}

let turnObserver: MutationObserver | null = null;
let turnFrame = 0;

function markTurnEnds() {
  turnFrame = 0;
  const { els, items } = readItems();
  turnEnds(items).forEach(({ end, last }, i) => {
    const el = els[i];
    if (items[i].kind !== "copy") return;
    if (end !== el.hasAttribute("data-turn-end"))
      el.toggleAttribute("data-turn-end", end);
    if (last !== el.hasAttribute("data-last-turn"))
      el.toggleAttribute("data-last-turn", last);
  });
}

/** One observer for the whole window, recomputed once per frame while the transcript changes. */
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
    )
      turnFrame = requestAnimationFrame(markTurnEnds);
  });
  turnObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}

export function stopWatchingTurns() {
  turnObserver?.disconnect();
  turnObserver = null;
  if (turnFrame) cancelAnimationFrame(turnFrame);
  turnFrame = 0;
}

/** Only assistant text in the agent transcript, not tool cards or thinking (the app's transcript class names). */
function isReplyText(el: HTMLElement | null): boolean {
  if (!el) return false;
  const msg = el.closest(".rich-transcript-message");
  if (!msg || msg.classList.contains("user")) return false;
  return !el.closest(
    ".rich-transcript-tool-container, .rich-transcript-tool-messages, .rich-transcript-thinking, details",
  );
}

/** The reply of the turn this element ends, read from the page at the moment of the press. */
function replyFor(el: HTMLElement | null): string | null {
  const { els, items } = readItems();
  const i = el ? els.indexOf(el) : -1;
  return i < 0 ? null : replyMarkdown(items, i);
}

// ---- The button's state ----

export type CopyState =
  | { kind: "rest" }
  | { kind: "copied" }
  | { kind: "failed"; message: string; detail: string };

const REST: CopyState = { kind: "rest" };

/**
 * One row's state. `copy` writes through `write` once: on success "Copied" for `holdMs`, on a refusal the error
 * stays until Dismiss. Nothing else is tried after a refusal, and a refusal never shows "Copied".
 */
export function createCopy(
  write: (text: string) => Promise<void>,
  holdMs = COPIED_MS,
) {
  let state: CopyState = REST;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const subs = new Set<() => void>();
  const set = (next: CopyState) => {
    state = next;
    subs.forEach((f) => f());
  };
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    get: () => state,
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
    /** `markdown` is null when the reply's text could not be read. */
    async copy(markdown: string | null) {
      stopTimer();
      if (markdown === null) {
        set({ kind: "failed", message: t.copy.noText, detail: "" });
        return;
      }
      try {
        await write(markdown);
      } catch (e) {
        set({
          kind: "failed",
          message: t.copy.blocked,
          detail: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      set({ kind: "copied" });
      timer = setTimeout(() => {
        timer = undefined;
        set(REST);
      }, holdMs);
    },
    dismiss() {
      stopTimer();
      set(REST);
    },
    dispose: stopTimer,
  };
}

// ---- Drawing ----

const Sym = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined cb-copy-sym" aria-hidden="true">
    {name}
  </span>
);

/** The row's contents for one state. Both faces of the button are drawn, so its width never changes. */
export function CopyRowView({
  state,
  onCopy,
  onDismiss,
  copyRef,
}: {
  state: CopyState;
  onCopy: () => void;
  onDismiss: () => void;
  copyRef?: RefObject<HTMLButtonElement | null>;
}) {
  const copied = state.kind === "copied";
  return (
    <>
      <button
        ref={copyRef}
        type="button"
        className="cb-copy-btn"
        data-copied={copied || undefined}
        title={t.copy.hint}
        onClick={onCopy}
      >
        <span className="cb-copy-face" aria-hidden={copied || undefined}>
          <Sym name="content_copy" />
          {t.copy.button}
        </span>
        <span
          className="cb-copy-face cb-copy-done"
          aria-hidden={!copied || undefined}
        >
          <Sym name="check" />
          {t.copy.done}
        </span>
      </button>
      {state.kind === "failed" && (
        <span
          className="cb-copy-error"
          role="alert"
          title={state.detail || undefined}
        >
          <span className="cb-copy-dot" />
          <span className="cb-copy-error-text">{state.message}</span>
          <button type="button" className="cb-copy-dismiss" onClick={onDismiss}>
            {t.copy.dismiss}
          </button>
        </span>
      )}
    </>
  );
}

/** The element the rehype plugin adds; rendered by the host for every markdown block. */
export function CopyRow(props: Record<string, unknown>) {
  const key = (props["data-key"] ?? props.dataKey) as string | undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [eligible, setEligible] = useState(false);
  const [store] = useState(() => createCopy(copyToClipboard));
  const state = useSyncExternalStore(store.subscribe, store.get);

  useLayoutEffect(() => {
    setEligible(isReplyText(ref.current));
  }, []);
  const visible = eligible && !!key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: visible (the row shown or hidden) is the trigger: the effect must run again when it changes
  useLayoutEffect(watchTurnEnds, [visible]);
  useEffect(() => store.dispose, [store]);

  return (
    <span ref={ref} className="cb-copy" data-cb-key={key} hidden={!visible}>
      <CopyRowView
        state={state}
        copyRef={button}
        onCopy={() => void store.copy(replyFor(ref.current))}
        onDismiss={() => {
          store.dismiss();
          button.current?.focus();
        }}
      />
    </span>
  );
}
