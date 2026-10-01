---
name: handoff
description: Move the current work to a fresh, cheap session — write a short handoff brief (goal, state, next step, files) and open a new session that continues from it. Use when context-guard says the session is big and the user agrees to switch, or the user says "handoff", "new session", "move to a fresh session", or runs /handoff.
---

# Handoff to a fresh session

A big session re-sends all its context on every step; a fresh one starts from a short brief. Budget: about 5 tool calls.

1. **Brief.** Run `node ~/.claude/hooks/handoff-brief.mjs` in the project folder. It prints the path of the brief it wrote. It picks the newest transcript for this folder, so check that its "First request" matches this conversation; if another session in the same folder was newer, rerun with `--transcript <this session's .jsonl>`.
2. **Summary.** Replace the `<!-- summary ... -->` line in the brief with 5–12 bullets from this conversation, in one Edit:
   - the goal, in one line;
   - done and verified (with the proof: command and result);
   - in progress, and the exact next step;
   - decisions the user made, and things tried that failed (so they aren't redone);
   - anything the user still owes (answers, approvals).
   Only facts a fresh session couldn't get from the files. No file contents.
3. **Open the new session.** If `mcp__nimbalyst-host__spawn_session` is available (load it with ToolSearch first), call it with `isolated: true`, `inheritModel: true`, `title`: this session's name + " (cont.)", and `prompt`: `Read <brief path> and continue the work from "Where we are". Don't redo finished steps.` Otherwise tell the user to start a new session and paste that prompt.
4. **Reply** in two lines: the new session is open (or the prompt to paste), and this one can be closed. Do no more work here.

**When Claude is out of usage:** a Stop hook (`handoff-brief.mjs --hook`) rewrites `~/.claude/handoffs/<folder>-latest.md` after every reply, with no summary; it also lists the folder's other recent sessions, each with its own `<folder>-auto-<id>.md` brief. Open a new session with another model and say: `Continue the work from ~/.claude/handoffs/<folder>-latest.md.`
