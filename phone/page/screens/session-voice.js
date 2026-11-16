// Voice in the typing box (screens-2 design, "Recording" and "Voice text"; plan row C3). The record button sits
// first in the box's button row. Tap to start, tap "Done, make text" to stop; no finger held down, up to 15
// minutes. The tap also sends voice.warm, so the PC's transcriber loads while the user speaks. After the stop the
// recording goes to the PC as a stream of sealed pieces (ctx.sendStream), voice.transcribe queues it and
// voice.result is asked until the text is back (each ask waits up to 20 s on the PC). The text lands in the field
// at the cursor, unsent, under "From voice · m:ss" with Play and "Record again…". A failure says why and keeps the
// recording for "Try again".
// What a recording is doing lives here, one per session, not in the view: the page ends its channel session after
// an answer is 30 s late and draws the session view again on the new one, and a recording or a job in progress
// carries on into the new view.
import { el, icon } from "../frame/dom.js";

const LIMIT_MS = 15 * 60 * 1000;
const ASK_BEFORE_CANCEL_MS = 10 * 1000;
// A job the PC keeps for 10 minutes after it is done (actions/voice.mjs); the page asks no longer than that.
const RESULT_FOR_MS = 10 * 60 * 1000;
const RETRY_MS = 2000;
const BARS = 40;
const BITS_PER_SECOND = 48000;
// The formats the PC's voice.transcribe takes, in the order the page prefers: Opus is the smallest; iPhones
// before Safari 18.4 record only MP4 with AAC (platform facts, section 8).
const FORMATS = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
// Channel failures that end with the link coming back: voice.result is asked again on the new channel session.
const COMES_BACK = new Set([
  "not-connected",
  "timeout",
  "closed",
  "pc-offline",
]);

const GLYPHS = {
  mic: [
    "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z",
    "M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21",
  ],
  play: ["M8 5.5v13l10.5-6.5z"],
  pause: ["M8.5 5.5v13M15.5 5.5v13"],
  redo: ["M5 12a7 7 0 1 0 2.1-5M5 4.5V8h3.5"],
};

const SAY = {
  timeout: "the PC did not answer in time",
  "not-connected": "no link to the PC right now",
  closed: "the link to the PC closed",
  "pc-offline": "the PC is off or asleep",
  "too-big": "the recording is over 25 MB",
  "stream-broken": "the recording did not arrive whole",
  "no-job": "the PC no longer has this recording's job",
  "unknown-audio": "the PC does not read this phone's sound format",
};

// Why it failed, in words: the PC's own message when it sent one, else the channel's word.
function whyNot(r) {
  const word = r?.err ?? r?.code ?? "no answer";
  // A channel failure's message is only its code; another error's message is the reason.
  const told =
    r instanceof Error ? (r.code ? r.extra?.message : r.message) : r?.message;
  if (r?.run) return `${told ?? word}. On the PC run: ${r.run}`;
  return told ?? SAY[word] ?? `the PC answered "${word}"`;
}

export const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// phase: "idle" | "recording" | "sending" | "turning" | "failed" | "done"
const states = new Map();
function stateFor(key) {
  let s = states.get(key);
  if (!s) {
    s = {
      phase: "idle",
      asking: null, // "cancel" | "again" while a confirm shows
      notice: null, // a line under the row when no recording was made
      warmLine: null, // what voice.warm answered when it failed
      keepOn: false, // no wake lock: the panel asks to keep the screen on
      startedAt: 0,
      ms: 0,
      levels: [],
      blob: null,
      mime: null,
      sent: 0, // 0 to 1 while the pieces go
      error: null,
      text: null,
      landed: null, // { before, after } around the text in the field
      landedIn: null, // the field it landed in
      run: 0, // which attempt is current: a stopped or replaced one drops its answers
      view: null, // the view drawn now: { ctx, field, changed, paint }
      recorder: null,
      stream: null,
      audio: null,
      wake: null,
      ticker: null,
      player: null,
    };
    states.set(key, s);
  }
  return s;
}

