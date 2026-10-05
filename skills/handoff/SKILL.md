---
name: handoff
description: Move the current work to a fresh, cheap session — write a short handoff brief (goal, state, next step, files) and open a new session that continues from it. Use when context-guard says to move the work to a fresh session, or the user says "handoff", "new session", "move to a fresh session", or runs /handoff (optional: another project's folder to hand the work to).
---

# Handoff to a fresh session

A big session re-sends all its context on every step; a fresh one starts from a short brief. Budget: about 5 tool calls.

1. **Summary first.** Write `~/.claude/handoffs/summary.md` (Write tool) with 5–12 bullets from this conversation:
   - the goal, in one line;
   - done and verified (with the proof: command and result);
   - in progress, and the exact next step;
   - decisions the user made, and things tried that failed (so they aren't redone);
   - anything the user still owes (answers, approvals).
   Only facts a fresh session couldn't get from the files. No file contents.
2. **Brief.** Run `node ~/.claude/hooks/handoff-brief.mjs --summary ~/.claude/handoffs/summary.md` in the project folder. It puts the summary under "Where we are", deletes the summary file and prints the path of the brief it wrote; without a summary it writes nothing and says so. It picks the newest transcript for this folder, so check that its "First request" matches this conversation; if another session in the same folder was newer, write the summary again and rerun with `--transcript <this session's .jsonl>`.
3. **Open the new session.** If `mcp__nimbalyst-host__spawn_session` is available (load it with ToolSearch first), call it with `isolated: true` (a top-level session, not a child filed under this one's group; never use `create_session`, which makes a child), `inheritModel: true`, `title`: this session's name + " (cont.)", and `prompt`: `Read <brief path> and continue the work from "Where we are". Don't redo finished steps.` Otherwise tell the user to start a new session and paste that prompt.
4. **Reply** in two lines: the new session is open (or the prompt to paste), and this one can be closed. Do no more work here.

**Automatic handoff** (context-guard held the reply because the session passed its handoff limit): do steps 1 to 4 without asking the user anything. If work is still in progress, the prompt is the one in step 3. If the task is finished, say so in the summary and use this prompt instead: `Read <brief path> for background. That work is finished. Reply "Ready" in one line and wait for the user's next request.` In the reply, name the new session and say the next message goes there. If this session is waiting on an answer from the user that it needs, don't hand off yet: say in one line that the work moves after their answer.

**Handing off to another project** (`/handoff <folder>`, or the work belongs in another project's folder): `spawn_session` always opens in the current folder, so it can't be used. Do steps 1 and 2 as above (the brief is written under `~/.claude/handoffs/`, so the other project can read it), then call `mcp__nimbalyst-host__workspace_open` with the target folder, and reply with the one line to paste into a new session there, in a code block: `Read <brief path> and continue the work from "Where we are". Don't redo finished steps.` Say which model to pick if the work needs one. Nothing is written into the other project's folder from here.

**When Claude is out of usage:** a Stop hook (`handoff-brief.mjs --hook`) rewrites `~/.claude/handoffs/<folder>-latest.md` after every reply, with no summary; it also lists the folder's other recent sessions, each with its own `<folder>-auto-<id>.md` brief. Open a new session with another model and say: `Continue the work from ~/.claude/handoffs/<folder>-latest.md.` If two projects have the same folder name, the second one's briefs are named `<folder>-<6 characters>-…` instead; the "Project folder" line at the top of each brief says which project it is.
