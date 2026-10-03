/**
 * Read Aloud: local Kokoro text-to-speech for agent replies.
 *
 * Renderer entry. The backend module (dist/backend.js) owns the Python worker;
 * everything here talks to it only through callBackend().
 */

import { useEffect } from 'react';
import { clearTranscriptMarkdownContributions, setTranscriptMarkdownContributions } from '@nimbalyst/runtime';
import { startAutoRead } from './autoRead';
import { initBridge } from './bridge';
import { player } from './player';
import { initSettings } from './settings';
import { ReadAloudSettingsPanel } from './SettingsPanel';
import { CONTROL_TAG, ReadAloudControl, rehypeReadAloud, TRANSCRIPT_CSS } from './transcript';

const SOURCE = 'com.local.readaloud';

interface ActivateContext {
  services: {
    ai?: { callBackendTool?: (toolName: string, args?: Record<string, unknown>) => Promise<unknown> };
    configuration?: Parameters<typeof initSettings>[0];
  };
}

export function activate(context: ActivateContext) {
  initSettings(context.services.configuration);
  initBridge(context.services.ai);
}

export function deactivate() {
  player.dispose();
}

/** Mounted by the host for the lifetime of the extension. */
function ReadAloudHost(): null {
  useEffect(() => {
    setTranscriptMarkdownContributions(SOURCE, {
      rehypePlugins: [rehypeReadAloud],
      components: { [CONTROL_TAG]: ReadAloudControl },
      styles: [{ id: 'readaloud', type: 'css-text', cssText: TRANSCRIPT_CSS }],
    });
    const stopAutoRead = startAutoRead();
    return () => {
      clearTranscriptMarkdownContributions(SOURCE);
      stopAutoRead();
      player.stop();
    };
  }, []);
  return null;
}

export const hostComponents = { ReadAloudHost };

export const settingsPanel = { ReadAloudSettingsPanel };
