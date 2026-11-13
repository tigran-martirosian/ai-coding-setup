// patch-next: SessionStart hook. Parallel sessions of one project that ship in the same release share one list,
// docs/patches/next.md (what, files, session id, status per line). Without it the user had to tell each session to
// tell the others what goes into the release (a user asked: "we need to have a place where all the new
// stuff gets uploaded"). When the open project has that file, this shows its Items section to every new session,
// so the session adds its own line and the deploying session ships every line. Projects without the file: silent.
// Subagents skip it. Fails open. PATCH_NEXT=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import path from "node:path";

const MAX = 4000;

try {
	if ((process.env.PATCH_NEXT || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
	if (event.agent_id) process.exit(0);
	const dir = process.env.CLAUDE_PROJECT_DIR || event.cwd;
	if (!dir) process.exit(0);
	const file = path.join(dir, "docs", "patches", "next.md");
	if (!fs.existsSync(file)) process.exit(0);
	const text = fs.readFileSync(file, "utf8");
	const at = text.indexOf("## Items");
	const all = at >= 0 ? text.slice(at) : text;
	const items = all.length > MAX ? all.slice(0, MAX) + "\n[list cut here: read the whole file before shipping]" : all;
	const note = "[patch-next] The next release's shared list, docs/patches/next.md. Anything you build for the next release gets "
		+ "its line there when you start (what, files, session id, status) and is updated when tested; don't keep it only in your "
		+ "reply or pass it to another session by message.\n" + items;
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: note } }));
} catch (err) {
	crashLog("patch-next", err);
	// Fail open
}
process.exit(0);
