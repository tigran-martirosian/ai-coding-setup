// node --experimental-strip-types test/try-it.test.ts
import assert from "node:assert/strict";
import { GIVE_UP_MS } from "../src/note.ts";
import type { PageWatch } from "../src/try-it.ts";
import {
  localPage,
  pageFile,
  pollPages,
  pressTryIt,
  tryItNote,
  WATCH_MS,
  watchPage,
  workspaceOf,
} from "../src/try-it.ts";

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const HOME = "C:/Users/you";
const WS = "C:\\Projects\\app";

// ---- the note the button sends
{
  const note = tryItNote("sess-1");
  for (const part of [
    /Try it pressed/,
    /`verify` skill/,
    /no verify skill/i,
    /leave that server running/i,
    /node ~\/\.claude\/workers\/try-page\.mjs <url> --session sess-1/,
    /link it prints/,
  ])
    assert.match(note, part, `the Try it note must say ${part}`);
  assert.ok(
    note.length < 700,
    `the Try it note must stay short (${note.length} chars)`,
  );
}
ok(
  "the Try it note asks for verify, a kept server and try-page with this session's id",
);

// ---- a press: sent through sendNote (steer, or a queued prompt), then the page is watched
const host = (steerExit: number, steerOut = "Note id: n-7\n") => {
  const calls: unknown[][] = [];
  const invoke = async (channel: string, ...args: unknown[]) => {
    calls.push([channel, ...args]);
    if (channel !== "extension:exec") return undefined;
    const { command } = args[0] as { command: string };
    if (command.includes("homedir"))
      return { success: true, stdout: "C:\\Users\\you\n", exitCode: 0 };
    return steerExit === 0
      ? { success: true, stdout: steerOut, exitCode: 0 }
      : { success: false, stdout: "NOT SENT: idle", exitCode: steerExit };
  };
  return { calls, invoke };
};
{
  const h = host(0);
  const watches = new Map<string, PageWatch>();
  const r = await pressTryIt("sess-1", h.invoke, watches, 1000);
  assert.equal(r.outcome.ok, true, "a delivered Try it note is reported sent");
  assert.equal(r.outcome.noteId, "n-7", "its steer id is kept for the dot");
  assert.equal(r.home, HOME);
  assert.deepEqual(
    h.calls.map((c) => c[0]),
    ["extension:exec", "extensions:write-file", "extension:exec"],
    "a press finds home, then goes the Note way: note file, then steer",
  );
  assert.deepEqual(
    h.calls[1].slice(1),
    [`${HOME}/.claude/steer/button-note-sess-1.txt`, tryItNote("sess-1")],
    "the steer note holds the Try it text and nothing typed in the box",
  );
  assert.match(
    (h.calls[2][1] as { command: string }).command,
    /steer\.mjs" send --to sess-1 - --nowait/,
  );
  assert.deepEqual(
    watches.get("sess-1"),
    { session: "sess-1", home: HOME, since: 1000 },
    "a sent press starts watching that session's page from the press time",
  );

  const idle = host(3);
  const w2 = new Map<string, PageWatch>();
  const r2 = await pressTryIt("sess-2", idle.invoke, w2, 2000);
  assert.equal(r2.outcome.ok, true);
  const queued = idle.calls.find((c) => c[0] === "ai:createQueuedPrompt");
  assert.deepEqual(
    queued?.slice(1),
    ["sess-2", tryItNote("sess-2"), []],
    "an idle session gets the Try it text as a queued prompt",
  );
  assert.ok(w2.has("sess-2"), "a queued press is watched too");

  const bad = host(1);
  const w3 = new Map<string, PageWatch>();
  const r3 = await pressTryIt("sess-3", bad.invoke, w3, 3000);
  assert.equal(r3.outcome.ok, false, "a refused steer is reported not sent");
  assert.equal(w3.size, 0, "a press that was not sent watches nothing");

  const odd = host(0);
  const r4 = await pressTryIt("a b;rm", odd.invoke, w3, 3000);
  assert.equal(r4.outcome.ok, false, "an odd session id is not sent");
  assert.ok(
    !odd.calls.some((c) => c[0] === "extensions:write-file"),
    "an odd session id writes no note file",
  );
  assert.equal(w3.size, 0);
}
ok(
  "a press sends the Try it note like Note does and watches the page only when it was sent",
);

// ---- which urls count as a local page
for (const url of [
  "http://localhost:5173/",
  "https://localhost:8443/app",
  "http://127.0.0.1:3000",
  "http://[::1]:4000/x",
])
  assert.ok(localPage(url), `${url} must count as a local page`);
for (const url of [
  "http://example.com/",
  "http://localhost.evil.com/",
  "http://127.0.0.2:3000/",
  "http://10.0.0.5:3000/",
  "ftp://localhost/",
  "file:///C:/x.html",
  "javascript:alert(1)",
  "not a url",
  42,
  undefined,
])
  assert.equal(
    localPage(url),
    null,
    `${String(url)} must not count as a local page`,
  );
ok("only http(s) on localhost, 127.0.0.1 or [::1] counts as a local page");

