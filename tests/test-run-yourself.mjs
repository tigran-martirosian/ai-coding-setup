// Tests for hooks/run-yourself.mjs. Run: node tests/test-run-yourself.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/run-yourself.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-yourself-test-"));
const run = (input, env = {}) => spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, RUN_YOURSELF: "", ...env } }).stdout;
const blocks = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /Run it yourself now/.test(j.reason); } catch { return false; } };
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const msg = (m, extra = {}) => run({ last_assistant_message: m, stop_hook_active: false, ...extra });

const REAL = "The service login has expired.\n\nOpen a terminal and run:\n\n```\nmytool login --browser chrome\n```\n\nThen tell me when it's done.";
check("fires on the real example", blocks(msg(REAL)));
check("fires on 'run this in your terminal' + inline code", blocks(msg("Run this in your terminal: `npm run dev -- --port 3001`")));
check("fires on 'you need to run' + inline code", blocks(msg("To finish, you need to run `python app.py --check` first.")));
check("fires on 'paste this into' + block", blocks(msg("Paste this into PowerShell:\n```powershell\nGet-Process node | Stop-Process\n```")));

check("silent: slash command", msg("To switch models, type `/model opus`.") === "");
check("silent: you need to run a slash command", msg("You can run `/make-video demo` to start.") === "");
check("silent: open Studio", msg("Open Studio at `http://localhost:3000` and check the preview.") === "");
check("silent: open Studio, no code", msg("Open Studio at localhost:3000 and pick the composition.") === "");
check("silent: proof of output", msg("Done. I ran it:\n```\nnpm run lint\n✔ no problems\n```") === "");
check("silent: no command at all", msg("Open a terminal tab in Studio if you want to watch the logs.") === "");
check("silent: attempt already failed", msg("I tried and it failed with an access error. Open a terminal and run:\n```\nmytool login\n```") === "");
check("silent: needs a password", msg("Run this in your terminal, it asks for your password:\n```\nsudo apt update\n```") === "");
check("silent: stop_hook_active", run({ last_assistant_message: REAL, stop_hook_active: true }) === "");
check("silent: RUN_YOURSELF=off", msg(REAL, {}) !== "" && run({ last_assistant_message: REAL }, { RUN_YOURSELF: "off" }) === "");
check("silent: bad input", run("not json") === "");

// A prompt for a session in another project's window: not a shell command, but stopped once by the
// third check unless the user asked for the handoff or the reply says what needs a session there
const PROMPT = "Read C:\\work\\handoffs\\example-handoff.md and do what it asks.";
const HANDOVER = "The handoff is written and the other-project window is open.\n\n### Needs you\n\n- Paste this into a new session in the other-project project window (the message box at the bottom):\n\n```\n" + PROMPT + "\n```\n\n  You should see it open the handoff file first. I can't start a session in another project's window.";
const handover = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /do it now and report what you did/.test(j.reason); } catch { return false; } };
const ONE_LINE = "**Needs you:** you need to paste `" + PROMPT + "` into a new chat in the other-project window.";
check("handover: a prompt to paste into another project's session is stopped once", handover(msg(HANDOVER)));
check("handover: the same, as one line with inline code", handover(msg(ONE_LINE)));
check("handover: not treated as a shell command", !blocks(msg(HANDOVER)) && !blocks(msg(ONE_LINE)));
const REAL_HANDOVER = "All four ticked items are routed.\n\n### Needs you\n\n1. **In the demo-videos window** (already open), start a new session and paste:\n   ```\n   Read C:\\work\\handoffs\\2026-10-02-example-handoff.md and carry it out.\n   ```\n   You should see two new bullets in its `CLAUDE.md`.";
check("handover: the real example (ticked changes turned into a prompt to paste)", handover(msg(REAL_HANDOVER)));
check("handover silent: stop_hook_active (the second try goes through)", run({ last_assistant_message: HANDOVER, stop_hook_active: true }) === "");
check("handover silent: the reply says what needs a session there",
  msg(HANDOVER + " The render needs a session there: the `/make-video` skill only loads in that project.") === "");
check("handover silent: RUN_YOURSELF=off", run({ last_assistant_message: HANDOVER }, { RUN_YOURSELF: "off" }) === "");
check("handover silent: a command shown as proof next to a project's name",
  msg("Done. The session in the demo-videos project window ran `npm run lint` and it passed.") === "");
check("fires: 'paste this into a new session' with no other project named", blocks(msg("You need to paste this into a new session:\n```\n" + PROMPT + "\n```")));
check("fires: a terminal command is still a command, even next to a project window", blocks(msg("Open a terminal in the other-project project window and run:\n```\nnode run-tests.mjs --all\n```")));

// A vague "Needs you" item: something to send, paste, type or run, without the text
const vague = (out) => { try { const j = JSON.parse(out); return j.decision === "block" && /without giving the exact text/.test(j.reason); } catch { return false; } };
check("vague: the real example ('tell it to read the handoff file')", vague(msg("The handoff is written.\n\n**Needs you:** Start a session in other-project and tell it to read the handoff file; I could open the window but not start the session there.")));
check("vague: 'send the handoff'", vague(msg("### Needs you\n\n- Now it's only left to send the handoff to the new session.")));
check("vague: 'run the login command'", vague(msg("### Needs you\n- Run the login command, then tell me when it's done.")));
check("vague: 'point it at the file', path in code is not the prompt", vague(msg("### Needs you\n1. Open a new chat and point it at `C:\\work\\handoffs\\x.md`.")));
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
  run({ transcript_path: tFile("d.jsonl", [userSaid("/handoff C:\\work\\other-project"), ...said]) }) === "");
check("handover transcript: 'do a hand-off to that project' -> silent",
  run({ transcript_path: tFile("e.jsonl", [userSaid("ok do a hand-off to that project"), ...said]) }) === "");
check("handover transcript: the user ticked changes, did not ask for a handoff -> stopped",
  handover(run({ transcript_path: tFile("f.jsonl", [userSaid("set up what's ticked"), ...said]) })));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
