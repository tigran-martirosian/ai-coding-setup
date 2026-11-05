// Which model and effort each helper runs on: read from the log the agent-run-log hook appends to
// (~/.claude/state/agent-runs.jsonl, one JSON line per helper). Pure parts first, then the reader.
// build.mjs inlines this file into dist/index.js, so it must not import anything.

const EXTENSION_ID = 'com.local.agentspanel';
const LOG_LINES = 200;
// node finds the home folder on every system and prints the last lines; a missing file is a non-zero exit.
// The script has no double quotes, so it sits inside the double-quoted command as is.
const READ_COMMAND = `node -e "const f=require('path').join(require('os').homedir(),'.claude','state','agent-runs.jsonl');process.stdout.write(require('fs').readFileSync(f,'utf8').split(String.fromCharCode(10)).slice(-${LOG_LINES}).join(String.fromCharCode(10)))"`;

let warned = false;

/** The log's lines as objects, oldest first; a line that is not a JSON object with a description is skipped. */
function parseRuns(text) {
  const runs = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let run;
    try {
      run = JSON.parse(line);
    } catch {
      continue;
    }
    if (run && typeof run === 'object' && typeof run.description === 'string') runs.push(run);
  }
  return runs;
}

/** For each row description, the newest log line with the same trimmed description that no earlier row
 *  claimed, or null. `runs` is oldest first, as the log is. */
function matchRun(rows, runs) {
  const claimed = new Set();
  return rows.map((description) => {
    const want = description.trim();
    for (let i = runs.length - 1; i >= 0; i--) {
      if (claimed.has(i) || runs[i].description.trim() !== want) continue;
      claimed.add(i);
      return runs[i];
    }
    return null;
  });
}

/** The log's last lines parsed, or null when it cannot be read (said once in the console, never to the user). */
async function readRuns() {
  try {
    const r = await window.electronAPI.invoke('extension:exec', { extensionId: EXTENSION_ID, command: READ_COMMAND, timeout: 10000 });
    if (!r.success) throw new Error((r.stderr || '').trim().split('\n').pop() || `exit code ${r.exitCode}`);
    return parseRuns(r.stdout);
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn('[agents-panel] could not read the helper run log, rows show no model:', e);
    }
    return null;
  }
}

export { parseRuns, matchRun, readRuns };
