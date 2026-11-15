/**
 * Single in-app player (Web Audio). Text is cleaned, chunked, and synthesized
 * one chunk ahead of playback, so long replies start speaking quickly.
 * Only one item plays at a time; a play replaces whatever is playing.
 * No files are written: audio arrives as
 * base64 WAV and is decoded in memory.
 */

import { useSyncExternalStore } from "react";
import { callBackend } from "./bridge";
import { chunkForSpeech, cleanForSpeech } from "./cleanText";
import { getSettings } from "./settings";
import { t } from "./strings";

export type PlayerStatus = "idle" | "synthesizing" | "playing" | "paused";

export interface PlayerState {
  status: PlayerStatus;
  key: string | null;
  chunk: number;
  total: number;
  /** Last error, tagged with the item it belongs to. */
  error: { key: string; message: string } | null;
}

interface SynthResult {
  audio: string;
  duration: number;
}

class Player {
  private state: PlayerState = {
    status: "idle",
    key: null,
    chunk: 0,
    total: 0,
    error: null,
  };
  private listeners = new Set<() => void>();
  private gen = 0;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  get = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private set(patch: Partial<PlayerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Stops anything current and plays this. */
  play(key: string, markdown: string) {
    void this.start(key, markdown);
  }

  private async start(key: string, markdown: string) {
    const wasActive = this.state.status !== "idle";
    this.halt(wasActive);
    const g = ++this.gen;
    const s = getSettings();
    const chunks = chunkForSpeech(cleanForSpeech(markdown, s));
    if (!chunks.length) {
      this.set({
        status: "idle",
        key: null,
        error: { key, message: t.nothingToRead },
      });
      return;
    }
    this.set({
      status: "synthesizing",
      key,
      chunk: 0,
      total: chunks.length,
      error: null,
    });

    try {
      const ctx = (this.ctx ??= new AudioContext());
      if (ctx.state === "suspended") await ctx.resume();
      const synth = async (i: number) => {
        const r = await callBackend<SynthResult>("synthesize", {
          text: chunks[i].text,
          paragraphEnd: chunks[i].paragraphEnd,
          voice: s.voice,
          speed: s.speed,
          dir: s.ttsDirectory,
        });
        return ctx.decodeAudioData(base64ToArrayBuffer(r.audio));
      };

      let next: Promise<AudioBuffer> | null = synth(0);
      for (let i = 0; i < chunks.length; i++) {
        // biome-ignore lint/style/noNonNullAssertion: next is null only after the last chunk, where the loop ends
        const buf: AudioBuffer = await next!;
        if (g !== this.gen) return;
        next = i + 1 < chunks.length ? synth(i + 1) : null;
        next?.catch(() => undefined); // surfaced when awaited
        this.set({ status: this.isPaused() ? "paused" : "playing", chunk: i });
        await this.playBuffer(ctx, buf);
        if (g !== this.gen) return;
        if (i + 1 < chunks.length && !this.isPaused())
          this.set({ status: "synthesizing" });
      }
      this.set({ status: "idle", key: null, chunk: 0, total: 0 });
    } catch (err) {
      if (g !== this.gen) return;
      const message = err instanceof Error ? err.message : String(err);
      this.set({ status: "idle", key: null, error: { key, message } });
    }
  }

  private playBuffer(ctx: AudioContext, buf: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        if (this.source === src) this.source = null;
        resolve();
      };
      this.source = src;
      src.start();
    });
  }

  private isPaused() {
    return this.ctx?.state === "suspended";
  }

  /** Stop audio and invalidate in-flight work . */
  private halt(cancelBackend: boolean) {
    this.gen++;
    const src = this.source;
    this.source = null;
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* not started */
      }
    }
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    if (cancelBackend) callBackend("stop").catch(() => undefined);
  }

  stop() {
    const wasActive = this.state.status !== "idle";
    this.halt(wasActive);
    if (wasActive) this.set({ status: "idle", key: null, chunk: 0, total: 0 });
  }

  pause() {
    if (
      !this.ctx ||
      this.state.status === "idle" ||
      this.state.status === "paused"
    )
      return;
    void this.ctx.suspend();
    this.set({ status: "paused" });
  }

  resume() {
    if (!this.ctx || this.state.status !== "paused") return;
    void this.ctx.resume();
    this.set({ status: this.source ? "playing" : "synthesizing" });
  }

  /** Jump to the next chunk (after the last chunk, playback ends). */
  async skip() {
    const src = this.source;
    if (!this.ctx || !src || this.state.status === "idle") return;
    if (this.isPaused()) await this.ctx.resume();
    this.set({ status: "playing" });
    try {
      src.stop(); // fires onended, so playback moves on
    } catch {
      /* not started */
    }
  }

  clearError() {
    if (this.state.error) this.set({ error: null });
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export const player = new Player();

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.get, player.get);
}
