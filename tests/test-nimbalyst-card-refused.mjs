// card-refused patch: on a temp copy of the installed app.asar (the unpatched app.asar.orig when there), the
// patch applies once with the other real patches, a second run changes nothing, and the patched chunk still
// passes node --check. The new decision function is cut out of the patched chunk and run: a question card or
// form whose error holds the marker is hidden, any other blocked card and a normal call are not. The container
// edit is checked on the source: it returns null before the widget is drawn and after the last hook.
// Skips when Nimbalyst is not installed (CI runners).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "..", "tools", "nimbalyst-patch");
const MARKER = "[card-refused]";

const res =
  process.env.LOCALAPPDATA &&
  path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst", "resources");
const REAL =
  res &&
  (fs.existsSync(path.join(res, "app.asar.orig"))
    ? path.join(res, "app.asar.orig")
    : path.join(res, "app.asar"));
if (!REAL || !fs.existsSync(REAL)) {
  console.log(`skipped: Nimbalyst is not installed (no app.asar at ${REAL})`);
  process.exit(0);
}

const { readAsar, readEntry, plan, compileCheck, writeAsar, loadPatches } =
  await import(pathToFileURL(path.join(TOOL, "patch.mjs")).href);

let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `: ${detail}`}`,
  );
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-card-refused-"));
try {
  const copy = path.join(T, "app.asar");
  fs.copyFileSync(REAL, copy);
  const all = await loadPatches(path.join(TOOL, "patches"));
  const mine = all.filter((p) => p.id === "card-refused");
  check("the patch loads from the patches folder", mine.length === 1);

  // 1. with all real patches on the unpatched copy: would apply, one chunk changed, which still parses
  const asar = readAsar(copy);
  const first = plan(asar, all);
  const st = first.results.find((r) => r.id === "card-refused");
  check(
    "on the installed app.asar copy: would apply, to the one registerExtensionSystem chunk",
    st?.state === "would apply" &&
      st.files.length === 1 &&
      /^out\/renderer\/assets\/registerExtensionSystem-[\w-]+\.js$/.test(st.files[0]),
    JSON.stringify(st),
  );
  const errors = compileCheck(first.changed);
  check("the patched files pass the patcher's compile check", !errors.length, errors.join("; "));

  // 2. written once, a second run changes nothing
  const once = path.join(T, "app.asar.once");
  writeAsar(asar, first.changed, once);
  const again = plan(readAsar(once), mine);
  check(
    "a second run: already applied, nothing to change",
    again.results[0].state === "applied" && again.changed.size === 0,
    JSON.stringify(again.results[0]),
  );

  // 3. the patched chunk: each edit replaced once
  const chunk = readEntry(readAsar(once), st.files[0]).toString("utf8");
  const count = (s) => chunk.split(s).length - 1;
  check(
    "each edit is in the patched chunk once and its anchor gone",
    mine[0].edits.every((e) => count(e.replace) === 1 && count(e.anchor) === 0),
  );

  // 4. run the decision: cut the functions it calls out of the patched chunk
  const fnSource = (name) => {
    const m = chunk.match(new RegExp(`^function ${name.replace(/\$/g, "\\$")}\\([\\s\\S]*?^}$`, "m"));
    if (!m) throw new Error(`function ${name} not found in ${st.files[0]}`);
    return m[0];
  };
  const constSource = (name, end) => {
    const i = chunk.indexOf(`const ${name} = `);
    if (i < 0) throw new Error(`const ${name} not found in ${st.files[0]}`);
    return chunk.slice(i, chunk.indexOf(end, i) + end.length);
  };
  const ctx = vm.createContext({});
  vm.runInContext(
    [
      constSource("ANSWERABLE_ERROR", "];"),
      constSource("PERMISSION_DENIAL$1", ";\n"),
      ...["stripMcpPrefix", "toolResultText", "parseStructuredCancel", "erroredQuestionOutcome", "refusedQuestionCard"].map(fnSource),
      "this.refused = refusedQuestionCard; this.outcome = erroredQuestionOutcome;",
    ].join("\n"),
    ctx,
  );
  const call = (toolName, result, isError = true) => ({ toolName, result, isError, status: isError ? "error" : "completed", providerToolCallId: "toolu_test" });
  const refusal = (tool) => `PreToolUse:${tool} hook error: ${MARKER} test refusal`;
  const hidden = [
    ["the Nimbalyst card", call("mcp__nimbalyst__AskUserQuestion", refusal("mcp__nimbalyst__AskUserQuestion"))],
    ["the plain AskUserQuestion", call("AskUserQuestion", refusal("AskUserQuestion"))],
    ["the form", call("mcp__nimbalyst__PromptForUserInput", refusal("mcp__nimbalyst__PromptForUserInput"))],
    ["the form under its old name", call("RequestUserInput", refusal("RequestUserInput"))],
    ["a result as text blocks", call("mcp__nimbalyst__AskUserQuestion", [{ type: "text", text: refusal("mcp__nimbalyst__AskUserQuestion") }])],
  ];
  for (const [what, c] of hidden)
    check(`a refusal with the marker hides ${what}`, ctx.refused(c) === true, JSON.stringify(ctx.outcome(c)));
  const other = call("mcp__nimbalyst__AskUserQuestion", "PreToolUse:mcp__nimbalyst__AskUserQuestion hook error: some other reason");
  check(
    "another hook error: not hidden, still the blocked card with its text",
    ctx.refused(other) === false && ctx.outcome(other)?.kind === "blocked" && /some other reason/.test(ctx.outcome(other).reason),
  );
  const quoted = call("mcp__nimbalyst__AskUserQuestion", `PreToolUse:mcp__nimbalyst__AskUserQuestion hook error: other-hook refused a card quoting ${MARKER}`);
  check("another hook's error that only quotes the marker: not hidden", ctx.refused(quoted) === false);
  const normal = call("mcp__nimbalyst__AskUserQuestion", JSON.stringify({ answers: { q: "Yes" } }), false);
  check("a normal answered call: not hidden, not blocked", ctx.refused(normal) === false && ctx.outcome(normal) === null);
  check(
    "the marker in a normal result: not hidden",
    ctx.refused(call("AskUserQuestion", `answer quoting ${MARKER}`, false)) === false,
  );
  check(
    "the user's own denial: not hidden (stays the cancelled card)",
    ctx.refused(call("AskUserQuestion", `The user doesn't want to take this action ${MARKER}`)) === false,
  );
  check(
    "another tool's error with the marker: not hidden",
    ctx.refused(call("Bash", refusal("Bash"))) === false,
  );

  // 5. the container: returns null after its last hook and before it draws the widget (source inspected)
  const start = chunk.indexOf("const TranscriptToolCard = ");
  const at = chunk.indexOf("  if (refusedQuestionCard(tool)) return null;\n", start);
  const end = chunk.slice(at).search(/\n(const|function|let|var) /);
  const after = chunk.slice(at, at + end);
  check(
    "TranscriptToolCard returns null for a refused card before its widget container, with no hook after it",
    start >= 0 &&
      at > chunk.indexOf("  if (!tool) return null;", start) &&
      after.indexOf("if (CustomWidget) {") > 0 &&
      after.indexOf("if (CustomWidget) {") < after.indexOf("rich-transcript-tool-container") &&
      !/\buse[A-Z]\w*\(/.test(after),
    `start ${start}, at ${at}`,
  );
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
