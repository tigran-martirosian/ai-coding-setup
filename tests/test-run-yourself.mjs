// Tests for ~/.claude/hooks/run-yourself.mjs. Run: node test-run-yourself.mjs
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/run-yourself.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-yourself-test-"));
const run = (input, env = {}) => spawnSync("node", [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, RUN_YOURSELF: "", ...env } }).stdout;
const blocks = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /Run it yourself now/.test(j.reason); } catch { return false; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const msg = (m, extra = {}) => run({ last_assistant_message: m, stop_hook_active: false, ...extra });

const REAL = "NotebookLM's login has expired.\n\nOpen a terminal and run:\n\n```\nuvx --from notebooklm-py notebooklm login --browser chrome\n```\n\nThen tell me when it's done.";
check("fires on the real example", blocks(msg(REAL)));
check("fires on 'run this in your terminal' + inline code", blocks(msg("Run this in your terminal: `npm run dev -- --port 3001`")));
check("fires on 'you need to run' + inline code", blocks(msg("To finish, you need to run `python ask.py --preflight` first.")));
check("fires on 'paste this into' + block", blocks(msg("Paste this into PowerShell:\n```powershell\nGet-Process node | Stop-Process\n```")));

check("silent: slash command", msg("To switch models, type `/model opus`.") === "");
check("silent: you need to run a slash command", msg("You can run `/make-video juice` to start.") === "");
check("silent: open Studio", msg("Open Studio at `http://localhost:3000` and check the preview.") === "");
check("silent: open Studio, no code", msg("Open Studio at localhost:3000 and pick the composition.") === "");
check("silent: proof of output", msg("Done. I ran it:\n```\nnpm run lint\n✔ no problems\n```") === "");
check("silent: no command at all", msg("Open a terminal tab in Studio if you want to watch the logs.") === "");
check("silent: attempt already failed", msg("I tried and it failed with an access error. Open a terminal and run:\n```\nnotebooklm login\n```") === "");
check("silent: needs a password", msg("Run this in your terminal, it asks for your password:\n```\nsudo apt update\n```") === "");
check("silent: stop_hook_active", run({ last_assistant_message: REAL, stop_hook_active: true }) === "");
check("silent: RUN_YOURSELF=off", msg(REAL, {}) !== "" && run({ last_assistant_message: REAL }, { RUN_YOURSELF: "off" }) === "");
check("silent: bad input", run("not json") === "");

// A prompt for a session in another project's window: not a shell command, but stopped once by the
// third check unless the user asked for the handoff or the reply says what needs a session there
const PROMPT = "Read ~/.claude/handoffs/needs-you-exact-text-20261002.md and do what it asks.";
const HANDOVER = "The handoff is written and the other-project window is open.\n\n### Needs you\n\n- Paste this into a new session in the other-project project window (the message box at the bottom):\n\n```\n" + PROMPT + "\n```\n\n  You should see it open the handoff file first. I can't start a session in another project's window.";
const handover = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /do it now and report what you did/.test(j.reason); } catch { return false; } };
const ONE_LINE = "**Needs you:** you need to paste `" + PROMPT + "` into a new chat in the other-project window.";
check("handover: a prompt to paste into another project's session is stopped once", handover(msg(HANDOVER)));
check("handover: the same, as one line with inline code", handover(msg(ONE_LINE)));
check("handover: not treated as a shell command", !blocks(msg(HANDOVER)) && !blocks(msg(ONE_LINE)));
const REAL_HANDOVER = "All four ticked items are routed.\n\n### Needs you\n\n1. **In the web-app window** (already open), start a new session and paste:\n   ```\n   Read ~/.claude/handoffs/2026-10-02-chat-review-web-app.md and carry it out.\n   ```\n   You should see two new bullets in its `CLAUDE.md`.";
check("handover: the real example (ticked changes turned into a prompt to paste)", handover(msg(REAL_HANDOVER)));
// The handoff skill's own prompt (its "Handing off to another project" step) is let through
const SKILL_PROMPT = "Read ~/.claude/handoffs/other-project-20261011.md and continue the work from \"Where we are\". Don't redo finished steps.";
const SKILL_REPLY = "The brief is written and the other-project window is open. Paste this into a new session there:\n\n```\n" + SKILL_PROMPT + "\n```";
check("handover: a prompt that only points at a handoffs file is still stopped", handover(msg(HANDOVER)));
check("handover silent: the handoff skill's own prompt ('continue the work from \"Where we are\"')", msg(SKILL_REPLY) === "");
check("handover silent: stop_hook_active (the second try goes through)", run({ last_assistant_message: HANDOVER, stop_hook_active: true }) === "");
check("handover silent: the reply says what needs a session there",
  msg(HANDOVER + " The render needs a session there: the `/make-video` skill only loads in that project.") === "");
