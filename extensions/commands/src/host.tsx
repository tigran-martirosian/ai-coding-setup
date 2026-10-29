import { useEffect } from 'react';
import { bridge, startBridge, startNoteButtons } from './composer';

/** Mounted by the app once, outside any panel (manifest: contributions.hostComponents). Draws nothing. */
export function NoteBridge() {
  useEffect(() => {
    const invoke = bridge();
    const stopButtons = startNoteButtons(invoke);
    const stopBridge = startBridge(invoke);
    return () => {
      stopButtons();
      stopBridge();
    };
  }, []);
  return null;
}
