# Read Aloud (Nimbalyst extension)

Reads agent replies aloud with Kokoro TTS running on this computer. No cloud, no API keys, no per-use cost.

## Use

- **Read aloud:** one button in the whole chat, under the last reply once the agent has finished. It reads that whole turn, every text block since your last message. While it plays you get Pause/Resume, Next (next part), a speed slider and Close (or Esc). Checked in-app with `node scripts/cdp.mjs --file test/ui-controls.js`.
- **Settings:** Settings > Extensions > Read Aloud (voice, speed, skip code, skip terminal output and diffs, TTS folder, voice engine, test button). The "Enable Read Aloud" switch on that page turns Read Aloud off.

## How it works

```
transcript (renderer)                     backend module (utility process)        Python
rehype plugin + <readaloud-control>  -->  readaloud.synthesize / stop / status -->  tts_worker.py
player.ts (Web Audio, in memory)     <--  base64 WAV per chunk                <--  Kokoro, loaded once
```

- Renderer calls the backend only through the host's `callBackendTool` bridge, and only this extension's own tools:
  `synthesize`, `stop`, `status`, `warmup`, `shutdown_worker`, all panel-only (none is visible to the agent).
- The backend starts `<TTS folder>\venv\Scripts\python.exe dist\worker\tts_worker.py` on first use and keeps it running. It is restarted on the next request if it crashes, killed when the extension stops, and exits by itself if its parent dies (stdin closes).
- Worker protocol: newline-delimited JSON on stdin/stdout, one request at a time. See the header of `worker/tts_worker.py`.
- Replies are cleaned for speech (Markdown removed, headings become sentences, code/diffs/terminal output/stack traces skipped, URLs and paths shortened) and split at sentence boundaries. The first chunk is short so audio starts quickly; the next chunk is synthesized while the current one plays.
- Pauses: a chunk carries one sentence per line and a blank line between paragraphs. The worker speaks each sentence on its own and adds real silence after it (`SENTENCE_PAUSE_MS`, `PARAGRAPH_PAUSE_MS` at the top of `worker/tts_worker.py`), so full stops, headings and list items can be heard. Default voice: `af_sky`.
- No temp files: audio is decoded in memory. Transcript text is never logged.

## Build and install

```
npm install
npm run build        # dist/index.js, dist/backend.js, dist/worker/tts_worker.py
npm test             # speech cleaner tests
node test/backend.smoke.mjs   # backend + real Kokoro: reuse, stop, crash recovery, missing paths, shutdown
npm run install-ext  # validates the bundle, copies to %APPDATA%\@nimbalyst\electron\extensions\readaloud
```

Then restart Nimbalyst (or reload extensions) and approve the one-time prompt to let the backend run.

## Limitations

- **Which messages get the button.** The SDK's transcript contribution does not say whether a block is from the user or the agent, or whether it is still streaming. The control checks the host's CSS classes (`.rich-transcript-message.user`, tool and thinking containers) and hides itself on user messages and tool output. If a Nimbalyst update renames those classes, the button may also appear on your own messages; it never breaks the transcript.
- **One strip, last turn only.** It sits on the last text block of the last turn and shows only when nothing follows it: no "still working" line (`.rich-transcript-waiting`) and no newer message from you. If the host renames that class, the strip may show while a turn still runs.
- **Collisions.** The control uses its own element name (`readaloud-control`), so it cannot replace other extensions' `code`/`a` overrides. Its rehype plugin only appends one element per block.
- **Per workspace.** Nimbalyst runs one backend per open project, so each project that you use Read Aloud in loads its own copy of the model (about 350 MB of memory).
