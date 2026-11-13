// The calls into Nimbalyst that the TypeScript extensions make through window.electronAPI, typed once.
// Channels: extension:exec, extensions:read-file, extensions:write-file, extensions:ai-send-prompt,
// ai:createQueuedPrompt, sessions:update-metadata.

export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

/** The app's invoke. Reads `window` only when called, so a plain-node test can import this file. */
export const hostInvoke: Invoke = (channel, ...args) =>
  (window as unknown as { electronAPI: { invoke: Invoke } }).electronAPI.invoke(
    channel,
    ...args,
  );

/** Every extension that starts a session uses Sonnet, whatever model was picked last in the app. */
export const MODEL = "claude-code:sonnet";

/** A failed invoke's message without the "Error invoking remote method" wrapper Electron adds. */
export const hostError = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(
    /^Error invoking remote method '[^']*': (Error: )?/,
    "",
  );

/** Runs a shell command for the extension `extensionId`. */
export const hostExec = <R = unknown>(
  invoke: Invoke,
  extensionId: string,
  command: string,
  timeout?: number,
) => invoke("extension:exec", { extensionId, command, timeout }) as Promise<R>;

/** The text of a file the extension may read. */
export const readHostFile = async (invoke: Invoke, file: string) =>
  String(await invoke("extensions:read-file", file));

// A refusal (no project open, provider off) comes back at once; the reply itself takes minutes.
export const REFUSAL_MS = 2000;

/** Starts a new session with `prompt`. Returns '' once it is running, or the reason the app refused. */
export function startSession(
  invoke: Invoke,
  prompt: string,
  sessionName: string,
  wait = REFUSAL_MS,
  describe: (e: unknown) => string = hostError,
): Promise<string> {
  const sent = invoke("extensions:ai-send-prompt", {
    prompt,
    sessionName,
    model: MODEL,
  });
  return Promise.race([
    sent.then(
      () => "",
      (e) => describe(e),
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve(""), wait)),
  ]);
}
