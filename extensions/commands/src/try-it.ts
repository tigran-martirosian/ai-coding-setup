// The Try it button: a press sends the session a note (through sendNote, as Note does) asking it to run the
// project's verify skill and, when the change has a local page, to run try-page.mjs. That worker writes
// <home>/.claude/state/try-it/<session>.browser.json, {"version":1,"url","title","ts"}; after a press this
// watches that file and opens it once with workspace:open-file, which shows the page in a browser tab
// beside the chat. The file is opened only when it is newer than the press and its url is a local page.

import type { Invoke } from "../../shared/host.ts";
import { hostError } from "../../shared/host.ts";
import { readOrNull } from "./bridge.ts";
import type { Outcome } from "./note.ts";
import { GIVE_UP_MS, homeDir, sendNote } from "./note.ts";

// As long as Note waits for its note: a press queued behind a long reply starts late
export const WATCH_MS = GIVE_UP_MS;
export const PAGE_POLL_MS = 3000;
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const TAG = "[commandbuttons]";
// the note file's own tag, apart from the Note button's: a Note pressed just before steer reads would send this text
export const TRY_IT_TAG = "try-it-note";

/** What the session is asked to do; read by the agent, so it is the same in every language. */
export const tryItNote = (sessionId: string) =>
  [
    "Try it pressed: run this project's `verify` skill on your last change and report as it says (no verify skill: try the change the way a person would).",
    "If the change has a web page (a dev server you or verify started, or one already running for this project), leave that server running this time, even where verify says to stop it,",
    `and run \`node ~/.claude/workers/try-page.mjs <url> --session ${sessionId}\` so the page opens beside this chat. Then give the link it prints.`,
  ].join(" ");

export const pageFile = (home: string, session: string) =>
  `${home}/.claude/state/try-it/${session}.browser.json`;

/** The url when it is an http(s) page on this PC (localhost, 127.0.0.1 or [::1]), else null. */
export function localPage(url: unknown): string | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  return /^https?:$/.test(u.protocol) && LOCAL_HOSTS.includes(u.hostname)
    ? url
    : null;
}

/** A press being watched for its page file; `since` is the press time, `seen` the last file judged. */
export interface PageWatch {
  session: string;
  home: string;
  since: number;
  seen?: number;
}
export interface PageNews {
  session: string;
  kind: "opened" | "refused" | "failed";
  url: string;
  why?: string;
}

/** Starts watching a session's page file, or starts again from a later press. */
export function watchPage(
  watches: Map<string, PageWatch>,
  session: string,
  home: string,
  now: number,
) {
  watches.set(session, { session, home, since: now });
}

/** A press: sends the Try it note the way Note sends a note and, when it went out, watches the page file. */
export async function pressTryIt(
  sessionId: string,
  invoke: Invoke,
  watches: Map<string, PageWatch>,
  now = Date.now(),
): Promise<{ outcome: Outcome; home: string }> {
  const home = await homeDir(invoke);
  const outcome = await sendNote(
    tryItNote(sessionId),
    sessionId,
    home,
    invoke,
    [],
    TRY_IT_TAG,
  );
  if (outcome.ok) watchPage(watches, sessionId, home, now);
  return { outcome, home };
}

/**
 * One poll of every watch. A missing, half-written or older file is no news; a file that cannot be read
 * is logged and is no news too. A newer local page is opened once and a successful open ends its watch; a
 * failed open, or a newer page that is not local, is reported once and the watch goes on. A watch ends
 * WATCH_MS after its press.
 */
export async function pollPages(
  watches: Map<string, PageWatch>,
  invoke: Invoke,
  workspacePath: string | undefined,
  now = Date.now(),
  log: (m: string) => void = console.warn,
): Promise<PageNews[]> {
  const news: PageNews[] = [];
  // A press while this poll waits puts a new watch in the map: that one is judged at the next poll and
  // never ended by the old one
  const current = (w: PageWatch) => watches.get(w.session) === w;
  const end = (w: PageWatch) => current(w) && watches.delete(w.session);
  for (const w of [...watches.values()]) {
    if (now - w.since > WATCH_MS) {
      end(w);
      continue;
    }
    const file = pageFile(w.home, w.session);
    let text: string | null;
    try {
      text = await readOrNull(invoke, file);
    } catch (e) {
      log(`${TAG} Try it page file ${file}: ${hostError(e)}`);
      continue;
    }
    if (text === null || !current(w)) continue;
    let page: { url?: unknown; ts?: unknown };
    try {
      page = JSON.parse(text);
    } catch {
      continue; // half-written: the next poll sees it whole
    }
    const ts = page?.ts;
    if (typeof ts !== "number" || ts <= w.since || ts === w.seen) continue;
    w.seen = ts;
    const url = localPage(page.url);
    if (!url) {
      log(
        `${TAG} Try it: not opened, ${file} names a page that is not on this PC: ${String(page.url)}`,
      );
      news.push({ session: w.session, kind: "refused", url: String(page.url) });
      continue;
    }
    const done = await openPage(
      w.session,
      url,
      file,
      invoke,
      workspacePath,
      log,
    );
    if (done.kind === "opened") end(w);
    news.push(done);
  }
  return news;
}

async function openPage(
  session: string,
  url: string,
  file: string,
  invoke: Invoke,
  workspacePath: string | undefined,
  log: (m: string) => void,
): Promise<PageNews> {
  const failed = (why: string): PageNews => {
    log(`${TAG} Try it: could not open ${file}: ${why}`);
    return { session, kind: "failed", url, why };
  };
  if (!workspacePath) return failed("this window has no open project");
  // the window's own slashes, as job-tracker opens its files
  const filePath = workspacePath.includes("\\")
    ? file.replace(/\//g, "\\")
    : file;
  try {
    const r = (await invoke("workspace:open-file", {
      workspacePath,
      filePath,
    })) as { success?: boolean; error?: unknown } | undefined;
    if (r && r.success === false)
      return failed(String(r.error ?? "the app said no"));
  } catch (e) {
    return failed(hostError(e));
  }
  return { session, kind: "opened", url };
}

/** The window's open project, read the way index.tsx's openProject reads it. */
export const workspaceOf = (win: {
  workspacePath?: string;
  __workspacePath?: string;
}) => win.workspacePath ?? win.__workspacePath;
