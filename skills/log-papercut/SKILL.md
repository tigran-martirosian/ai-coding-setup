---
name: log-papercut
description: Papercut log - file one line about friction from your own setup (what you tried, expected, got, and what would fix it) to ~/.claude/papercuts. Use when a tool, hook, skill or instruction got in the way.
---

# Log a papercut

A papercut is friction the setup caused you: a retry, a workaround, a wrong turn, too small for anyone to file a bug. Each one is a single line; the lines are read later, grouped, and fixed at the root. Logging is the whole job here: two steps, then back to your task.

1. **Write the line.** Four parts in plain words, on one line: `tried: <what you did> | expected: <what should have happened> | got: <what happened> | fix: <what would have prevented it>`. Name the tool, hook, skill or instruction by its name. Keep keys, passwords and file contents out of it. Done when all four parts are filled.
2. **Append it** to today's file, creating the folder if it is missing (the quoted `EOF` keeps the line exactly as written):
   ```bash
   d=~/.claude/papercuts; mkdir -p "$d" && cat >> "$d/$(date +%F).md" <<'EOF'
   - tried: ... | expected: ... | got: ... | fix: ...
   EOF
   tail -n 1 "$d/$(date +%F).md"
   ```
   Done when `tail` prints your line. Then return to your task.

## When a step fails

| Problem | What to do |
|---|---|
| `tail` prints another line | another session appended at the same moment: `grep -F "<a few words of your line>" ~/.claude/papercuts/$(date +%F).md`; if it finds nothing, run step 2 once more |
| `mkdir` or the append is refused (permissions, a read-only disk) | put the line in your reply to the user, starting `Papercut:`, so it is not lost |