// The voice parts of one typing box. `row` gets the record button just after its spacer (first when it has
// none); `chip` goes above the field and `panel` after the row. changed() runs after the field's text changes here.
export function voiceParts(ctx, { key, field, row, changed }) {
  const s = stateFor(key);
  const mic = el(
    "button.mic",
    {
      type: "button",
      "data-action": "voice.record",
      onclick: () => start(s),
    },
    icon(GLYPHS.mic, 22),
  );
  const kids = [...row.childNodes];
  const at = kids.findIndex((k) => k.className === "sp") + 1;
  row.replaceChildren(...kids.slice(0, at), mic, ...kids.slice(at));
  const chip = el("div.voice-chip");
  const panel = el("div.voice-panel");
  const time = el("span.rec-time");
  const bars = el("span.rec-bars");

  function paint() {
    time.replaceChildren(clock(s.ms));
    bars.replaceChildren(
      ...s.levels.map((l) => {
        // The bar's height comes from page.css (.rec-bars i); only its level, 0 to 1, is set here.
        const b = el("i");
        b.style.setProperty("--level", l.toFixed(2));
        return b;
      }),
    );
  }

  function draw() {
    const busy = s.phase === "recording";
    row.hidden = busy;
    field.hidden = busy;
    mic.hidden = !ctx.offered("voice.transcribe");
    // A failed recording waits on "Try again" or "Throw away": a tap on the record button would lose it.
    mic.disabled =
      s.phase === "sending" || s.phase === "turning" || s.phase === "failed";
    mic.setAttribute(
      "aria-label",
      field.value.trim() ? "Record more" : "Record",
    );
    drawChip();
    drawPanel();
  }

  function drawChip() {
    const words = {
      sending: `Sending ${clock(s.ms)} of speech to the PC · ${Math.round(s.sent * 100)}%`,
      turning: `Turning ${clock(s.ms)} of speech into text…`,
    }[s.phase];
    chip.hidden = !(words || s.phase === "failed" || s.phase === "done");
    if (words)
      return chip.replaceChildren(
        el("span.orb.think"),
        el("span.voice-words", words),
      );
    if (s.phase === "failed")
      return chip.replaceChildren(
        el("p.voice-error", `Not turned into text: ${s.error}`),
        el(
          "div.voice-btns",
          el(
            "button.btn.sb",
            { type: "button", onclick: () => play(s) },
            icon(s.player ? GLYPHS.pause : GLYPHS.play, 18),
            s.player ? "Stop" : "Play",
          ),
          el(
            "button.btn.sb",
            {
              type: "button",
              "data-action": "voice.drop",
              onclick: () => drop(s),
            },
            "Throw away",
          ),
          el("span.sp"),
          el(
            "button.btn.sb.main",
            {
              type: "button",
              "data-action": "voice.retry",
              onclick: () => turn(s),
            },
            "Try again",
          ),
        ),
      );
    if (s.phase === "done")
      chip.replaceChildren(
        el("span.voice-from", `From voice · ${clock(s.ms)}`),
        el("span.sp"),
        el(
          "button.btn.sb",
          { type: "button", onclick: () => play(s) },
          icon(s.player ? GLYPHS.pause : GLYPHS.play, 18),
          s.player ? "Stop" : "Play",
        ),
        el(
          "button.btn.sb",
          {
            type: "button",
            "data-action": "voice.again",
            onclick: () => ask(s, "again"),
          },
          icon(GLYPHS.redo, 18),
          "Record again…",
        ),
      );
  }

  function drawPanel() {
    if (s.asking) return panel.replaceChildren(confirmBox());
    if (s.phase !== "recording") {
      panel.hidden = !s.notice;
      return panel.replaceChildren(
        ...(s.notice ? [el("p.dock-line.bad", s.notice)] : []),
      );
    }
    panel.hidden = false;
    paint();
    // replaceChildren writes an empty slot as the text "null": the panel is one element holding them.
    panel.replaceChildren(
      el(
        "div",
        el("div.rec", el("span.rec-dot"), time, bars),
        el(
          "div.btnrow",
          el(
            "button.btn",
            {
              type: "button",
              "data-action": "voice.cancel",
              onclick: () =>
                s.ms > ASK_BEFORE_CANCEL_MS ? ask(s, "cancel") : drop(s),
            },
            "Cancel",
          ),
          el("span.sp"),
          el(
            "button.btn.fill",
            {
              type: "button",
              "data-action": "voice.stop",
              onclick: () => stop(s),
            },
            "Done, make text",
          ),
        ),
        el(
          "p.dock-line",
          "Up to 15 minutes. The text lands in the box for you to edit; nothing is sent until you press Send.",
        ),
        s.keepOn
          ? el("p.dock-line", "Keep the screen on until you stop.")
          : null,
        s.warmLine
          ? el("p.dock-line.bad", `The PC can't make text yet: ${s.warmLine}`)
          : null,
      ),
    );
  }

  function confirmBox() {
    const cancel = s.asking === "cancel";
    return el(
      "div.voice-confirm",
      el(
        "h3",
        cancel
          ? `Throw away ${clock(s.ms)} of recording?`
          : "Replace the text from voice?",
      ),
      el(
        "p",
        cancel
          ? "It is not turned into text and can't be brought back."
          : "The text from this recording leaves the box and a new recording starts.",
      ),
      el(
        "div.btnrow",
        el(
          "button.btn.bad",
          {
            type: "button",
            "data-action": cancel ? "voice.throw" : "voice.replace",
            onclick: () => {
              s.asking = null;
              if (cancel) drop(s);
              else start(s, true);
            },
          },
          cancel ? "Throw away" : "Replace",
        ),
        el("span.sp"),
        el(
          "button.btn.fill",
          {
            type: "button",
            onclick: () => {
              s.asking = null;
              redraw(s);
            },
          },
          cancel ? "Keep recording" : "Keep it",
        ),
      ),
    );
  }

  s.view = { ctx, field, changed, draw, paint };
  draw();
  // The view drawn again (a new channel session): the voice text lands in the new, empty field once the box around
  // these parts is built.
  if (s.phase === "done" && s.landedIn !== field && !field.value)
    queueMicrotask(() => s.view.field === field && land(s));

  return {
    chip,
    panel,
    // After the box's own update: text sent or cleared ends the voice text's chip.
    update() {
      if (s.phase === "done" && s.landedIn === field && !field.value.trim())
        reset(s);
      draw();
    },
  };
}

