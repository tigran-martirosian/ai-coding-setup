// node tests/test-phone-door-patch.mjs
// Tests the phone-door patch (tools/nimbalyst-patch/patches/phone-door.mjs): its shape, its anchors and the
// compiled result on the installed app's unpatched original (skipped when there is none, as on CI), and the
// new door tools' code, run in node:vm with stand-ins for the Nimbalyst functions it calls.
process.env.HOOK_ERRORS_LOG = "off";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const PATCHER = path.join(
  import.meta.dirname,
  "..",
  "tools",
  "nimbalyst-patch",
  "patch.mjs",
);
const PATCHES = path.join(path.dirname(PATCHER), "patches");
const { loadPatches, plan, readAsar, readEntry, compileCheck } = await import(
  pathToFileURL(PATCHER).href
);

// The plan part (answer_plan) is built: the plan-approval probe in
// docs/research/2026-11-14-phone-app-pc-probes.md (section 2) could not show a waiting plan approved through
// the door's respond_to_prompt, so plan approval from outside is unproven.
const PLAN_PART_BUILT = true;

let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 800)}`}`,
  );
}
const count = (text, s) => text.split(s).length - 1;

// 1. shape
const all = await loadPatches(PATCHES);
const door = all.find((p) => p.id === "phone-door");
check(
  "shape: phone-door loads with the main file, upstream null and seven edits",
  door &&
    door.files.test("out/main/index.js") &&
    !door.files.test("out/preload/index.js") &&
    door.upstream === null &&
    door.edits.length === 7,
  JSON.stringify(door && { files: String(door.files), n: door.edits.length }),
);
check(
  "shape: every replace text differs from its anchor",
  door.edits.every((e) => e.replace !== e.anchor),
);
const [, , E3, E4] = door.edits;

// 2. the plan part switch: the tool name in E1, E2 and E4, its function phoneDoorAnswerPlan in E3 (and E4)
const withPlan = door.edits.map((e) =>
  /answer_plan|phoneDoorAnswerPlan/.test(e.replace),
);
check(
  PLAN_PART_BUILT
    ? "plan part: E1, E2, E3 and E4 each hold answer_plan or phoneDoorAnswerPlan"
    : "plan part left out: no edit holds answer_plan",
  PLAN_PART_BUILT
    ? withPlan.slice(0, 4).every(Boolean) && !withPlan.slice(4).some(Boolean)
    : withPlan.every((x) => !x),
  JSON.stringify(withPlan),
);

// 3. against the installed app's unpatched original, with every patch of the folder planned together
const realRes =
  process.env.LOCALAPPDATA &&
  path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst", "resources");
const REAL = realRes && path.join(realRes, "app.asar.orig");
if (REAL && fs.existsSync(REAL)) {
  const asar = readAsar(REAL);
  const orig = readEntry(asar, "out/main/index.js").toString("utf8");
  const counts = door.edits.map((e) => count(orig, e.anchor));
  check(
    "real app: each of the seven anchors occurs once in the original main file",
    counts.every((n) => n === 1),
    JSON.stringify(counts),
  );
  check(
    "real app: no replace text and no phoneDoor name is in the original",
    door.edits.every((e) => !orig.includes(e.replace)) &&
      !orig.includes("phoneDoor"),
  );
  const { results, changed } = plan(asar, all);
  const res = results.find((r) => r.id === "phone-door");
  check(
    "real app: phone-door would apply to out/main/index.js",
    res?.state === "would apply" &&
      res.files.length === 1 &&
      res.files[0] === "out/main/index.js",
    JSON.stringify(res),
  );
  const errors = compileCheck(changed);
  check(
    "real app: the changed files compile with every patch planned",
    errors.length === 0,
    errors.join("\n"),
  );
  // 5. the kept handlers, on the planned main file
  const out = changed.get("out/main/index.js")?.text ?? "";
  const iCancel = out.indexOf(
    "phoneDoorHandlers.cancel = async (_event, sessionId, chunksReceived) => {",
  );
  const iDelete = out.indexOf(
    "phoneDoorHandlers.deleteQueued = async (event, promptId) => {",
  );
  const iUpdate = out.indexOf(
    "phoneDoorHandlers.updateSession = async (event, sessionId, updates) => {",
  );
  const iConst = out.indexOf("const phoneDoorHandlers = {};");
  check(
    "kept handlers: each is kept once, after const phoneDoorHandlers",
    count(out, "phoneDoorHandlers.cancel = async (_event") === 1 &&
      count(out, "phoneDoorHandlers.deleteQueued = async (event") === 1 &&
      count(out, "phoneDoorHandlers.updateSession = async (event") === 1 &&
      count(out, "const phoneDoorHandlers") === 1 &&
      iConst >= 0 &&
      iConst < iCancel &&
      iConst < iDelete &&
      iConst < iUpdate,
    JSON.stringify({ iConst, iCancel, iDelete, iUpdate }),
  );
  check(
    "real app: the new tools are in the tool list, the host route list and the dispatch",
    [
      "answer_form",
      "stop_session",
      "remove_queued_prompt",
      "answer_plan",
      "set_session_pinned",
    ].every(
      (n) =>
        out.includes(`name: "${n}",`) &&
        out.includes(`  "${n}",\n`) &&
        out.includes(`case "${n}":`),
    ),
  );
  check(
    "real app: set_session_pinned occurs 3 times and phoneDoorSetPinned twice",
    count(out, "set_session_pinned") === 3 &&
      count(out, "phoneDoorSetPinned") === 2,
    JSON.stringify([
      count(out, "set_session_pinned"),
      count(out, "phoneDoorSetPinned"),
    ]),
  );
} else console.log(`skip the real app checks: no app.asar.orig at ${REAL}`);

