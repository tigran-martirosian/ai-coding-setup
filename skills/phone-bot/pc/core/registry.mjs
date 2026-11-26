// The action list. Each file in ../actions/ exports register(registry) and calls
// registry.add({ name, input, run }). The phone can ask for nothing else: any other name is
// answered "not-offered". Inputs are checked here before `run` sees them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "./log.mjs";
import { appDir } from "./mode.mjs";
import { createSentIds, MID_INPUT } from "./sent-ids.mjs";

// An answer with ok: false. `extra` adds fields such as { field } or { tool }.
export class ActionError extends Error {
  constructor(err, extra = {}) {
    super(err);
    this.err = err;
    this.extra = extra;
  }
}

const NAME = /^[a-z]+(\.[a-z]+)+$/;

// input: { field: { type: "string", min, max, pattern } | { type: "boolean" } | { type: "integer", min, max } |
// { type: "list", min, max, item: <a string rule> } }, a field with `optional: true` may be left out.
function checkInput(spec, d) {
  const data = d === undefined ? {} : d;
  if (typeof data !== "object" || data === null || Array.isArray(data))
    throw new ActionError("bad-input", { field: "d" });
  for (const k of Object.keys(data))
    if (!Object.hasOwn(spec, k))
      throw new ActionError("bad-input", { field: k });
  for (const [k, rule] of Object.entries(spec)) {
    const v = data[k];
    const bad = () => new ActionError("bad-input", { field: k });
    if (v === undefined) {
      if (rule.optional) continue;
      throw bad();
    }
    if (rule.type === "string") {
      if (typeof v !== "string") throw bad();
      if (v.length < (rule.min ?? 0) || v.length > rule.max) throw bad();
      if (rule.pattern && !rule.pattern.test(v)) throw bad();
    } else if (rule.type === "integer") {
      if (!Number.isSafeInteger(v) || v < rule.min || v > rule.max) throw bad();
    } else if (rule.type === "boolean") {
      if (typeof v !== "boolean") throw bad();
    } else if (rule.type === "list") {
      if (!Array.isArray(v) || v.length < rule.min || v.length > rule.max)
        throw bad();
      for (const x of v) checkInput({ [k]: rule.item }, { [k]: x });
    } else throw new Error(`unknown input type "${rule.type}" for "${k}"`);
  }
  return data;
}

