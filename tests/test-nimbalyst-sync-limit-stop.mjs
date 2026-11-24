// The sync-limit-stop patch: on Nimbalyst 0.83.0's own error-code lists, a session's storage_limit_exceeded turns
// its sync off after the patch and is skipped one message at a time before it; an oversized single message stays
// skippable; the patch's anchor and replace keep its own rules.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { default: patch } = await import(
  pathToFileURL(
    path.join(
      REPO,
      "scripts",
      "nimbalyst-patch",
      "patches",
      "sync-limit-stop.mjs",
    ),
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

// As in out/main/index.js of 0.83.0, with the server-error branch of handleServerMessage
const MAIN = `const FATAL_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_limit_exceeded"
]);
const SKIPPABLE_MESSAGE_SYNC_ERROR_CODES = /* @__PURE__ */ new Set([
  "message_too_large",
  "storage_limit_exceeded"
]);
function isFatalMessageSyncErrorCode(code2) {
  return code2 !== void 0 && FATAL_MESSAGE_SYNC_ERROR_CODES.has(code2);
}
function isSkippableMessageSyncErrorCode(code2) {
  return code2 !== void 0 && SKIPPABLE_MESSAGE_SYNC_ERROR_CODES.has(code2);
}
return (code) => isFatalMessageSyncErrorCode(code) ? "sync off" : isSkippableMessageSyncErrorCode(code) ? "skipped" : "error shown";`;

const outcome = (code, src) => new Function(src)()(code);

const [edit] = patch.edits;
ok("one edit", patch.edits.length, 1);
ok("its anchor is in 0.83.0's main once", MAIN.split(edit.anchor).length, 2);
const patched = MAIN.replace(edit.anchor, edit.replace);
ok(
  "before: a session over the size cap is skipped message by message",
  outcome("storage_limit_exceeded", MAIN),
  "skipped",
);
ok(
  "after: a session over the size cap stops its sync",
  outcome("storage_limit_exceeded", patched),
  "sync off",
);
ok(
  "after: one oversized message is still only skipped, the count cap still stops sync, others still show",
  [
    outcome("message_too_large", patched),
    outcome("message_limit_exceeded", patched),
    outcome("rate_limited", patched),
  ],
  ["skipped", "sync off", "error shown"],
);
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
