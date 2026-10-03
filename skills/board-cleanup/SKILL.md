---
name: board-cleanup
description: Tidy this project's Nimbalyst Sessions board cheaply — move finished sessions to Complete (no git needed) and say how to archive them. Use instead of /planning:session-cleanup when the user says "clean up the board", "tidy sessions", or runs /board-cleanup.
model: sonnet
---

# Board cleanup

Covers **this project's board only** (the tools can't see other projects). Budget: about 6 turns. Send independent tool calls together in one message. Nothing changes before the user approves the form in step 3.

Ignore `committed` / `uncommitted` tags: they depend on git, which the project may not have. A session is **done** when it gave its final report, was handed off to another session, or only answered a question.

1. **List.** One `list_recent_sessions` call with `limit: 250`, `includeArchived: false`.

2. **Sort from the list alone.** No other calls for these:
   - **Leave:** `complete` already (just count them), `[RUNNING]`, `[CURRENT]`.
   - **Skip, don't mention:** no phase and the title is "New conversation", "New Session", a bare slash command, or the same as another session that has a phase (that row is only a group container).
   - **Done:** a later session exists with the same title plus "(cont.)"; or the title shows a one-off test or probe.
   - **Check:** everything else that isn't complete. Call `get_session_summary` for these, newest first, **at most 8**, all in one message. Read only the last reply and any pending question: final report, handoff or plain answer means done; an open question or unfinished step means leave it. List any beyond 8 as "not checked".

3. **Ask once.** If nothing is done, say "Nothing to move" and go to step 5. Otherwise one `PromptForUserInput` with a single `multiSelect` field `moveToComplete`: item `id` = sessionId, `title` = session title, `subtitle` = "<phase> → complete | <why, under 10 words>", `defaultChecked: true`. If the user cancels, change nothing.

4. **Apply.** For each checked id, `update_session_board` with `sessionId` and `phase: "complete"`, all in one message. Don't pass `tags` (it replaces the whole list), never pass `phase: null`, and never use `update_session_meta` for another session. Add no labels such as `archived-candidate`.

5. **Close.** Only if this session was opened just for the cleanup: one `update_session_meta` for this session, name "Board cleanup", phase `complete`. If it ran inside a session doing other work, leave that session's name and phase alone.

6. **Report in under 10 lines, plain words.** What moved; what was left and why (one line each); then exactly this, with the count of sessions now in Complete: "**To hide finished sessions:** open the Sessions board, select the cards in the Complete column (Ctrl-click), then choose Archive selected, or drag them onto the ARCHIVE strip at the right edge. N are waiting. I can't archive for you." Don't explain phases, tags or the search box unless asked.

**Plan mode on?** Do steps 1–2, print the list of what would move, and tell the user to switch plan mode off and run it again. Don't write a plan file and don't call ExitPlanMode.
