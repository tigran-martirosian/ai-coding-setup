# Read Aloud (Nimbalyst extension)

Reads agent replies aloud with Kokoro TTS running on this computer. No cloud, no API keys, no per-use cost.

## Use

- **Per reply:** hover an agent reply and click the speaker icon under it. While it plays, you get Pause/Resume, Skip ahead (next chunk) and Stop. The `1×` button cycles speed 1 / 1.25 / 1.5 / 2× (applies from the next chunk).
- **Spoken summaries:** after `/voice on`, the agent ends each reply with a hidden `<!-- voice: ... -->` line (the extension removes it from the chat). The speaker and hands-free mode read only that summary; the page icon reads the full reply. Checked in-app with `node scripts/cdp.mjs --file test/ui-controls.js`.
- **Hands-free:** click the headphones icon (next to the speaker), or type `/voice` in chat (listed as `/readaloud:voice`; add `on` or `off` to force a state). Each finished reply and each question card is then read automatically. The saved setting is the source of truth; `/voice` asks the agent to call `set_auto_read`, and the UI picks that up within about 3 seconds.
- **Settings:** Settings > Extensions > Read Aloud (voice, speed, skip code, skip terminal output and diffs, TTS folder, worker status, test button).

## How it works

```
transcript (renderer)                     backend module (utility process)        Python
rehype plugin + <readaloud-control>  -->  readaloud.synthesize / stop / status -->  tts_worker.py
player.ts (Web Audio, in memory)     <--  base64 WAV per chunk                <--  Kokoro, loaded once
```

- Renderer calls the backend only through the host's `callBackendTool` bridge, and only this extension's own tools:
  `synthesize`, `stop`, `status`, `warmup`, `shutdown_worker` (panel-only) and `set_auto_read` (also visible to the agent, for `/voice`).
- The backend starts `<TTS folder>\venv\Scripts\python.exe dist\worker\tts_worker.py` on first use and keeps it running. It is restarted on the next request if it crashes, killed when the extension stops, and exits by itself if its parent dies (stdin closes).
- Worker protocol: newline-delimited JSON on stdin/stdout, one request at a time. See the header of `worker/tts_worker.py`.
- Replies are cleaned for speech (Markdown removed, headings become sentences, code/diffs/terminal output/stack traces skipped, URLs and paths shortened) and split at sentence boundaries. The first chunk is short so audio starts quickly; the next chunk is synthesized while the current one plays.
- Pauses: a chunk carries one sentence per line and a blank line between paragraphs. The worker speaks each sentence on its own and adds real silence after it (`SENTENCE_PAUSE_MS`, `PARAGRAPH_PAUSE_MS` at the top of `worker/tts_worker.py`), so full stops, headings and list items can be heard. Default voice: `af_sky`.
- In voice mode the spoken summary is written for the ear (short sentences, "first, then, finally", no formatting); the rules are in `claude-plugin/commands/voice.md`.
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
- **One button per text block.** An agent turn can contain several text blocks (between tool calls); each has its own button and reads only that block.
- **Streaming.** Clicking during streaming reads what has arrived so far.
- **Hands-free mode** watches the transcript for the host's "Finished in ..." row and question cards (`src/autoRead.ts`, all selectors listed at the top). It only reads messages that arrive while the transcript is open and scrolled to the bottom. If the host renames those markers, hands-free stops; the per-reply button keeps working.
- **Collisions.** The control uses its own element name (`readaloud-control`), so it cannot replace other extensions' `code`/`a` overrides. Its rehype plugin only appends one element per block.
- **Per workspace.** Nimbalyst runs one backend per open project, so each project that you use Read Aloud in loads its own copy of the model (about 350 MB of memory).
