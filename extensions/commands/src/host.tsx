import { useEffect } from "react";
import { hostInvoke } from "../../shared/host.ts";
import { startBridge, startNoteButtons } from "./composer";
import { startDiffComments } from "./diff-comments";

/** Mounted by the app once, outside any panel (manifest: contributions.hostComponents). Draws nothing. */
export function NoteBridge() {
  useEffect(() => {
    const invoke = hostInvoke;
    const stopButtons = startNoteButtons(invoke);
    const stopBridge = startBridge(invoke);
    const stopComments = startDiffComments(invoke);
    return () => {
      stopButtons();
      stopBridge();
      stopComments();
    };
  }, []);
  return null;
}
