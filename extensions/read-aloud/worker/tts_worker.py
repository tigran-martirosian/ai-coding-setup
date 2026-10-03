"""Persistent Kokoro TTS worker for the Nimbalyst Read Aloud extension.

Loads the Kokoro model once, then answers newline-delimited JSON requests on
stdin with newline-delimited JSON responses on stdout. Exits when stdin closes
(so it dies with the extension backend even if it is never killed explicitly).

Request:  {"id": 1, "op": "synthesize", "text": "...", "voice": "af_sky", "speed": 1.0, "lang": "en-us", "para_end": false}
          {"id": 2, "op": "ping"}

The text holds one sentence per line and a blank line between paragraphs. Each
sentence is spoken on its own and followed by real silence, longer after a
paragraph ("para_end" says whether the text itself ends one), so full stops,
headings and list items are audible.
Response: {"id": 1, "ok": true, "wav_b64": "...", "sample_rate": 24000, "duration": 3.2, "synth_ms": 850}
          {"id": 1, "ok": false, "error": "..."}
Events:   {"event": "ready", "load_ms": 2100, "voices": [...]}
          {"event": "fatal", "error": "..."}

Transcript text is never logged.
"""

import argparse
import base64
import io
import json
import os
import sys
import time
import wave

# Keep the protocol channel clean: anything a library prints goes to stderr.
_proto = open(os.dup(sys.stdout.fileno()), "w", encoding="utf-8", newline="\n")
os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
sys.stdout = sys.stderr


def send(obj):
    _proto.write(json.dumps(obj) + "\n")
    _proto.flush()


def to_wav_bytes(samples, sample_rate):
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


# Silence added after each sentence, on top of the ~0.35 s Kokoro leaves by itself.
SENTENCE_PAUSE_MS = 450
PARAGRAPH_PAUSE_MS = 800


def speak(kokoro, text, voice, speed, lang, para_end):
    """Speaks the text sentence by sentence with a pause after each one."""
    import numpy as np

    parts = []
    sr = 24000
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    for pi, para in enumerate(paragraphs):
        sentences = [s.strip() for s in para.split("\n") if s.strip()]
        for si, sentence in enumerate(sentences):
            samples, sr = kokoro.create(sentence, voice=voice, speed=speed, lang=lang)
            ends_para = si == len(sentences) - 1 and (pi < len(paragraphs) - 1 or para_end)
            pause_ms = (PARAGRAPH_PAUSE_MS if ends_para else SENTENCE_PAUSE_MS) / speed
            parts.append(samples)
            parts.append(np.zeros(int(sr * pause_ms / 1000), dtype=samples.dtype))
    if not parts:
        raise ValueError("empty text")
    return np.concatenate(parts), sr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--voices", required=True)
    args = parser.parse_args()

    started = time.time()
    try:
        from kokoro_onnx import Kokoro

        kokoro = Kokoro(args.model, args.voices)
    except Exception as exc:  # noqa: BLE001 - report any load failure to the host
        send({"event": "fatal", "error": f"Could not load Kokoro: {exc}"})
        return 1

    try:
        voices = sorted(kokoro.get_voices())
    except Exception:  # noqa: BLE001
        voices = []
    send({"event": "ready", "load_ms": int((time.time() - started) * 1000), "voices": voices})

    sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid = req.get("id")
        op = req.get("op")
        try:
            if op == "ping":
                send({"id": rid, "ok": True})
            elif op == "synthesize":
                text = str(req.get("text") or "").strip()
                if not text:
                    raise ValueError("empty text")
                t0 = time.time()
                samples, sr = speak(
                    kokoro,
                    text,
                    voice=str(req.get("voice") or "af_sky"),
                    speed=float(req.get("speed") or 1.0),
                    lang=str(req.get("lang") or "en-us"),
                    para_end=bool(req.get("para_end")),
                )
                wav = to_wav_bytes(samples, sr)
                send({
                    "id": rid,
                    "ok": True,
                    "wav_b64": base64.b64encode(wav).decode("ascii"),
                    "sample_rate": int(sr),
                    "duration": round(len(samples) / float(sr), 3),
                    "synth_ms": int((time.time() - t0) * 1000),
                })
            else:
                raise ValueError(f"unknown op: {op}")
        except Exception as exc:  # noqa: BLE001
            send({"id": rid, "ok": False, "error": str(exc)})
    return 0


if __name__ == "__main__":
    sys.exit(main())
