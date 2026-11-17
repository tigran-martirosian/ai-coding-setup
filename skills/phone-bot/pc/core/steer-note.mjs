// A phone Note takes the desktop Note button's path: steer.mjs (skills/steer, beside this skill in the repo and in
// ~/.claude) puts it where the busy session reads it before its next step. Node runs it with fixed arguments and no
// shell; the note goes in on stdin. Answers steer's exit code and its words.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const STEER = fileURLToPath(
  new URL("../../../steer/steer.mjs", import.meta.url),
);

export function steerNote(sessionId, text) {
  // Started from a Claude chat, this program carries that chat's id: steer would take the chat for the sender (and
  // refuse a big session, as a session's own notes are). The desktop button sends with no sender, so does the phone.
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [STEER, "send", "--to", sessionId, "-", "--nowait"],
      { encoding: "utf8", timeout: 30000, windowsHide: true, env },
      (error, stdout, stderr) => {
        const code = child.exitCode ?? (error ? null : 0);
        const words =
          `${stdout || ""}${stderr || ""}${code === null && error ? error.message : ""}`
            .trim()
            .replace(/\s+/g, " ")
            .replace(/^NOT SENT:?\s*/i, "")
            .slice(0, 240);
        resolve({ code, words });
      },
    );
    child.stdin.end(text);
  });
}
