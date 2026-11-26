// Run: node test.mjs   (Node 22.6+ strips the types)
// Runs the cleanText and TTS folder safety tests, then the speed-format and voice-name tests, then the player box
// tests (transcript.tsx and the real player, bundled with esbuild so the .tsx and its imports load in Node), then the
// Kokoro worker's start and stop with a fake child process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const file of ["test/cleanText.test.ts", "test/folderSafety.test.ts"]) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", file],
    { stdio: "inherit", cwd: here },
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const { formatSpeed, t } = await import("./src/strings.ts");
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

check("speed uses the multiplication sign", () => {
  assert.equal(formatSpeed(1.2), "1.2×");
  assert.equal(formatSpeed(0.5), "0.5×");
});
check("whole speeds have no decimals", () => {
  assert.equal(formatSpeed(1), "1×");
  assert.equal(formatSpeed(2), "2×");
});
check("speed keeps two decimals at most", () => {
  assert.equal(formatSpeed(1.25), "1.25×");
  assert.equal(formatSpeed(0.7500000001), "0.75×");
  assert.equal(formatSpeed(1.1 + 0.1), "1.2×");
});
check("every voice has a human name", () => {
  for (const id of [
    "af_sky",
    "af_heart",
    "af_bella",
    "af_nicole",
    "af_sarah",
    "af_river",
    "af_nova",
    "af_jessica",
    "af_aoede",
  ]) {
    assert.ok(t.voiceNames[id] && !t.voiceNames[id].includes("_"), id);
  }
});

// ---- Player box --------------------------------------------------------------------------------

