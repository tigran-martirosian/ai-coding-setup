---
name: pc-tidy
description: Show what is holding this computer's memory and stop what finished sessions left behind. Use when the user says the PC is slow or freezing, asks what is using memory, says "tidy the PC", or after a session of several hours, or runs /pc-tidy.
---

# PC tidy

Windows only. On another system, say so and stop.

1. Report, changes nothing: `powershell -NoProfile -File "$(cygpath -w ~/.claude/workers/pc-tidy.ps1)"`
2. Stop the listed leftovers with `-Go` at the end, only when no build, boot or test is running in any session. It stops only shells of closed Claude sessions and Gradle daemons older than 3 hours, nothing else.
3. Tell the user the free memory, the biggest programs and what was stopped. If it says Nimbalyst should be restarted, that is a step for the user, once no session is working: restarting it from a session ends that session.
