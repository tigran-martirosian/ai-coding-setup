---
name: pc-tidy
description: Show what is holding this computer's memory and stop what finished sessions left behind (old watchers, shells, headless browsers, scripts, Gradle daemons), and name ports a closed program still holds. Use when the user says the PC is slow or freezing, asks what is using memory, says "tidy the PC", when a port is "already in use" by a program that no longer runs, after a session of several hours, or on /pc-tidy.
---

# PC tidy

Windows only. On another system, say so and stop.

1. Report, changes nothing: `powershell -NoProfile -File "$(cygpath -w ~/.claude/workers/pc-tidy.ps1)"`
2. Stop the listed leftovers with `-Go` at the end, only when no build, boot or test is running in any session. It stops, with whatever each one started, only programs older than 3 hours whose starter has closed: shells of closed Claude sessions, Git's command-line tools (old `tail`/`grep` watchers), headless browsers, node or python run from `.claude`, Temp or npx; plus Gradle daemons.
3. **MAYBE WANTED** lists other orphaned node or python (a bot, a tool's daemon). `-Go` never stops them: name each to the user and stop one by hand (`taskkill //F //T //PID <n>`) only on their word.
4. **PORTS HELD BY A CLOSED PROGRAM**: after `-Go`, run the report again. A port still listed is held by a leftover outside these kinds; find it with Sysinternals `handle64 -a` (look for `<Nonexistent process>(<pid>)`) before telling the user to reboot.
5. Tell the user the free memory, the biggest programs and what was stopped. The report's NIMBALYST line says to restart it once it has been open over a day (no hook reminds about this any more); that is a step for the user, once no session is working: restarting it from a session ends that session.
