// The commit-loaded patch: on Nimbalyst 0.83.0's own list code, the commit tool gets the always-load mark after the
// patch and not before; the other core tools keep theirs; the patch's anchor and replace keep its own rules.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { default: patch } = await import(
  pathToFileURL(
    path.join(REPO, "tools", "nimbalyst-patch", "patches", "commit-loaded.mjs"),
  ).href
);

let failed = 0;
function ok(name, got, want) {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) failed++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`}`,
  );
}

// As in out/main/index.js of 0.83.0
const MAIN = `const MCP_CORE = "nimbalyst";
const CORE_ALWAYS_LOAD_TOOLS = [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "update_session_meta"
];
const ALWAYS_LOAD_META_KEY = "anthropic/alwaysLoad";
function applyCoreAlwaysLoadMeta(tools, configKey) {
  if (configKey !== MCP_CORE) return tools;
  const eager = new Set(CORE_ALWAYS_LOAD_TOOLS);
  return tools.map(
    (tool) => eager.has(tool.name) ? { ...tool, _meta: { [ALWAYS_LOAD_META_KEY]: true } } : tool
  );
}
return applyCoreAlwaysLoadMeta;`;

const CORE = [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "capture_editor_screenshot",
  "get_session_edited_files",
  "developer_git_commit_proposal",
  "update_session_meta",
];
const loaded = (code) =>
  new Function(code)()(
    CORE.map((name) => ({ name })),
    "nimbalyst",
  )
    .filter((t) => t._meta?.["anthropic/alwaysLoad"])
    .map((t) => t.name);

const [edit] = patch.edits;
ok("one edit", patch.edits.length, 1);
ok("its anchor is in 0.83.0's main once", MAIN.split(edit.anchor).length, 2);
const patched = MAIN.replace(edit.anchor, edit.replace);
ok(
  "before: the commit tool waits for a lookup",
  loaded(MAIN).includes("developer_git_commit_proposal"),
  false,
);
ok("after: loaded with the session, the others as before", loaded(patched), [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "developer_git_commit_proposal",
  "update_session_meta",
]);
ok(
  "the replace text and the upstream text are not in the unpatched main",
  [MAIN.includes(edit.replace), MAIN.includes(patch.upstream)],
  [false, false],
);
ok(
  "the patched main does not read as retired",
  patched.includes(patch.upstream),
  false,
);
ok("only main files", patch.files.test("out/main/index.js"), true);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
