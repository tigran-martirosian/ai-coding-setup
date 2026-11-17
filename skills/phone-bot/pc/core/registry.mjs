// The action list. Each file in ../actions/ exports register(registry) and calls
// registry.add({ name, input, run }). The phone can ask for nothing else: any other name is
// answered "not-offered". Inputs are checked here before `run` sees them.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { log } from "./log.mjs";

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

export function createRegistry() {
  const actions = new Map();
  let source = "(code)";

  const registry = {
    add({ name, input = {}, run }) {
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
      actions.set(name, { name, input, run, source });
    },

    names: () => [...actions.keys()].sort(),

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

    // req is the opened body { k: "req", id, a, d }; ctx is { device, page, push }. Returns the res body.
    async handle(req, ctx) {
      const id = typeof req.id === "string" ? req.id.slice(0, 64) : null;
      const answer = (ok, rest) => ({ k: "res", id, ok, ...rest });
      const action = actions.get(req.a);
      if (!action) {
        log("refused", `not-offered ${String(req.a).slice(0, 40)}`);
        return answer(false, { err: "not-offered" });
      }
      try {
        const d = checkInput(action.input, req.d);
        return answer(true, { d: await action.run(d, ctx) });
      } catch (e) {
        if (e instanceof ActionError) {
          log("refused", `${e.err} ${action.name}`);
          return answer(false, { err: e.err, ...e.extra });
        }
        if (e.code === "file-refused")
          return answer(false, { err: "file-refused" });
        log("error", `${action.name}: ${e.message}`);
        return answer(false, { err: "failed", message: e.message });
      }
    },
  };
  return registry;
}
