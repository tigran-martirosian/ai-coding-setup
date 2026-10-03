import { useSyncExternalStore } from 'react';

export interface ReadAloudSettings {
  enabled: boolean;
  voice: string;
  speed: number;
  skipCodeBlocks: boolean;
  skipTerminalOutput: boolean;
  ttsDirectory: string;
  autoRead: boolean;
}

export const DEFAULTS: ReadAloudSettings = {
  enabled: true,
  voice: 'af_sky',
  speed: 1.0,
  skipCodeBlocks: true,
  skipTerminalOutput: true,
  ttsDirectory: 'C:\\LocalTTS',
  autoRead: false,
};

/** American English voices only; af_sky is the default. */
export const VOICES = ['af_sky', 'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_river', 'af_nova', 'af_jessica', 'af_aoede'];

interface ConfigService {
  get<T>(key: string, defaultValue?: T): T;
  update(key: string, value: unknown, scope?: 'user' | 'workspace'): Promise<void>;
}

let config: ConfigService | undefined;
let snapshot: ReadAloudSettings = { ...DEFAULTS };
const listeners = new Set<() => void>();

function read(): ReadAloudSettings {
  const next = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof ReadAloudSettings)[]) {
    const v = config?.get(key, DEFAULTS[key]);
    if (v !== undefined && typeof v === typeof DEFAULTS[key]) (next as Record<string, unknown>)[key] = v;
  }
  return next;
}

function refresh() {
  const next = read();
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
    snapshot = next;
    listeners.forEach((l) => l());
  }
}

export function initSettings(service: ConfigService | undefined) {
  config = service;
  refresh();
  // The host loads stored values asynchronously after activate().
  setTimeout(refresh, 500);
  setTimeout(refresh, 2000);
}

export function getSettings(): ReadAloudSettings {
  return snapshot;
}

export async function updateSetting<K extends keyof ReadAloudSettings>(key: K, value: ReadAloudSettings[K]) {
  snapshot = { ...snapshot, [key]: value };
  listeners.forEach((l) => l());
  await config?.update(key, value, 'user');
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSettings(): ReadAloudSettings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings);
}