// 4. the tool code (E3 without its anchor, and E4's cases in a small dispatcher), run with stand-ins.
// Session s1 is in project ws (the route's project), s2 in another project. Form answers are keyed by field id.
const E3_CODE = E3.replace.slice(0, -E3.anchor.length);
const E4_CASES = E4.replace.slice(0, -E4.anchor.length);
function door4({ closed = () => false, rows = {} } = {}) {
  const calls = [];
  const log = (...a) => calls.push(a);
  let closedChecks = 0;
  const ctx = vm.createContext({
    AISessionsRepository: {
      get: async (id) =>
        ({
          s1: { id: "s1", workspacePath: "ws" },
          s2: { id: "s2", workspacePath: "other" },
        })[id] ?? null,
      updateMetadata: async (...a) => log("updateMetadata", ...a),
    },
    sameWorkspaceIdentity: (stored, ws) => stored === ws,
    getQueuedPromptsStore: () => ({ get: async (id) => rows[id] ?? null }),
    notifyAllWindows: (...a) => log("notify", ...a),
    handleRequestUserInputResponse: async (...a) => log("formHandler", ...a),
    isInteractivePromptClosed: async () => closed(++closedChecks),
    handleExitPlanModeResponse: (...a) => log("planHandler", ...a),
    setTimeout: (fn) => {
      log("timer");
      fn();
    },
  });
  const fns = vm.runInContext(
    `${E3_CODE}
async function dispatch(name, args) {
  const effectiveWorkspaceId = "ws";
  switch (name) {
${E4_CASES}    default:
      return "other:" + name;
  }
}
({ phoneDoorHandlers, dispatch });`,
    ctx,
  );
  return { ...fns, calls, of: (k) => calls.filter((c) => c[0] === k) };
}
const errorOf = async (p) => {
  try {
    await p;
    return "";
  } catch (e) {
    return e.message;
  }
};
const TOOLS = [
  "answer_form",
  "stop_session",
  "remove_queued_prompt",
  ...(PLAN_PART_BUILT ? ["answer_plan"] : []),
  "set_session_pinned",
];
const WITH_PROMPT = TOOLS.filter(
  (t) => t !== "stop_session" && t !== "set_session_pinned",
);

let d = door4();
const foreign = [];
for (const t of TOOLS)
  for (const s of ["s2", "nope"])
    foreign.push(
      await errorOf(
        d.dispatch(t, { sessionId: s, promptId: "p1", approved: true }),
      ),
    );
check(
  "every tool: a session of another project or an unknown one gives Session ... not found",
  foreign.every((m, i) => m === `Session ${i % 2 ? "nope" : "s2"} not found`) &&
    d.calls.length === 0,
  JSON.stringify(foreign),
);
const noSession = [];
for (const t of TOOLS) noSession.push(await errorOf(d.dispatch(t, {})));
for (const t of TOOLS) noSession.push(await errorOf(d.dispatch(t, undefined)));
const noPrompt = [];
for (const t of WITH_PROMPT)
  noPrompt.push(await errorOf(d.dispatch(t, { sessionId: "s1", answers: {} })));
check(
  "every tool: a missing sessionId or promptId gives ... is required",
  noSession.every((m) => m === "sessionId is required") &&
    noPrompt.every((m) => m === "promptId is required") &&
    d.calls.length === 0,
  JSON.stringify({ noSession, noPrompt }),
);
check(
  "dispatch: a name that is not a phone-door tool still reaches the next case",
  (await d.dispatch("respond_to_prompt", {})) === "other:respond_to_prompt",
);

