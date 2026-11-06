// patch-next: SessionStart hook. Parallel sessions of one project that ship in the same release share one list,
// docs/patches/next.md (what, files, session id, status per line), so each session knows what goes into the release.
// When the open project has that file, this shows its Items section to every new session,
// so the session adds its own line and the deploying session ships every line. Projects without the file: silent.
// Subagents skip it. Fails open. PATCH_NEXT=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import fs from "node:fs";
import path from "node:path";

const MAX = 4000;

runHook("patch-next", (event) => {
  if (event.agent_id) return;
  const dir = process.env.CLAUDE_PROJECT_DIR || event.cwd;
  if (!dir) return;
  const file = path.join(dir, "docs", "patches", "next.md");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf("## Items");
  const all = at >= 0 ? text.slice(at) : text;
  const items = all.length > MAX ? all.slice(0, MAX) + "\n[list cut here: read the whole file before shipping]" : all;
  const note = "[patch-next] The next release's shared list, docs/patches/next.md. Anything you build for the next release gets "
    + "its line there when you start (what, files, session id, status) and is updated when tested; don't keep it only in your "
    + "reply or pass it to another session by message.\n" + items;
  emit.context("SessionStart", note);
});