check("handover silent: the prompt is for another person's own computer",
  msg(HANDOVER + " The prompt is for the other maker's own computer: nothing here can reach it.") === "" &&
  msg(HANDOVER + " Send it to him; he pastes it into a new chat on his computer.") === "");
check("handover: 'your own computer' is still stopped", handover(msg(HANDOVER + " It runs on your own computer.")));
check("handover silent: RUN_YOURSELF=off",run({ last_assistant_message: HANDOVER }, { RUN_YOURSELF: "off" }) === "");
check("handover silent: a command shown as proof next to a project's name",
  msg("Done. The session in the web-app project window ran `npm run lint` and it passed.") === "");
check("fires: 'paste this into a new session' with no other project named", blocks(msg("You need to paste this into a new session:\n```\n" + PROMPT + "\n```")));
check("fires: a terminal command is still a command, even next to a project window", blocks(msg("Open a terminal in the other-project project window and run:\n```\nnode run-tests.mjs --all\n```")));

// A vague "Needs you" item: something to send, paste, type or run, without the text
const vague = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /without giving the exact text/.test(j.reason); } catch { return false; } };
check("vague: the real example ('tell it to read the handoff file')", vague(msg("The handoff is written.\n\n**Needs you:** Start a session in other-project and tell it to read the handoff file; I could open the window but not start the session there.")));
check("vague: 'send the handoff'", vague(msg("### Needs you\n\n- Now it's only left to send the handoff to the new session.")));
check("vague: 'run the login command'", vague(msg("### Needs you\n- Run the login command, then tell me when it's done.")));
check("vague: 'point it at the file', path in code is not the prompt", vague(msg("### Needs you\n1. Open a new chat and point it at `~/.claude/handoffs/x.md`.")));
check("vague: 'enter the value' with no value", vague(msg("## Needs you\n- Open Settings and enter the value for the port.")));
check("vague: second item is the vague one", vague(msg("### Needs you\n- Decide whether the friend gets the planner.\n- Paste the prompt into a GPT session.")));
check("vague: also blocks when an earlier attempt is mentioned", vague(msg("I tried to start it and it was denied.\n\n### Needs you\n- Send the handoff to a new session.")));
check("vague silent: value given in a code span", msg("## Needs you\n- In Settings > Network, enter the value `8080` in the Port field; the dot turns green.") === "");
check("vague silent: slash command", msg("### Needs you\n- Tell the new session to run `/patch-check`.") === "");
check("vague silent: a decision, nothing to paste", msg("### Needs you\n- Tell me which of the two names you prefer.\n- Send the patch file to your friend when you are happy with it.") === "");
check("vague silent: a password only they have", msg("### Needs you\n- When the browser opens, type the password for the account; I can't know it.") === "");
check("vague silent: the same words outside a Needs you section", msg("The old rule let 'send the handoff' through. That is fixed and tested.") === "");
check("vague silent: section ends at the next heading", msg("### Needs you\n- Nothing to paste: pick a name.\n\n### How it works\nThe hook stops a reply that says to send the handoff with no text.") === "");
check("vague silent: stop_hook_active", run({ last_assistant_message: "### Needs you\n- Send the handoff to the new session.", stop_hook_active: true }) === "");

// From a transcript: only the text after the last tool call counts
const line = (o) => JSON.stringify(o);
const asst = (content) => line({ type: "assistant", message: { role: "assistant", content } });
const tFile = (name, lines) => { const f = path.join(dir, name); fs.writeFileSync(f, lines.join("\n") + "\n"); return f; };
const user = line({ type: "user", message: { role: "user", content: "log in" } });
const ask = [{ type: "text", text: REAL }];
check("transcript: final reply asks to run -> blocks", blocks(run({ transcript_path: tFile("a.jsonl", [user, asst(ask)]) })));
check("transcript: earlier ask, then ran it itself -> silent",
  run({ transcript_path: tFile("b.jsonl", [user, asst(ask), asst([{ type: "tool_use", name: "Bash", input: {} }]), asst([{ type: "text", text: "Logged in." }])]) }) === "");
check("transcript: previous turn's ask doesn't count",
  run({ transcript_path: tFile("c.jsonl", [user, asst(ask), user, asst([{ type: "text", text: "Fixed." }])]) }) === "");