// answer_form
d = door4({ closed: () => true });
let m = await errorOf(
  d.dispatch("answer_form", { sessionId: "s1", promptId: "p1", answers: {} }),
);
check(
  "answer_form: a closed form gives This form is already closed. and the handler is not called",
  m === "This form is already closed." && d.of("formHandler").length === 0,
  m,
);
d = door4({ closed: (n) => n >= 2 });
let out = await d.dispatch("answer_form", {
  sessionId: "s1",
  promptId: "p1",
  answers: { color: "blue" },
});
check(
  "answer_form: the form closing on the second check returns closed: true, the answers go to the handler once",
  JSON.parse(out).closed === true &&
    JSON.parse(out).cancelled === false &&
    JSON.stringify(d.of("formHandler")) ===
      JSON.stringify([
        [
          "formHandler",
          "s1",
          "p1",
          { answers: { color: "blue" }, cancelled: false },
        ],
      ]) &&
    d.of("timer").length === 0,
  JSON.stringify({ out, calls: d.calls }),
);
d = door4();
m = await errorOf(
  d.dispatch("answer_form", { sessionId: "s1", promptId: "p1", answers: {} }),
);
check(
  "answer_form: a form that never closes throws the 5 s error after 25 waits",
  m ===
    "The answer was sent, but the form did not close within 5 s. Look at the form on the PC." &&
    d.of("formHandler").length === 1 &&
    d.of("timer").length === 25,
  JSON.stringify({ m, timers: d.of("timer").length }),
);
d = door4({ closed: (n) => n >= 2 });
out = await d.dispatch("answer_form", {
  sessionId: "s1",
  promptId: "p1",
  answers: { color: "blue" },
  cancelled: true,
});
check(
  "answer_form: cancelled: true passes answers: {}",
  JSON.parse(out).cancelled === true &&
    JSON.stringify(d.of("formHandler")[0]?.[3]) ===
      JSON.stringify({ answers: {}, cancelled: true }),
  JSON.stringify(d.calls),
);
d = door4({ closed: (n) => n >= 2 });
const badAnswers = [];
for (const answers of [undefined, null, ["blue"], "blue"])
  badAnswers.push(
    await errorOf(
      d.dispatch("answer_form", { sessionId: "s1", promptId: "p1", answers }),
    ),
  );
check(
  "answer_form: answers missing or not an object, and not cancelled, throws",
  badAnswers.every((x) => x === "answers must be an object of field values") &&
    d.of("formHandler").length === 0,
  JSON.stringify(badAnswers),
);

// stop_session
d = door4();
m = await errorOf(d.dispatch("stop_session", { sessionId: "s1" }));
check(
  "stop_session: without a kept Stop handler it throws",
  m === "Nimbalyst's Stop handler is not registered" && d.calls.length === 0,
  m,
);
d = door4();
let stopArgs = null;
d.phoneDoorHandlers.cancel = async (...a) => {
  stopArgs = a;
  return { success: true };
};
out = await d.dispatch("stop_session", { sessionId: "s1" });
check(
  "stop_session: calls the kept handler with (null, sessionId, 0) and sends ai:sessionCancelled",
  JSON.stringify(stopArgs) === JSON.stringify([null, "s1", 0]) &&
    JSON.parse(out).stopped === true &&
    JSON.stringify(d.of("notify")) ===
      JSON.stringify([["notify", "ai:sessionCancelled", { sessionId: "s1" }]]),
  JSON.stringify({ stopArgs, out, calls: d.calls }),
);
d = door4();
d.phoneDoorHandlers.cancel = async () => ({
  success: false,
  error: "No active terminal for session",
});
m = await errorOf(d.dispatch("stop_session", { sessionId: "s1" }));
d.phoneDoorHandlers.cancel = async () => undefined;
const m2 = await errorOf(d.dispatch("stop_session", { sessionId: "s1" }));
check(
  "stop_session: the handler's error is passed on and nothing is sent to the windows",
  m === "No active terminal for session" &&
    m2 === "Stop failed" &&
    d.of("notify").length === 0,
  JSON.stringify({ m, m2, calls: d.calls }),
);

// remove_queued_prompt
const ROWS = {
  q1: { id: "q1", sessionId: "s1", status: "pending" },
  q2: { id: "q2", sessionId: "s3", status: "pending" },
  q3: { id: "q3", sessionId: "s1", status: "executing" },
};
d = door4({ rows: ROWS });
m = await errorOf(
  d.dispatch("remove_queued_prompt", { sessionId: "s1", promptId: "q1" }),
);
check(
  "remove_queued_prompt: without a kept delete handler it throws",
  m === "Nimbalyst's queue handler is not registered",
  m,
);
const deleted = [];
d.phoneDoorHandlers.deleteQueued = async (...a) => {
  deleted.push(a);
  return { success: true };
};
const refused = [];
for (const promptId of ["q2", "q3", "q9"])
  refused.push(
    await errorOf(
      d.dispatch("remove_queued_prompt", { sessionId: "s1", promptId }),
    ),
  );
