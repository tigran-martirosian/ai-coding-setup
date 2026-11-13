---
name: handoff
description: Move the current work to a fresh, cheap session — write a short handoff brief (goal, state, next step, files) and open a new session that continues from it. Use when context-guard says to move the work to a fresh session, when job-done says a piece is committed with steps of the job left, or the user says "handoff", "new session", "move to a fresh session", or runs /handoff (optional: another project's folder to hand the work to).
---

# Handoff to a fresh session

A big session re-sends all its context on every step; a fresh one starts from a short brief. A handoff is only for handing this session's work over; side work goes to a subagent. Budget: about 6 tool calls.

1. **Summary first.** Bring the project's `HANDOFF.md` open items up to date first, if it has one. Then write `~/.claude/handoffs/summary.md` (Write tool) with 5–12 bullets from this conversation:
   - the goal, in one line;
   - done and verified (with the proof: command and result); things tried that failed (so they aren't redone);
   - in progress, and the exact next step; for a led job, the plan file's path and its `Stage:` word;
   - decisions the user made, only explicit gos (a tick, "yes", "do it", "decided", a plain choice between offered options), what they said against a proposal first, each with where it came from (message time or form title) and the user's words in quotes, cleaned: only the words that carry it, misheard words fixed, fillers cut with "…", meaning unchanged;
     - for a form: the field label, the ticked option's full text in its exact words, and anything typed with it;
   - "Talked about, not decided": what the user said as talk ("I think", "what if", "let's redesign"), in their words; when unsure whether it was a go, ask one line before handing off;
   - "Proposed by Claude, not confirmed": every item with no quote, and every consequence Claude worked out ("this replaces ..."). A helper told to write DECISIONS.md or a rule file from the brief writes only the quoted items and reports the rest back;
   - the path of this conversation's transcript or its session id;
   - anything the user still owes (answers, approvals);
   - the skills the next session should use, by name, if any.
   Only facts a fresh session couldn't get from the files. No file contents. A key, token or password is written as `<REDACTED>`: another model may read the brief.
2. **Brief.** Run `node ~/.claude/hooks/handoff-brief.mjs --summary ~/.claude/handoffs/summary.md` in the project folder. It puts the summary under "Where we are", deletes the summary file and prints the path of the brief it wrote; without a summary it writes nothing and says so. It picks the newest transcript for this folder, so check that its "First request" matches this conversation; if another session in the same folder was newer, write the summary again and rerun with `--transcript <this session's .jsonl>`.
3. **Open the new session.** If `mcp__nimbalyst-host__spawn_session` is available (load it with ToolSearch first), call it with `isolated: true`, always (a top-level session that takes this one's work over; `create_session` and a spawn without the flag make a child), `inheritModel: true`, `title`: this session's name + " (cont.)", and `prompt`: `Read <brief path> and continue the work from "Where we are", after reading HANDOFF.md's open items and the top of DECISIONS.md (the brief wins where it is newer). Don't redo finished steps.` Otherwise tell the user to start a new session and paste that prompt. Then run `node ~/.claude/skills/steer/steer.mjs moved --to <the new session's id>`: reports from child sessions this one started, and any message the user still types here (not slash commands, and only for 24 hours), now go to the new session as notes instead of waking this one; this session tells the user in one line where the message went.
4. **Reply** in two lines: the new session is open (or the prompt to paste), and this one can be closed. Do no more work here.

**Handing off to another project** (`/handoff <folder>`, or the work belongs in another project's folder): `spawn_session` always opens in the current folder, so it can't be used. Do steps 1 and 2 as above (the brief is written under `~/.claude/handoffs/`, so the other project can read it), then call `mcp__nimbalyst-host__workspace_open` with the target folder, and reply with the one line to paste into a new session there, in a code block: `Read <brief path> and continue the work from "Where we are", after reading HANDOFF.md's open items and the top of DECISIONS.md (the brief wins where it is newer). Don't redo finished steps.` Say which model to pick if the work needs one. Nothing is written into the other project's folder from here.

**When Claude is out of usage:** a Stop hook (`handoff-brief.mjs --hook`) rewrites `~/.claude/handoffs/<folder>-latest.md` after every reply, with no summary; it also lists the folder's other recent sessions, each with its own `<folder>-auto-<id>.md` brief. The user opens a new Nimbalyst session, picks a GPT or Gemini model, and says: `Continue the work from ~/.claude/handoffs/<folder>-latest.md.` If two projects have the same folder name, the second one's briefs are named `<folder>-<6 characters>-…` instead; the "Project folder" line at the top of each brief says which project it is.
