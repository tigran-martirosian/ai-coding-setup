#!/usr/bin/env python
# Voice file in, text out. Prints only the text (UTF-8) on stdout; problems go to stderr with exit 1.
# Run through uv so nothing is installed by hand:
#   uv run --no-project --with faster-whisper --with "av<16" python transcribe.py <audio file>
# (av 19 removed an argument that faster-whisper 1.2.1 still passes, so av is pinned below 16.)
# The first run downloads the "small" model (about 480 MB).
import sys

if len(sys.argv) != 2:
    sys.stderr.write("usage: transcribe.py <audio file>\n")
    sys.exit(2)

from faster_whisper import WhisperModel

model = WhisperModel("small", device="cpu", compute_type="int8")
segments, _info = model.transcribe(sys.argv[1], language=None)  # None = find the language itself
text = " ".join(s.text.strip() for s in segments).strip()

sys.stdout.reconfigure(encoding="utf-8")
sys.stdout.write(text + "\n")