check(
  "remove_queued_prompt: a row of another session, a row that is not pending and a missing row are refused",
  refused[0] === "Queued prompt q2 not found in session s1" &&
    refused[1] === "Queued prompt q3 is executing: it was already sent" &&
    refused[2] === "Queued prompt q9 not found in session s1" &&
    deleted.length === 0 &&
    d.of("notify").length === 0,
  JSON.stringify(refused),
);
out = await d.dispatch("remove_queued_prompt", {
  sessionId: "s1",
  promptId: "q1",
});
check(
  "remove_queued_prompt: a pending row of the session is deleted by the kept handler and the windows reload the queue",
  JSON.stringify(deleted) === JSON.stringify([[null, "q1"]]) &&
    JSON.parse(out).removed === true &&
    JSON.stringify(d.of("notify")) ===
      JSON.stringify([
        [
          "notify",
          "ai:queuedPromptsReceived",
          { sessionId: "s1", promptCount: 0 },
        ],
      ]),
  JSON.stringify({ deleted, out, calls: d.calls }),
);

// answer_plan
if (PLAN_PART_BUILT) {
  d = door4();
  const badApproved = [];
  for (const approved of [undefined, "true", 1])
    badApproved.push(
      await errorOf(
        d.dispatch("answer_plan", {
          sessionId: "s1",
          promptId: "p1",
          approved,
        }),
      ),
    );
  check(
    "answer_plan: approved that is not a boolean throws",
    badApproved.every((x) => x === "approved must be true or false") &&
      d.calls.length === 0,
    JSON.stringify(badApproved),
  );
  out = await d.dispatch("answer_plan", {
    sessionId: "s1",
    promptId: "p1",
    approved: true,
    feedback: "go",
  });
  check(
    "answer_plan: approval calls the plan handler and sets mode agent",
    JSON.parse(out).approved === true &&
      JSON.stringify(d.calls) ===
        JSON.stringify([
          [
            "planHandler",
            "s1",
            "p1",
            { approved: true, feedback: "go", startNewSession: false },
          ],
          ["updateMetadata", "s1", { mode: "agent" }],
        ]),
    JSON.stringify(d.calls),
  );
  d = door4();
  out = await d.dispatch("answer_plan", {
    sessionId: "s1",
    promptId: "p1",
    approved: false,
    feedback: "change step 2",
    startNewSession: true,
  });
  check(
    "answer_plan: rejection calls the plan handler and does not change the mode",
    JSON.parse(out).approved === false &&
      JSON.stringify(d.calls) ===
        JSON.stringify([
          [
            "planHandler",
            "s1",
            "p1",
            {
              approved: false,
              feedback: "change step 2",
              startNewSession: true,
            },
          ],
        ]),
    JSON.stringify(d.calls),
  );
}

// set_session_pinned
d = door4();
const pinCalls = [];
d.phoneDoorHandlers.updateSession = async (...a) => {
  pinCalls.push(a);
  return { success: true };
};
const badPinned = [];
for (const pinned of [undefined, "true", 1])
  badPinned.push(
    await errorOf(
      d.dispatch("set_session_pinned", { sessionId: "s1", pinned }),
    ),
  );
check(
  "set_session_pinned: pinned that is not a boolean throws and does not call the handler",
  badPinned.every((x) => x === "pinned must be true or false") &&
    pinCalls.length === 0,
  JSON.stringify(badPinned),
);
const pinOuts = [];
for (const pinned of [true, false])
  pinOuts.push(
    JSON.parse(
      await d.dispatch("set_session_pinned", { sessionId: "s1", pinned }),
    ),
  );
check(
  "set_session_pinned: true and false call the kept update handler with isPinned",
  JSON.stringify(pinOuts) ===
    JSON.stringify([
      { sessionId: "s1", pinned: true },
      { sessionId: "s1", pinned: false },
    ]) &&
    JSON.stringify(pinCalls) ===
      JSON.stringify([
        [null, "s1", { isPinned: true }],
        [null, "s1", { isPinned: false }],
      ]) &&
    d.calls.length === 0,
  JSON.stringify({ pinOuts, pinCalls }),
);
d.phoneDoorHandlers.updateSession = async () => ({
  success: false,
  error: "x",
});
m = await errorOf(
  d.dispatch("set_session_pinned", { sessionId: "s1", pinned: true }),
);
check("set_session_pinned: a handler refusal is passed on", m === "x", m);
d = door4();
m = await errorOf(
  d.dispatch("set_session_pinned", { sessionId: "s1", pinned: true }),
);
check(
  "set_session_pinned: without a kept handler it throws ... is not registered",
  m === "Nimbalyst's session update handler is not registered",
  m,
);

console.log(
  failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
);
process.exit(failed ? 1 : 0);