check("transcript missing: silent", run({ transcript_path: path.join(dir, "nope.jsonl") }) === "");
const userSaid = (t) => line({ type: "user", message: { role: "user", content: t } });
const toolResult = line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } });
const said = [asst([{ type: "tool_use", name: "Write", input: {} }]), toolResult, asst([{ type: "text", text: HANDOVER }])];
check("handover transcript: the user asked for the handoff -> silent",
  run({ transcript_path: tFile("d.jsonl", [userSaid("/handoff C:\\Projects\\other-project"), ...said]) }) === "");
check("handover transcript: 'do a hand-off to that project' -> silent",
  run({ transcript_path: tFile("e.jsonl", [userSaid("ok do a hand-off to that project"), ...said]) }) === "");
check("handover transcript: the user ticked changes, did not ask for a handoff -> stopped",
  handover(run({ transcript_path: tFile("f.jsonl", [userSaid("set up what's ticked"), ...said]) })));

// Send-backs that were wrong: replies that ask for something only the user can do.
const S_KEY = "you\n1. Go to https://console.anthropic.com → **Billing**, buy **$50** of credits and leave **auto-reload off**.\n2. In the same Console, go to **API Keys** → **Create key** and copy it.\n3. Give the key to Claude Code, one of two ways:\n   - In Nimbalyst's AI settings, set Claude to use an API key and paste it there.\n   - Or in a Windows terminal, run this with your key in place of `sk-ant-...`, then fully quit and reopen Nimbalyst:\n     ```\n     setx ANTHROPIC_API_KEY \"sk-ant-...\"\n     ```\n4. Open a new session and type `/status`. It should show **API key** as the login method instead of your Claude account.\n\nTell me when the key is in, and I can switch the default model to Sonnet if you want.";
const S_KEY2 = "$0.10 per million tokens in and $0.50 per million out. One call reads a page and writes up to 4,000 tokens, so it costs well under a cent.\n\n### Needs you\n1. Create a key in the Console under **API Keys** (it starts with `sk-ant-`).\n2. Open a Command Prompt or PowerShell window, paste this with your key in place of the placeholder, and press Enter:\n   ```\n   setx ANTHROPIC_API_KEY \"sk-ant-your-key-here\"\n   ```\n   You should see `SUCCESS: Specified value was saved.`\n3. Fully close and reopen Nimbalyst so it picks up the new variable, then tell me. I'll run the first test.";
const S_PUSH = "- **Reader court** (`/court readers <file>`) is built and tested once.\n\n### Needs you\n\n- **Upload it yourself**, or allow the push and tell me to retry. To upload, paste this into a terminal (Git Bash):\n\n```\ncd \"/c/Projects/site-repo\" && git add -A && git commit -m \"Add a full install\" && git push origin main\n```\n\nYou should see a line ending in `main -> main`. Then tell me \"pushed\" and I'll watch the Windows and Mac test runs on GitHub and fix whatever fails.";
const S_HANDOFF_PROMPT = "The handoff is written: [brief-20261005-0250.md](~/.claude/handoffs/brief-20261005-0250.md). I did not open a new session, since you said you'll send it to another conversation yourself.\n\n### Needs you\nPaste this into the other conversation; it should read the brief and pick up from the ring fix:\n\n```\nRead ~/.claude/handoffs/brief-20261005-0250.md and continue the work from \"Where we are\". Don't redo finished steps.\n```\n\nThis session can be closed.";
const S_THIS_CHAT = "### Needs you\n\n- **Should the test also cover the slower path?** I recommend yes: the test is being built right now. To go ahead, type this in this chat:\n  ```\n  Add the slower path to the test\n  ```\n  I will then send a note to the session building it and confirm here that it arrived. Until you say so, nothing goes to that session.";
const S_OTHER_PERSON = "- **Send your colleague the three steps above.** Ask them to send back the output if a build fails.\n- **Decide whether they run the full install.** If yes, they open a terminal in the unzipped repo folder and run:\n  ```\n  claude \"Read docs/full-install.md and carry out every step in it.\"\n  ```";
const S_VAGUE_INFO = "### Needs you\n- The server address, when you want it on the page: tell the new session and it replaces `ADDRESS`.\n- Any screenshots of your own you'd rather use than generated pictures: drop them into `site/img/` and name the block.";
const S_VAGUE_AGAIN = "### Needs you\n\n- **Quit Nimbalyst fully and open it again.** A normal start writes the file again; I can't do this from here because it would close this session.\n- **Then send your message to the bot again.** The first one was never delivered to any session. You should get a \"Text to send\" preview with Send / Cancel buttons instead of \"could not find the project\".\n- **Decide whether you want the bot fixed.** If you say \"fix the bot\", I'll make it say \"Nimbalyst's connection file is missing, restart Nimbalyst\" in this case instead of blaming the project name.";
const S_NEW_SESSION = "In the other window, start a new session and paste this:\n\n```\nRead ~/.claude/handoffs/pictures-20261002.md and do what it asks. Test it for real before you say it's done.\n```\n\nThe handoff file holds everything, so the new session needs nothing else from you.";
check("sampled: an API key pasted into setx is the user's own step", msg(S_KEY) === "");
check("sampled: the same in a Needs you list, with a restart", msg(S_KEY2) === "");
check("sampled: a push the permission system refused", msg(S_PUSH) === "");
check("sampled: the handoff skill's own prompt for another conversation", msg(S_HANDOFF_PROMPT) === "");
check("sampled: 'type this in this chat' is a message to Claude, not a shell command", msg(S_THIS_CHAT) === "");
check("sampled: a command for another person's computer", msg(S_OTHER_PERSON) === "");
check("vague sampled: information only the user has", msg(S_VAGUE_INFO) === "");
check("vague sampled: the user's own earlier message sent again", msg(S_VAGUE_AGAIN) === "");
check("handover sampled: the user asked what exactly to tell the new session -> silent",
  run({ transcript_path: tFile("g.jsonl", [userSaid("Okay, how to yeah, tell me how to point to that. Like tell me what exactly tells of the new session."), asst([{ type: "text", text: S_NEW_SESSION }])]) }) === "");
