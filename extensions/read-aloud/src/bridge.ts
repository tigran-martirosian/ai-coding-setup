/**
 * The only path from the UI to the backend: the host's callBackendTool bridge,
 * limited to this extension's own `readaloud.*` tools.
 */

type CallBackendTool = (toolName: string, args?: Record<string, unknown>) => Promise<unknown>;

let callTool: CallBackendTool | undefined;

export function initBridge(ai: { callBackendTool?: CallBackendTool } | undefined) {
  callTool = ai?.callBackendTool?.bind(ai);
}

export type BackendTool = 'synthesize' | 'stop' | 'status' | 'warmup' | 'shutdown_worker' | 'set_auto_read';

export async function callBackend<T>(tool: BackendTool, args: Record<string, unknown> = {}): Promise<T> {
  if (!callTool) throw new Error('Read Aloud could not reach the Nimbalyst host. Reload the extension.');
  try {
    return (await callTool(`readaloud.${tool}`, args)) as T;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/not available to this extension|Unknown tool|not running|No workspace path/i.test(raw)) {
    return 'The Read Aloud backend is not running. Allow it in Settings > Extensions > Read Aloud, then try again.';
  }
  // Host wraps backend errors as "Backend tool error ... Error: <message>".
  const inner = raw.split(/\bError: /).pop() ?? raw;
  return inner.replace(/^Error invoking remote method '[^']+':\s*/, '').trim().slice(0, 400);
}