// ---- the watcher: a stand-in disk and a counted open call
const disk = () => {
  const files = new Map<string, string>();
  const opened: unknown[] = [];
  let openFails: unknown;
  let readFails: string | undefined;
  let onRead: (() => void) | undefined;
  const invoke = async (channel: string, ...args: unknown[]) => {
    if (channel === "extensions:read-file") {
      onRead?.();
      onRead = undefined;
      if (readFails) throw new Error(readFails);
      const text = files.get(args[0] as string);
      if (text === undefined)
        throw new Error(
          `Error invoking remote method 'extensions:read-file': Error: ENOENT: no such file or directory`,
        );
      return text;
    }
    if (channel === "workspace:open-file") {
      opened.push(args[0]);
      if (openFails instanceof Error) throw openFails;
      return openFails ?? { success: true };
    }
    throw new Error(`unexpected call ${channel}`);
  };
  return {
    files,
    opened,
    invoke,
    write: (session: string, page: object | string) =>
      files.set(
        pageFile(HOME, session),
        typeof page === "string" ? page : JSON.stringify(page),
      ),
    failOpen: (v: unknown) => (openFails = v),
    failRead: (why: string | undefined) => (readFails = why),
    /** Runs `fn` once, while the next read is on its way (as a press between two awaits would). */
    whileReading: (fn: () => void) => (onRead = fn),
  };
};
const page = (url: string, ts: number) => ({
  version: 1,
  url,
  title: "Try it: localhost:5173",
  ts,
});
const quiet = () => {
  const lines: string[] = [];
  return { lines, log: (m: string) => void lines.push(m) };
};

{
  assert.equal(
    pageFile(HOME, "sess-1"),
    `${HOME}/.claude/state/try-it/sess-1.browser.json`,
  );
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);

  assert.deepEqual(await pollPages(w, d.invoke, WS, 2000, q.log), []);
  assert.equal(w.size, 1, "a missing page file is no news: still watching");

  d.write("sess-1", page("http://localhost:5173/", 900));
  assert.deepEqual(await pollPages(w, d.invoke, WS, 3000, q.log), []);
  assert.equal(
    d.opened.length,
    0,
    "a page file older than the press opens nothing",
  );

  d.write("sess-2", page("http://localhost:5173/", 5000));
  assert.deepEqual(await pollPages(w, d.invoke, WS, 5500, q.log), []);
  assert.equal(d.opened.length, 0, "another session's page file opens nothing");

  d.write("sess-1", '{"version":1,"url":"http://local');
  assert.deepEqual(await pollPages(w, d.invoke, WS, 5600, q.log), []);
  assert.equal(w.size, 1, "a half-written page file is no news");

  d.write("sess-1", page("http://localhost:5173/", 6000));
  assert.deepEqual(await pollPages(w, d.invoke, WS, 7000, q.log), [
    { session: "sess-1", kind: "opened", url: "http://localhost:5173/" },
  ]);
  assert.deepEqual(
    d.opened,
    [
      {
        workspacePath: WS,
        filePath: "C:\\Users\\you\\.claude\\state\\try-it\\sess-1.browser.json",
      },
    ],
    "a newer local page file is opened in the press's window, with that window's slashes",
  );
  assert.equal(w.size, 0, "the watch ends once the page opened");
  assert.deepEqual(await pollPages(w, d.invoke, WS, 10_000, q.log), []);
  assert.equal(
    d.opened.length,
    1,
    "a second poll of the same file opens nothing",
  );
  assert.deepEqual(q.lines, [], "nothing worth a log line happened");
}
ok(
  "after a press only a newer page file for that session is opened, and only once",
);

{
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://example.com/", 2000));
  assert.deepEqual(await pollPages(w, d.invoke, WS, 3000, q.log), [
    { session: "sess-1", kind: "refused", url: "http://example.com/" },
  ]);
  assert.equal(d.opened.length, 0, "a page that is not local is never opened");
  assert.equal(q.lines.length, 1, "a refused page is logged");
  assert.deepEqual(
    await pollPages(w, d.invoke, WS, 6000, q.log),
    [],
    "the same refused file is reported once",
  );
  assert.equal(w.size, 1, "after a refused page the watch goes on");
  d.write("sess-1", page("http://127.0.0.1:3000/", 7000));
  assert.deepEqual(await pollPages(w, d.invoke, WS, 8000, q.log), [
    { session: "sess-1", kind: "opened", url: "http://127.0.0.1:3000/" },
  ]);
}
ok("a page file with a url that is not local opens nothing and is said once");

{
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://localhost:5173/", 1000 + WATCH_MS + 10));
  assert.deepEqual(
    await pollPages(w, d.invoke, WS, 1000 + WATCH_MS + 20, q.log),
    [],
  );
  assert.equal(
    w.size,
    0,
    "the watch stops at the give-up time after the press",
  );
  assert.equal(
    d.opened.length,
    0,
    "a page written after the watch ended is not opened",
  );

  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://localhost:5173/", 1500));
  watchPage(w, "sess-1", HOME, 2000);
  assert.deepEqual(await pollPages(w, d.invoke, WS, 2500, q.log), []);
  assert.equal(
    d.opened.length,
    0,
    "a second press restarts the watch: a page from before it opens nothing",
  );
  d.write("sess-1", page("http://localhost:5173/", 2600));
  await pollPages(w, d.invoke, WS, 3000, q.log);
  assert.equal(d.opened.length, 1, "a page after the second press opens");
}
ok("the watch stops at Note's give-up time, and a second press restarts it");

