/**
 * Single in-app player (Web Audio). Text is cleaned, chunked, and synthesized
 * one chunk ahead of playback, so long replies start speaking quickly.
 * Only one item plays at a time; a manual play replaces whatever is playing,
 * auto-read items queue behind it. No files are written: audio arrives as
 * base64 WAV and is decoded in memory.
 */

import { useSyncExternalStore } from 'react';
import { callBackend } from './bridge';
import { chunkForSpeech, cleanForSpeech } from './cleanText';
import { getSettings } from './settings';

export type PlayerStatus = 'idle' | 'synthesizing' | 'playing' | 'paused';

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
  private state: PlayerState = { status: 'idle', key: null, chunk: 0, total: 0, error: null };
  private listeners = new Set<() => void>();
  private gen = 0;
  private ctx: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pending: Array<{ key: string; markdown: string }> = [];

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

  /** Manual play: stops anything current and clears the auto-read queue. */
  play(key: string, markdown: string) {
    this.pending = [];
    void this.start(key, markdown);
  }

  /** Auto-read: plays now if idle, otherwise waits its turn. */
  enqueue(key: string, markdown: string) {
    if (this.state.status === 'idle') void this.start(key, markdown);
    else if (this.state.key !== key && !this.pending.some((p) => p.key === key)) this.pending.push({ key, markdown });
  }

  private async start(key: string, markdown: string) {
    const wasActive = this.state.status !== 'idle';
    this.halt(wasActive);
    const g = ++this.gen;
    const s = getSettings();
    const chunks = chunkForSpeech(cleanForSpeech(markdown, s));
    if (!chunks.length) {
      this.set({ status: 'idle', key: null, error: { key, message: 'Nothing to read in this message.' } });
      return this.next();
    }
    this.set({ status: 'synthesizing', key, chunk: 0, total: chunks.length, error: null });

    try {
      const ctx = (this.ctx ??= new AudioContext());
      if (ctx.state === 'suspended') await ctx.resume();
      const synth = async (i: number) => {
        const r = await callBackend<SynthResult>('synthesize', {
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
        const buf: AudioBuffer = await next!;
        if (g !== this.gen) return;
        next = i + 1 < chunks.length ? synth(i + 1) : null;
        next?.catch(() => undefined); // surfaced when awaited
        this.set({ status: this.isPaused() ? 'paused' : 'playing', chunk: i });
        await this.playBuffer(ctx, buf);
        if (g !== this.gen) return;
        if (i + 1 < chunks.length && !this.isPaused()) this.set({ status: 'synthesizing' });
      }
      this.set({ status: 'idle', key: null, chunk: 0, total: 0 });
    } catch (err) {
      if (g !== this.gen) return;
      const message = err instanceof Error ? err.message : String(err);
      this.set({ status: 'idle', key: null, error: { key, message } });
      this.pending = [];
      return;
    }
    this.next();
  }

  private next() {
    const item = this.pending.shift();
    if (item) void this.start(item.key, item.markdown);
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
    return this.ctx?.state === 'suspended';
  }

  /** Stop audio and invalidate in-flight work without touching the queue. */
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
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    if (cancelBackend) callBackend('stop').catch(() => undefined);
  }

  stop() {
    this.pending = [];
    const wasActive = this.state.status !== 'idle';
    this.halt(wasActive);
    if (wasActive) this.set({ status: 'idle', key: null, chunk: 0, total: 0 });
  }

  pause() {
    if (!this.ctx || this.state.status === 'idle' || this.state.status === 'paused') return;
    void this.ctx.suspend();
    this.set({ status: 'paused' });
  }

  resume() {
    if (!this.ctx || this.state.status !== 'paused') return;
    void this.ctx.resume();
    this.set({ status: this.source ? 'playing' : 'synthesizing' });
  }

  /** Jump to the next chunk (or the next queued item after the last chunk). */
  async skip() {
    const src = this.source;
    if (!this.ctx || !src || this.state.status === 'idle') return;
    if (this.isPaused()) await this.ctx.resume();
    this.set({ status: 'playing' });
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