const WIN = process.platform === "win32";
// An absolute path in quotes: Node's and PowerShell's messages quote the paths they name.
const QUOTED_PATH = /(['"])((?:[A-Za-z]:[\\/]|[\\/]{2}|\/)[^'"\r\n]*)\1/g;

// A folder as a pattern: either slash between its parts, any case on Windows, and only the whole last name (a home
// folder named "an" never matches one named "anna").
function folderPattern(dir) {
  const parts = path
    .resolve(dir)
    .split(/[\\/]+/)
    .filter(Boolean);
  const text = parts
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\\\/]+");
  return new RegExp(
    `${WIN ? "" : "/"}${text}(?=[\\\\/'"\\s]|$)`,
    WIN ? "gi" : "g",
  );
}

// A text as the phone sees it: the PC's folders are not shown. Node puts full paths in its messages (EPERM, EBUSY,
// ENOENT: "rename 'C:\...\a.txt' -> 'C:\...\b.txt'"), PowerShell in its words. The paths an error names (`known`)
// and any quoted absolute path keep only their last names; the app folder and the home folder left in the text read
// <app folder> and ~. The PC log keeps the whole message.
function hidePaths(text, known = []) {
  let m = String(text);
  for (const p of known)
    if (typeof p === "string" && p) m = m.split(p).join(path.basename(p));
  m = m.replace(QUOTED_PATH, (_, q, p) => `${q}${path.basename(p)}${q}`);
  m = m.replace(folderPattern(appDir()), "<app folder>");
  return m.replace(folderPattern(os.homedir()), "~");
}

// The free-text fields of a refusal, with the PC's folders hidden.
function shownExtra(extra) {
  const out = { ...extra };
  for (const k of ["why", "message"])
    if (typeof out[k] === "string") out[k] = hidePaths(out[k]);
  return out;
}

function refusal(action, e) {
  if (e instanceof ActionError) {
    // relay-failed's reason (a message and a network code) is logged; other reasons may hold session labels,
    // another program's text or Telegram's, which pc.log never holds.
    const why = e.err === "relay-failed" ? `: ${e.extra.why}` : "";
    log("refused", `${e.err} ${action.name}${why}`);
    return { ok: false, err: e.err, ...shownExtra(e.extra) };
  }
  if (e.code === "file-refused") return { ok: false, err: "file-refused" };
  log("error", `${action.name}: ${e.message}`);
  return {
    ok: false,
    err: "failed",
    message: hidePaths(e.message, [e.path, e.dest]),
  };
}

export function createRegistry() {
  const actions = new Map();
  let source = "(code)";
  const once = createSentIds();

  const registry = {
    // `once`: the action takes an optional message id `mid` and runs once per device and id (core/sent-ids.mjs).
    add({ name, input = {}, run, once: onlyOnce = false }) {
      if (onlyOnce) input = { ...input, mid: MID_INPUT };
      if (!NAME.test(name || ""))
        throw new Error(`${source}: action name "${name}" is not area.verb`);
      if (typeof run !== "function")
        throw new Error(`${source}: action "${name}" has no run function`);
      for (const [k, rule] of Object.entries(input))
        if (
          (rule.type === "string" || rule.type === "list") &&
          !Number.isSafeInteger(rule.max)
        )
          throw new Error(`${source}: input "${k}" of "${name}" has no max`);
        else if (
          rule.type === "list" &&
          (rule.item?.type !== "string" || !Number.isSafeInteger(rule.item.max))
        )
          throw new Error(
            `${source}: list "${k}" of "${name}" has no string item with a max`,
          );
      const had = actions.get(name);
      if (had)
        throw new Error(
          `action "${name}" is registered by both ${had.source} and ${source}`,
        );
      actions.set(name, { name, input, run, source, once: onlyOnce });
    },

    names: () => [...actions.keys()].sort(),

    // True for an action whose input names a whole stream (folder.put, attach.put, voice.transcribe).
    takesStream: (name) =>
      Object.hasOwn(actions.get(name)?.input ?? {}, "stream"),

    // Imports every .mjs file of `dir`, sorted, and calls its register(registry).
    async load(dir) {
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".mjs"))
        .sort();
      for (const f of files) {
        const mod = await import(pathToFileURL(path.join(dir, f)).href);
        if (typeof mod.register !== "function")
          throw new Error(`${f} does not export register(registry)`);
        source = f;
        try {
          await mod.register(registry);
        } finally {
          source = "(code)";
        }
      }
    },

    // The hello says so: a page may give Send, Queue, Note and New session a message id (core/sent-ids.mjs).
    takesIds: true,

    // req is the opened body { k: "req", id, a, d }; ctx is { device, page, push }. Returns the res body.
    async handle(req, ctx) {
      const id = typeof req.id === "string" ? req.id.slice(0, 64) : null;
      const action = actions.get(req.a);
      if (!action) {
        log("refused", `not-offered ${String(req.a).slice(0, 40)}`);
        return { k: "res", id, ok: false, err: "not-offered" };
      }
      return { k: "res", id, ...(await outcome(action, req.d, ctx)) };
    },
  };

  // An action's answer without the request id: { ok: true, d } or { ok: false, err, ... }. An action added with
  // `once` runs once per device and message id; a repeat gets the first answer.
  async function outcome(action, data, ctx) {
    let d;
    try {
      d = checkInput(action.input, data);
    } catch (e) {
      return refusal(action, e);
    }
    if (!action.once || d.mid === undefined) return runOnce(action, d, ctx);
    const { mid, ...rest } = d;
    try {
      return await once(
        String(ctx.device),
        mid,
        action.name,
        () => runOnce(action, rest, ctx),
        {
          refuse: () =>
            refusal(action, new ActionError("bad-input", { field: "mid" })),
          unclear: () => refusal(action, new ActionError("send-unclear")),
        },
      );
    } catch (e) {
      return refusal(action, e);
    }
  }

  async function runOnce(action, d, ctx) {
    try {
      return { ok: true, d: await action.run(d, ctx) };
    } catch (e) {
      return refusal(action, e);
    }
  }
  return registry;
}