const redraw = (s) => s.view?.draw();

function ask(s, what) {
  s.asking = what;
  redraw(s);
}

// The recorder's format: the first of FORMATS it makes.
function pickFormat() {
  if (typeof MediaRecorder === "undefined")
    throw new Error("this phone's browser can't record sound here");
  const mime = FORMATS.find((f) => MediaRecorder.isTypeSupported(f));
  if (!mime)
    throw new Error(
      "this phone's recorder makes none of the formats the PC reads",
    );
  return mime;
}

// replace: Record again, whose voice text leaves the field once the microphone is on.
async function start(s, replace = false) {
  if (
    s.phase === "recording" ||
    s.phase === "sending" ||
    s.phase === "turning" ||
    s.phase === "failed"
  )
    return;
  const { ctx } = s.view;
  ctx.haptic("impact");
  s.notice = null;
  s.asking = null;
  let mime;
  let stream;
  try {
    mime = pickFormat();
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("this phone's browser gives no microphone here");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    s.notice = `No recording: ${e.message}`;
    return redraw(s);
  }
  if (replace) takeOut(s);
  // Otherwise an earlier recording's text stays in the field and the new text goes in at the cursor.
  reset(s);
  const run = ++s.run;
  ctx
    .ask("voice.warm")
    .then((r) => {
      if (run === s.run && !r?.ok) s.warmLine = whyNot(r);
    })
    .catch((e) => {
      if (run === s.run) s.warmLine = whyNot(e);
    })
    .finally(() => run === s.run && redraw(s));
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    audioBitsPerSecond: BITS_PER_SECOND,
  });
  const parts = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size) parts.push(e.data);
  });
  recorder.addEventListener("stop", () => {
    if (run !== s.run) return;
    s.blob = new Blob(parts, { type: recorder.mimeType || mime });
    s.mime = s.blob.type;
    if (!s.blob.size) {
      reset(s);
      s.notice = "No recording: the microphone gave no sound";
      return redraw(s);
    }
    turn(s);
  });
  Object.assign(s, {
    phase: "recording",
    recorder,
    stream,
    startedAt: Date.now(),
    ms: 0,
    levels: [],
  });
  recorder.start(1000);
  listen(s, stream);
  keepAwake(s);
  s.ticker = setInterval(() => tick(s), 100);
  redraw(s);
}

// The level bars read the microphone through an analyser; a browser without Web Audio shows no bars.
function listen(s, stream) {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!Context) return;
  const audio = new Context();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 512;
  audio.createMediaStreamSource(stream).connect(analyser);
  s.audio = { audio, analyser, buf: new Uint8Array(analyser.fftSize) };
}

async function keepAwake(s) {
  try {
    if (!navigator.wakeLock) throw new Error("no wake lock");
    s.wake = await navigator.wakeLock.request("screen");
  } catch {
    // The panel says to keep the screen on instead (screens-2 design, open question on Telegram's webview).
    s.keepOn = true;
    redraw(s);
  }
}

function tick(s) {
  s.ms = Date.now() - s.startedAt;
  if (s.audio) {
    const { analyser, buf } = s.audio;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    s.levels.push(Math.min(1, Math.sqrt(sum / buf.length) * 4));
    if (s.levels.length > BARS) s.levels.shift();
  }
  if (s.ms >= LIMIT_MS) return stop(s);
  s.view?.paint();
}