check("handover sampled: the same reply after an unrelated message -> still stopped",
  handover(run({ transcript_path: tFile("h.jsonl", [userSaid("ok, go on with it"), asst([{ type: "text", text: S_NEW_SESSION }])]) })));
// The rule still fires on ordinary asks, and a secret mentioned far from the command does not excuse it
check("still fires: now run npm test in a terminal", blocks(msg("The fix is in. Open a terminal and run:\n```\nnpm test -- --runInBand\n```\nThen tell me what it prints.")));
check("still fires: a secret mentioned far from the command",
  blocks(msg("The API key is stored in the settings file and works.\n\n" + "Everything else is done and checked. ".repeat(20) + "\n\nNow run `npm run build -- --watch` in your terminal and tell me the result.")));

// Wording that must still fire (a real ask), next to its silent twin
check("fires: a login token that expired is not a secret to type", blocks(msg("Your login token expired. You need to run `gh auth login` in a terminal.")));
check("fires: 'I did not pin the version' is not a PIN", blocks(msg("I did not pin the version. You need to run `npm install foo` in a terminal.")));
check("silent: typing a key in place of a placeholder", msg("You need to run `setx FOO_KEY \"<your key>\"` in a terminal, with your key in place of the placeholder.") === "");
check("silent: a PIN typed beside the command (upper case)", msg("You need to run `ssh-add -t 3600 ~/.ssh/id` in a terminal and enter your PIN when it asks.") === "");
check("fires: 'they should pass now' has no person as subject", blocks(msg("The tests are fixed and they should pass now. You need to run `npm run build` in a terminal.")));
check("fires: 'in this session' earlier in the reply, not before the code", blocks(msg("Nothing else changed in this session. You need to run `git push origin main` in a terminal.")));
check("silent: a friend who pastes it (shared person regex)", msg("Send this to your friend: he pastes it into a new session in his project.\n```\nRead the handoff file and continue the work\n```") === "");
check("silent: 'he runs' in a terminal", msg("Send this to him, he runs it in a terminal:\n```\nnpm run dev -- --port 3001\n```") === "");
check("fires: 'The push was rejected' is a git error, not the permission system", blocks(msg("The push was rejected. You need to run `git pull --rebase` in a terminal.")));
check("silent: the permission system refused the push", msg("The tool call for the push was refused by the permission system. To upload, paste this into a terminal:\n```\ngit push origin main\n```") === "");
check("vague fires: 'Send the handoff prompt again' names a handoff", vague(msg("### Needs you\n- Send the handoff prompt again in the new session.")));
check("vague fires: a timing clause is not a value only they hold (notes)", vague(msg("### Needs you\n- When you get a minute, tell the new session to read the notes.")));
check("vague fires: 'If you want it live, send the message'", vague(msg("### Needs you\n- If you want it live, send the message to the other chat.")));
check("vague silent: their own message sent again", msg("### Needs you\n- Send the Dashboard message to the bot again. You should get a \"Text to send\" preview.") === "");

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
