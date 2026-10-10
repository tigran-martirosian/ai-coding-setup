---
name: shared-usage
description: See who used how much of a Claude subscription that several people work on — sets up ccpool on this computer and shows the shared view.
disable-model-invocation: true
---

# Shared usage

[ccpool](https://github.com/hexxt-git/ccpool) is someone else's open-source tool. Claude shows one number for the whole account; ccpool splits it per person. Each person runs it on their own computer under their own name, and all of them join one group with the same group password.

1. **Already set up?** Run `ccpool status`. If it prints the view, show it and stop. If the command is missing, run `npm install -g ccpool` (needs Node 20 or newer; give the error and stop if it fails). Done when `ccpool --version` prints a number.
2. **Say what it sends, then ask.** One form, sent after these two sentences: "A small background program reads this computer's Claude Code activity and sends the token counts per reply, the model name, the account's limit percentages and your name to the tool author's server (`ccpool.hexxt.dev`). No chat text, no file names, and the Claude login stays on this computer." The form has three text fields:
   - their name in the view (letters, digits, hyphens);
   - the group password: the one the first person of the group chose, or a new one when they are the first;
   - their own member password, a new one that guards their name.
3. **Join.** Run `ccpool init --name <name> --yes` with the two passwords in the environment variables `CCPOOL_GROUP_PASSWORD` and `CCPOOL_MEMBER_PASSWORD` for that one command. Done when it prints `Created and joined` or `Joined`; on a wrong password give its message and ask for the password once more.
4. **Start at log-on.** The background program stops with the computer. On Windows, write the one-line file `ccpool.vbs` into the Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`):
   `CreateObject("WScript.Shell").Run "cmd /c ccpool daemon start", 0, False`
   On macOS or Linux, say that `ccpool daemon start` brings it back after a restart. Done when `ccpool daemon status` says it is running.
5. **Reply**, short: the output of `ccpool status`, then three lines:
   - usage is counted from now on, earlier usage shows as `unknown`, and so does everything typed on claude.ai;
   - the others join by typing `/shared-usage` on their computer with the same group password;
   - `ccpool` in a terminal opens the live view, `ccpool daemon stop` stops the background program.

Budget: about 8 tool calls.