// Lets go of the microphone, the analyser, the wake lock and the clock.
function release(s) {
  clearInterval(s.ticker);
  s.ticker = null;
  for (const t of s.stream?.getTracks() ?? []) t.stop();
  s.stream = null;
  s.audio?.audio.close();
  s.audio = null;
  s.wake?.release();
  s.wake = null;
  s.keepOn = false;
}

function stop(s) {
  if (s.phase !== "recording") return;
  s.view.ctx.haptic("impact");
  s.ms = Date.now() - s.startedAt;
  release(s);
  s.phase = "sending";
  s.sent = 0;
  redraw(s);
  // The recorder's stop event brings the last piece of sound, then turn() sends it all.
  s.recorder.stop();
  s.recorder = null;
}

// Throws the recording away (Cancel, Throw away), or ends the voice text's chip.
function drop(s) {
  if (s.phase === "recording") {
    s.run++;
    s.recorder.stop();
    s.recorder = null;
    release(s);
  }
  reset(s);
  redraw(s);
}

function reset(s) {
  s.run++;
  s.player?.pause();
  if (s.player) URL.revokeObjectURL(s.player.src);
  Object.assign(s, {
    phase: "idle",
    asking: null,
    warmLine: null,
    blob: null,
    mime: null,
    error: null,
    text: null,
    landed: null,
    landedIn: null,
    player: null,
    levels: [],
  });
}

// Sends the kept recording, asks for its text and puts it in the field. Try again runs it once more.
async function turn(s) {
  const run = ++s.run;
  const current = () => run === s.run;
  s.phase = "sending";
  s.sent = 0;
  s.error = null;
  redraw(s);
  let r;
  try {
    const bytes = new Uint8Array(await s.blob.arrayBuffer());
    r = await s.view.ctx.sendStream(bytes, s.mime, (part) => {
      if (!current()) return;
      s.sent = part;
      redraw(s);
    });
    if (r?.ok) {
      if (!current()) return;
      s.phase = "turning";
      redraw(s);
      r = await s.view.ctx.ask("voice.transcribe", { stream: r.d.stream });
    }
    if (r?.ok) r = await result(s, r.d.job, current);
  } catch (e) {
    r = e;
  }
  if (!current()) return;
  if (r?.ok && !r.d.text?.trim()) r = { ok: false, message: "no words heard" };
  if (!r?.ok) {
    s.phase = "failed";
    s.error = whyNot(r);
    return redraw(s);
  }
  s.phase = "done";
  s.text = r.d.text.trim();
  land(s);
}

// Asks voice.result until the job is done; a link that drops and comes back is asked again.
async function result(s, job, current) {
  const until = Date.now() + RESULT_FOR_MS;
  for (;;) {
    let r;
    try {
      r = await s.view.ctx.ask("voice.result", { job });
    } catch (e) {
      if (!COMES_BACK.has(e.code) || Date.now() > until) throw e;
      await new Promise((ok) => setTimeout(ok, RETRY_MS));
      if (!current()) return null;
      continue;
    }
    if (!r?.ok || r.d.done || !current()) return r;
  }
}

// Puts the text in the field at the cursor, unsent, with the cursor after it and the keyboard up.
function land(s) {
  const { field, changed } = s.view;
  const v = field.value;
  const at = field.selectionStart;
  const to = field.selectionEnd;
  const before = v.slice(0, at);
  const after = v.slice(to);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const text = `${lead}${s.text}${trail}`;
  field.value = before + text + after;
  s.landed = { before, after };
  s.landedIn = field;
  const end = before.length + text.length - trail.length;
  field.hidden = false;
  field.focus();
  field.setSelectionRange(end, end);
  changed();
  redraw(s);
}

// Record again: the voice text leaves the field, edits inside it too, when the text around it is unchanged.
function takeOut(s) {
  const { field, changed } = s.view;
  const { before, after } = s.landed ?? {};
  const v = field.value;
  if (
    s.landed &&
    v.length >= before.length + after.length &&
    v.startsWith(before) &&
    v.endsWith(after)
  ) {
    field.value = before + v.slice(v.length - after.length);
    field.setSelectionRange(before.length, before.length);
    changed();
  }
}

function play(s) {
  if (s.player) {
    s.player.pause();
    URL.revokeObjectURL(s.player.src);
    s.player = null;
    return redraw(s);
  }
  const player = new Audio(URL.createObjectURL(s.blob));
  player.addEventListener("ended", () => {
    if (s.player !== player) return;
    URL.revokeObjectURL(player.src);
    s.player = null;
    redraw(s);
  });
  s.player = player;
  player.play().catch((e) => {
    s.player = null;
    s.notice = `Can't play the recording: ${e.message}`;
    redraw(s);
  });
  redraw(s);
}