/** Bundles the given exports for Node: CSS `?inline` imports as text, the orb mount (it needs a window) as empty. */
async function bundle(contents) {
  const out = path.join(os.tmpdir(), `readaloud-test-${process.pid}.mjs`);
  await build({
    stdin: { contents, resolveDir: here, loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    outfile: out,
    logLevel: "error",
    plugins: [
      {
        name: "browser-only",
        setup(b) {
          b.onResolve({ filter: /\?inline$/ }, (a) => ({
            path: path.resolve(a.resolveDir, a.path.replace(/\?inline$/, "")),
            namespace: "css-text",
          }));
          b.onLoad({ filter: /.*/, namespace: "css-text" }, (a) => ({
            contents: fs.readFileSync(a.path, "utf8"),
            loader: "text",
          }));
          b.onResolve({ filter: /orbs\.js$/ }, () => ({
            path: "orbs",
            namespace: "empty",
          }));
          b.onLoad({ filter: /.*/, namespace: "empty" }, () => ({
            contents: "",
          }));
        },
      },
    ],
  });
  try {
    return await import(pathToFileURL(out).href);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

const box = await bundle(
  `export * from "./src/transcript.tsx";
   export { player } from "./src/player.ts";
   export { initBridge } from "./src/bridge.ts";
   export { dockView } from "./src/dock.ts";
   export { KokoroWorker } from "./src/backend.ts";`,
);
const { player } = box;

// A stand-in for Web Audio: a source plays until it is stopped
let source = null;
class FakeAudioContext {
  state = "running";
  destination = {};
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {}
  async decodeAudioData() {
    return {};
  }
  createBufferSource() {
    source = {
      stopped: false,
      connect() {},
      start() {},
      stop() {
        this.stopped = true;
        this.onended?.();
      },
    };
    return source;
  }
}
globalThis.AudioContext = FakeAudioContext;
const backendCalls = [];
box.initBridge({
  callBackendTool: async (tool) => {
    backendCalls.push(tool);
    return tool === "readaloud.synthesize"
      ? { audio: btoa("RIFF"), duration: 1 }
      : {};
  },
});

// Two parts: the first part is cut at 100 characters so audio starts fast
const REPLY =
  "The first sentence is long enough to fill the short opening part on its own, more or less. " +
  "The second sentence goes into the next part. And a third one follows it.";
const ticks = async (until, what = "the player never got there") => {
  for (let i = 0; i < 100 && !until(); i++)
    await new Promise((r) => setTimeout(r, 0));
  assert.ok(until(), what);
};
const atRest = () => {
  const s = player.get();
  assert.equal(s.status, "idle");
  assert.equal(s.key, null);
  assert.equal(s.chunk, 0);
  assert.equal(s.total, 0);
  assert.equal(s.error, null);
  assert.equal(box.boxView(s, "k1", true), null, "the block is back at rest");
};

await check("preparing shows the box, the orb only after its delay", () => {
  player.play("k1", REPLY);
  const s = player.get();
  assert.equal(s.status, "synthesizing");
  assert.equal(s.total, 2);
  const early = box.boxView(s, "k1", false);
  assert.deepEqual(early, {
    state: "preparing",
    word: "Preparing",
    detail: "part 1 of 2",
    mark: "none",
  });
  assert.equal(box.boxView(s, "k1", true).mark, "orb");
  assert.equal(box.ORB_DELAY_MS, 300);
  assert.equal(box.boxView(s, "another block", true), null);
});

await check("playing and paused name their state in words", async () => {
  await ticks(() => player.get().status === "playing");
  assert.deepEqual(box.boxView(player.get(), "k1", false), {
    state: "playing",
    word: "Playing",
    detail: "part 1 of 2",
    mark: "dot",
  });
  player.pause();
  assert.deepEqual(box.boxView(player.get(), "k1", false), {
    state: "paused",
    word: "Paused",
    detail: "at part 1 of 2",
    mark: "dot",
  });
  player.resume();
});

await check("Close stops, clears and returns to rest", async () => {
  await ticks(() => player.get().status === "playing");
  const playing = source;
  backendCalls.length = 0;
  box.closePlayer();
  atRest();
  assert.ok(playing.stopped, "the audio was stopped");
  assert.ok(
    backendCalls.includes("readaloud.stop"),
    "the backend was told to stop",
  );
  // the part synthesized ahead must not bring the box back
  await new Promise((r) => setTimeout(r, 20));
  atRest();
});

await check("Close also clears an error, back to rest", () => {
  player.play("k1", "   ");
  assert.equal(player.get().error?.message, t.nothingToRead);
  box.closePlayer();
  atRest();
});

await check(
  "Esc inside the box closes it and keeps the key from the app",
  async () => {
    const seen = [];
    const key = (k) => ({
      key: k,
      preventDefault: () => seen.push("prevent"),
      stopPropagation: () => seen.push("stop"),
    });
    let closed = 0;
    assert.equal(
      box.boxKeyDown(key("Enter"), () => closed++),
      false,
    );
    assert.deepEqual([closed, seen], [0, []]);
    player.play("k1", REPLY);
    await ticks(() => player.get().status === "playing");
    assert.equal(box.boxKeyDown(key("Escape")), true);
    assert.deepEqual(seen, ["prevent", "stop"]);
    atRest();
  },
);

await check(
  "the dock shows only while the strip is off screen, and closes with it",
  async () => {
    assert.equal(
      box.dockView(player.get(), false, false),
      null,
      "nothing is read: no dock",
    );
    player.play("k1", REPLY);
    await ticks(() => player.get().status === "playing");
    assert.equal(
      box.dockView(player.get(), true, false),
      null,
      "strip on screen: no dock",
    );
    assert.deepEqual(box.dockView(player.get(), false, false), {
      state: "playing",
      word: "Playing",
      detail: "part 1 of 2",
      mark: "dot",
    });
    player.pause();
    assert.equal(box.dockView(player.get(), false, false).word, "Paused");
    assert.equal(box.dockView(player.get(), true, false), null);
    // Close (from the box or the dock: both call closePlayer) hides both
    box.closePlayer();
    atRest();
    assert.equal(
      box.dockView(player.get(), false, true),
      null,
      "closed: no dock",
    );
  },
);

await check("no Stop button is left; Close says what it does", () => {
  const src = fs.readFileSync(path.join(here, "src/transcript.tsx"), "utf8");
  assert.doesNotMatch(src, /name="stop"|t\.stop\b/);
  assert.equal("stop" in t, false);
  assert.equal(t.close, "Close");
  assert.equal(t.closeTip, "Stop and close (Esc)");
});

await check("every transcript button carries a word", () => {
  const src = fs.readFileSync(path.join(here, "src/transcript.tsx"), "utf8");
  // the icon is drawn only inside WordButton, which always renders the word beside it
  assert.equal(src.match(/<Icon /g)?.length, 1);
  assert.match(
    src,
    /<Icon name=\{icon\} \/>\s*<span className="readaloud-word">\{word\}<\/span>/,
  );
  assert.equal(
    src.match(/<button\b/g)?.length,
    2,
    "WordButton and the worded Dismiss",
  );
  assert.match(src, /\{t\.dismiss\}\s*<\/button>/);
});

await check("styles are on the new type scale", () => {
  const css = fs.readFileSync(path.join(here, "src/panel.css"), "utf8");
  assert.doesNotMatch(css, /--x-micro|--x-caption/);
  for (const [, px] of css.matchAll(/font-size:\s*(\d+)px/g))
    assert.ok(Number(px) >= 12, `font-size ${px}px`);
});

// ---- One control, at the end of the last finished turn, reading the whole turn ---------------

const U = { kind: "user" };
const W = { kind: "waiting" };
const C = (key) => ({ kind: "control", key });

await check("only the last finished turn gets the control", () => {
  // two turns: only the second one's last block
  assert.equal(box.lastTurnEnd([U, C("a"), C("b"), U, C("c"), C("d")]), 5);
  // the turn still runs: no control anywhere
  assert.equal(box.lastTurnEnd([U, C("a"), U, C("c"), W]), -1);
  // a new message was sent and nothing answered it yet: no control
  assert.equal(box.lastTurnEnd([U, C("a"), U]), -1);
  assert.equal(box.lastTurnEnd([]), -1);
});

// ---- A long turn in the chat's virtual list: rows far from view leave the page ----------------

/** The control key the real rehype plugin gives this Markdown (it also keeps the text). */
const keyOf = (md) => {
  const tree = { type: "root", children: [{ type: "text", value: md }] };
  box.rehypeReadAloud()(tree, { value: md });
  return tree.children.at(-1).properties.dataKey;
};

/**
 * A stand-in for one session's chat, a virtual list: `show(...rows)` puts only those rows on the page (the
 * chat drops the rest), `update(row, md)` re-renders a streaming block in the same row with its new text.
 */
function fakeChat(id, scrollTop = 800) {
  const session = {
    getAttribute: (a) => (a === "data-session-id" ? id : null),
  };
  const list = { scrollTop };
  const element = (classes, extra) => {
    const attrs = new Set();
    return {
      classList: { contains: (c) => classes.includes(c) },
      dataset: {},
      textContent: "",
      parentElement: null,
      hasAttribute: (n) => attrs.has(n),
      toggleAttribute: (n, on) => (on ? attrs.add(n) : attrs.delete(n)),
      closest: (sel) =>
        sel === "[data-session-id]"
          ? session
          : sel === ".rich-transcript-vlist"
            ? list
            : null,
      ...extra,
    };
  };
  const chat = {
    list,
    user: (text) => ({
      el: element(["rich-transcript-message", "user"], { textContent: text }),
    }),
    /** A text block; `key` skips the plugin, as if the kept text was dropped. */
    block(md, key = keyOf(md)) {
      const row = {};
      return {
        row,
        key,
        el: element(["readaloud-control"], {
          dataset: { readaloudKey: key },
          parentElement: row,
        }),
      };
    },
    update(block, md) {
      const next = chat.block(md);
      next.el.parentElement = block.row;
      block.key = next.key;
      block.el = next.el;
    },
    show(...rows) {
      globalThis.document = { querySelectorAll: () => rows.map((r) => r.el) };
      box.markTurnEnds();
    },
  };
  return chat;
}

/** Presses Read aloud on `block`; returns the text the player was asked to read, or null. */
function press(block) {
  const play = player.play;
  let read = null;
  player.play = (_key, text) => {
    read = text;
  };
  try {
    box.readTurn(block.el, block.key);
  } finally {
    player.play = play;
  }
  return read;
}

await check("Read aloud reads every text block of the turn, in order", () => {
  const chat = fakeChat("s-order");
  const rows = [
    chat.user("First question."),
    chat.block("Old turn."),
    chat.user("Second question."),
    chat.block("First part."),
    chat.block("<!-- voice: only a hidden summary -->"),
    chat.block("Last part."),
  ];
  chat.show(...rows);
  assert.equal(
    press(rows[5]),
    "First part.\n\nLast part.",
    "Read aloud mixed in another turn, a blank block or the wrong order",
  );
  delete globalThis.document;
});

await check(
  "Read aloud reads the whole turn after its first rows left the page",
  () => {
    const chat = fakeChat("s-long");
    const u = chat.user("Explain the change.");
    const a = chat.block("First, the cause.");
    const b = chat.block("Then, the fix.");
    const c = chat.block("Last, the");
    chat.show(u, a, b);
    chat.show(b, c);
    chat.update(c, "Last, the test.");
    chat.show(c);
    assert.equal(
      press(c),
      "First, the cause.\n\nThen, the fix.\n\nLast, the test.",
      "Read aloud read only the rows still on the page, not the whole turn",
    );
    delete globalThis.document;
  },
);

await check(
  "a long streamed reply does not push an earlier block of the turn out",
  () => {
    const chat = fakeChat("s-stream");
    const u = chat.user("Write it out.");
    const a = chat.block("The opening block.");
    const b = chat.block("The");
    chat.show(u, a, b);
    // every streaming update of b keeps another copy of its text: more than the 500 kept
    let md = "The";
    for (let i = 0; i < 600; i++) {
      md += ` word${i}`;
      chat.update(b, md);
      chat.show(u, a, b);
    }
    assert.equal(
      press(b),
      `The opening block.\n\n${md}`,
      "streaming a long block dropped an earlier block, so Read aloud read nothing",
    );
    delete globalThis.document;
  },
);

await check(
  "when the turn's text is missing, Read aloud says so instead of doing nothing",
  () => {
    // the start of the turn never came on the page
    const late = fakeChat("s-late");
    const x = late.block("Only the end of a long reply.");
    late.show(x);
    assert.equal(press(x), null, "a turn without its start was read in part");
    assert.equal(
      player.get().error?.key,
      x.key,
      "no message for a turn without its start",
    );
    assert.ok(player.get().error.message, "the message is empty");
    box.closePlayer();
    // a block's text is no longer kept
    const lost = fakeChat("s-lost");
    const u = lost.user("Hello.");
    const y = lost.block("", "never-kept");
    lost.show(u, y);
    assert.equal(press(y), null);
    assert.equal(
      player.get().error?.key,
      y.key,
      "no message for a block whose text is gone",
    );
    assert.ok(player.get().error.message, "the message is empty");
    box.closePlayer();
    // a chat seen from its very top has its whole first turn, even with no user message
    const top = fakeChat("s-top", 0);
    const z = top.block("A reply with no message before it.");
    top.show(z);
    assert.equal(press(z), "A reply with no message before it.");
    assert.equal(player.get().error, null);
    delete globalThis.document;
  },
);

await check("hands-free and /voice are gone", () => {
  assert.equal(fs.existsSync(path.join(here, "src/autoRead.ts")), false);
  assert.equal(fs.existsSync(path.join(here, "claude-plugin")), false);
  const manifest = fs.readFileSync(path.join(here, "manifest.json"), "utf8");
  assert.doesNotMatch(manifest, /autoRead|claudePlugin/);
  for (const k of Object.keys(t)) assert.doesNotMatch(k, /^auto|handsFree/);
});

// ---- The Kokoro worker: an old worker never touches the one that replaced it ------------------

/** A stand-in for the Python worker: `say` prints one line of its protocol, `sent` holds the requests it got. */
function fakeChild(pid) {
  const c = new EventEmitter();
  c.pid = pid;
  c.stdin = new PassThrough();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.sent = [];
  c.stdin.on("data", (d) => {
    for (const line of d.toString().split("\n").filter(Boolean))
      c.sent.push(JSON.parse(line));
  });
  c.say = (msg) => c.stdout.write(`${JSON.stringify(msg)}\n`);
  c.kill = () => c.emit("exit", null, "SIGTERM");
  return c;
}
/** The promise's value, or a failure naming `what` when it does not settle soon. */
const within = (p, what) => {
  let timer;
  return Promise.race([
    p,
    new Promise((_, no) => {
      timer = setTimeout(() => no(new Error(what)), 300);
    }),
  ]).finally(() => clearTimeout(timer));
};

await check(
  "Stop while Kokoro loads: the next read starts a new worker that the old one cannot break",
  async () => {
    const children = [];
    const worker = new box.KokoroWorker(() => {}, {
      check: async () => {},
      spawn: () => {
        const c = fakeChild(100 + children.length);
        children.push(c);
        return c;
      },
    });
    const first = worker.ensure("C:\\TTS");
    first.catch(() => {});
    await ticks(() => children.length === 1, "the first worker never started");
    const [old] = children;
    worker.kill("stopped by user");
    await assert.rejects(
      within(first, "Stop during loading left the start waiting"),
      /stopped by user/,
    );

    const second = worker.ensure("C:\\TTS");
    await ticks(
      () => children.length === 2,
      "a read after Stop during loading started no new worker",
    );
    const now = children[1];
    // the stopped worker finishes loading inside its grace period
    old.say({ event: "ready", load_ms: 5 });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(
      worker.state,
      "starting",
      "the stopped worker's ready marked the new one ready",
    );
    now.say({ event: "ready", load_ms: 7 });
    await within(second, "the new worker's ready did not end its start");
    assert.equal(worker.status("C:\\TTS").pid, 101);

    const job = worker.synthesize({ text: "Hello." });
    await ticks(
      () => now.sent.length === 1,
      "the job never reached the new worker",
    );
    old.emit("exit", 0, null);
    assert.equal(
      worker.state,
      "ready",
      "the stopped worker's exit reset the new one",
    );
    now.say({
      id: now.sent[0].id,
      ok: true,
      wav_b64: "UklGRg==",
      duration: 1,
    });
    const reply = await within(
      job,
      "the stopped worker's exit failed the new worker's job",
    );
    assert.equal(reply.ok, true);
    worker.kill("done");
    now.emit("exit", 0, null);
  },
);

await check("Stop during the folder check starts no worker", async () => {
  let spawned = 0;
  const worker = new box.KokoroWorker(() => {}, {
    check: async () => {},
    spawn: () => fakeChild(200 + spawned++),
  });
  const start = worker.ensure("C:\\TTS");
  worker.kill("stopped by user");
  await assert.rejects(
    within(start, "Stop during the folder check left the start waiting"),
    /stopped by user/,
  );
  assert.equal(spawned, 0, "a worker started after Stop");
  assert.equal(worker.state, "stopped");
});

console.log(
  `\n${passed} passed (speed, voice names, player box, last turn, Kokoro worker)`,
);
