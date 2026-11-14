// Run: node test.mjs   (Node 22.6+ strips the types)
// Runs the cleanText tests, then the speed-format and voice-name tests, then the player box tests
// (transcript.tsx and the real player, bundled with esbuild so the .tsx and its imports load in Node).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

const clean = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--no-warnings", "test/cleanText.test.ts"],
  {
    stdio: "inherit",
  },
);
if (clean.status !== 0) process.exit(clean.status ?? 1);

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
   export { dockView } from "./src/dock.ts";`,
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
const ticks = async (until) => {
  for (let i = 0; i < 100 && !until(); i++)
    await new Promise((r) => setTimeout(r, 0));
  assert.ok(until(), "the player never got there");
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

console.log(`\n${passed} passed (speed, voice names, player box)`);