{
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.failRead("EACCES: permission denied");
  assert.deepEqual(await pollPages(w, d.invoke, WS, 2000, q.log), []);
  assert.equal(q.lines.length, 1, "a page file that cannot be read is logged");
  assert.equal(w.size, 1, "an unreadable page file is no news: still watching");
  d.failRead(undefined);

  d.write("sess-1", page("http://localhost:5173/", 3000));
  d.failOpen(new Error("no such channel"));
  const news = await pollPages(w, d.invoke, WS, 4000, q.log);
  assert.equal(news.length, 1);
  assert.equal(news[0].kind, "failed", "a failed open is reported");
  assert.match(String(news[0].why), /no such channel/);
  assert.equal(q.lines.length, 2, "a failed open is logged");

  watchPage(w, "sess-1", HOME, 4500);
  d.write("sess-1", page("http://localhost:5173/", 5000));
  d.failOpen({ success: false, error: "workspace not open" });
  const refused = await pollPages(w, d.invoke, WS, 6000, q.log);
  assert.equal(
    refused[0]?.kind,
    "failed",
    "an open the app refuses is reported",
  );
  assert.match(String(refused[0]?.why), /workspace not open/);

  watchPage(w, "sess-1", HOME, 6500);
  d.write("sess-1", page("http://localhost:5173/", 7000));
  d.failOpen(undefined);
  const noWindow = await pollPages(w, d.invoke, undefined, 8000, q.log);
  assert.equal(
    noWindow[0]?.kind,
    "failed",
    "with no open project in the window the open is reported failed",
  );
  assert.equal(d.opened.length, 2, "no open is tried without a workspace path");
}
ok(
  "a page file that cannot be read, or an open that fails, is logged and reported",
);

{
  assert.equal(
    WATCH_MS,
    GIVE_UP_MS,
    "the watch lasts as long as Note waits: a press queued behind a long reply starts late",
  );
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://localhost:5173/", 1000 + 40 * 60_000));
  const late = await pollPages(w, d.invoke, WS, 1000 + 41 * 60_000, q.log);
  assert.equal(
    late[0]?.kind,
    "opened",
    "a page written 40 minutes after the press still opens",
  );
}
ok("a page written long after the press, within Note's give-up time, opens");

{
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://localhost:5173/", 2000));
  d.failOpen(new Error("tab did not open"));
  assert.equal(
    (await pollPages(w, d.invoke, WS, 3000, q.log))[0]?.kind,
    "failed",
  );
  assert.equal(w.size, 1, "a failed open keeps the watch");
  assert.deepEqual(
    await pollPages(w, d.invoke, WS, 4000, q.log),
    [],
    "the file whose open failed is not tried again",
  );
  d.failOpen(undefined);
  d.write("sess-1", page("http://localhost:5173/", 5000));
  assert.equal(
    (await pollPages(w, d.invoke, WS, 6000, q.log))[0]?.kind,
    "opened",
    "after a failed open a newer page file still opens",
  );
  assert.equal(w.size, 0, "only a successful open ends the watch");
}
ok("a failed open keeps watching, so a newer page file can still open");

{
  const d = disk();
  const q = quiet();
  const w = new Map<string, PageWatch>();
  watchPage(w, "sess-1", HOME, 1000);
  d.write("sess-1", page("http://localhost:5173/", 2000));
  d.whileReading(() => watchPage(w, "sess-1", HOME, 2500));
  assert.deepEqual(
    await pollPages(w, d.invoke, WS, 3000, q.log),
    [],
    "a page from before a press made during the poll opens nothing",
  );
  assert.equal(
    w.get("sess-1")?.since,
    2500,
    "a second press during a poll keeps its new watch",
  );

  const x = new Map<string, PageWatch>();
  watchPage(x, "sess-a", HOME, 1000 + WATCH_MS);
  watchPage(x, "sess-b", HOME, 1000);
  d.whileReading(() => watchPage(x, "sess-b", HOME, 1000 + WATCH_MS));
  await pollPages(x, d.invoke, WS, 1000 + WATCH_MS + 5, q.log);
  assert.equal(
    x.get("sess-b")?.since,
    1000 + WATCH_MS,
    "an old watch that runs out does not end the new press's watch",
  );
}
ok("a second press while a poll waits keeps its own watch");

assert.equal(workspaceOf({ workspacePath: "C:/a" }), "C:/a");
assert.equal(workspaceOf({ __workspacePath: "C:/b" }), "C:/b");
assert.equal(
  workspaceOf({ workspacePath: "C:/a", __workspacePath: "C:/b" }),
  "C:/a",
);
assert.equal(workspaceOf({}), undefined);
ok("the window's project comes from workspacePath or __workspacePath");
