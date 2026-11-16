#!/usr/bin/env python
# The kept-running transcriber of the phone app's PC program (PC program design, section 7). It loads the speech
# model once, the same way as bot/transcribe.py, then turns audio files into text, one job at a time:
#   in  (stdin, one JSON line per job):  {"file": "<audio file>"}
#   out (stdout, one JSON line each):    {"ready": true} once the model is loaded, then per job
#                                        {"text": "..."} or {"error": "..."}
# Run through uv so nothing is installed by hand:
#   uv run --no-project --with faster-whisper --with "av<16" python -I transcribe-server.py [--download]
# Without --download the model must already be on this PC (it is never downloaded in the middle of a recording);
# --download fetches the "small" model (about 480 MB) once, says so on stdout and ends.
import json
import sys

args = sys.argv[1:]
if args not in ([], ["--download"]):
    sys.stderr.write("usage: transcribe-server.py [--download]\n")
    sys.exit(2)
download = args == ["--download"]

from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")


def say(answer):
    sys.stdout.write(json.dumps(answer, ensure_ascii=False) + "\n")
    sys.stdout.flush()


try:
    model = WhisperModel(
        "small", device="cpu", compute_type="int8", local_files_only=not download
    )
except Exception as e:  # the model is missing or does not load: say why and end
    sys.stderr.write(f"the speech model did not load: {e}\n")
    sys.exit(1)

if download:
    sys.stdout.write("the speech model is downloaded and loads\n")
    sys.exit(0)

say({"ready": True})
for line in sys.stdin:
    if not line.strip():
        continue
    try:
        job = json.loads(line)
        segments, _info = model.transcribe(job["file"], language=None)  # None = find the language itself
        say({"text": " ".join(s.text.strip() for s in segments).strip()})
    except Exception as e:  # one failed job does not stop the transcriber
        say({"error": f"{type(e).__name__}: {e}"})
