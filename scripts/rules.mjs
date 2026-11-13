// ~/.claude/CLAUDE.md, the global rules from rules/CLAUDE.md, always written whole. A rules file the user
// changed is carved first (scripts/blocks.mjs): blocks that are this version's or an older version's setup
// text go, the user's own blocks are appended to ~/.claude/rules/my-rules.md (which Claude Code loads in
// every session too), and the file before the run stays as a dated copy. Each file the carve changed goes on
// ctx.rulesUndo ({file, copy}, copy null for a file the run created), saved as state.rulesUndo.
// Shipped rules a person never needs are filtered out after the carve (rules/conditions.json, --leave-out).
// Returns marks (state.rules: the rules as this run wrote them; state.rulesLeftOut).
import fs from "node:fs";
import path from "node:path";
import { fwd, sha } from "./files.mjs";
import { splitBlocks, key, lead, unfit, carve, appendOwn, historyKeys } from "./blocks.mjs";

const HEADING = /^#{1,6}\s/;

// A lead as a person types it: case and a closing mark don't matter
export const sameLead = (a, b) => a.trim().replace(/[.:;,!?]+$/, "").toLowerCase() === b.trim().replace(/[.:;,!?]+$/, "").toLowerCase();
// The leads of the shipped rules (not the headings), for --leave-out
export const ruleLeads = (text) => splitBlocks(text).filter((b) => !HEADING.test(b.text)).map((b) => lead(b.text));

// The leads to leave out after this run: state.rulesLeftOut with --leave-out added and --put-back taken off.
// A --leave-out or --put-back that names no shipped rule is an error (install.mjs stops before writing).
export function leftOut(ctx, built) {
  const { args, state } = ctx;
  const given = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [[flag, args[i + 1]]] : []));
  const leads = ruleLeads(built);
  let list = [...(state.rulesLeftOut || [])];
  for (const [flag, name] of [...given("--leave-out"), ...given("--put-back")]) {
    // --put-back also takes a lead still on the list whose rule this version no longer has, so it can go
    const match = leads.find((l) => sameLead(l, name)) ?? (flag === "--put-back" ? list.find((l) => sameLead(l, name)) : undefined);
    if (!match) return { error: `${flag} "${name}": no rule of this version starts like that. The rules' leads:\n${leads.map((l) => `  ${l}`).join("\n")}` };
    list = list.filter((l) => !sameLead(l, match));
    if (flag === "--leave-out") list.push(match);
  }
  return { list: list.sort() };
}

// The shipped text without the rules left out and the rules whose need (rules/conditions.json) this computer
// doesn't have
function filtered(ctx, built, out) {
  const conditions = JSON.parse(fs.readFileSync(path.join(ctx.REPO, "rules", "conditions.json"), "utf8"));
  const drop = splitBlocks(built).filter((b) => {
    if (HEADING.test(b.text)) return false;
    const l = lead(b.text);
    if (out.some((o) => sameLead(o, l))) return true;
    const cond = Object.entries(conditions).find(([k]) => sameLead(k, l));
    if (!cond) return false;
    if (!(cond[1].needs in ctx.have)) throw new Error(`rules/conditions.json: "${cond[0]}" needs "${cond[1].needs}", which the installer doesn't know (ctx.have: ${Object.keys(ctx.have).join(", ")})`);
    return !ctx.have[cond[1].needs];
  });
  let text = built;
  for (const b of drop) text = text.replace(b.text + "\n", "");
  return text;
}

export function rules(ctx) {
  const { REPO, CLAUDE, DRY, state, say, keepCopy, home } = ctx;
  const full = ctx.repoText("rules/CLAUDE.md");
  const { list: out, error } = leftOut(ctx, full);
  if (error) throw new Error(error);
  // The carve sorts against the full shipped text, so a left-out rule still in the file goes as shipped text
  const built = filtered(ctx, full, out);
  const rulesFile = path.join(CLAUDE, "CLAUDE.md");
  const myRules = path.join(CLAUDE, "rules", "my-rules.md");
  const mine = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8").replace(/\r\n/g, "\n") : null;
  const write = (file, text) => { if (!DRY) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } };
  const marks = { rules: sha(built), rulesLeftOut: out.length ? out : undefined };
  if (mine === null) { write(rulesFile, built); say(`rules: wrote ${fwd(rulesFile)}`); return { marks }; }
  if (mine === built) { say("rules: up to date"); return { marks }; }
  // state.rules: the rules as a run last wrote them. A file that still matches was not changed by the user.
  if (state.rules === sha(mine)) {
    const backup = keepCopy(rulesFile);
    write(rulesFile, built);
    say(`rules: replaced ${fwd(rulesFile)} (old copy: ${backup})`);
    return { marks };
  }
  // The carve: blocks are compared with the real projects folder put back to <projects>
  const asShipped = (t) => unfit(t, ctx.PROJECTS, ctx.WIN);
  const shippedKeys = splitBlocks(asShipped(full)).map((b) => key(b.text));
  const { own, oldCount } = carve(mine, shippedKeys, historyKeys(REPO), asShipped);
  const theirs = new Set(splitBlocks(mine).map((b) => key(asShipped(b.text))));
  const newCount = new Set(splitBlocks(asShipped(built)).filter((b) => !HEADING.test(b.text) && !theirs.has(key(b.text))).map((b) => key(b.text))).size;
  // A rules file that was there before the first install is the user's: --uninstall puts its copy back
  const backup = keepCopy(rulesFile, !state.version);
  ctx.rulesUndo.push({ file: fwd(rulesFile), copy: fwd(path.join(CLAUDE, backup)) });
  const had = fs.existsSync(myRules) ? fs.readFileSync(myRules, "utf8") : null;
  const next = appendOwn(had ?? "", own);
  if (next !== (had ?? "")) {
    ctx.rulesUndo.push({ file: fwd(myRules), copy: had === null ? null : fwd(path.join(path.dirname(myRules), keepCopy(myRules))) });
    write(myRules, next);
  }
  write(rulesFile, built);
  const tilde = (f) => (fwd(f).startsWith(fwd(home) + "/") ? "~/" + fwd(path.relative(home, f)) : fwd(f));
  say(`rules: brought up to this version: ${newCount} setup rules new or changed, ${oldCount} old ones removed, ${own.length} of yours moved to ${tilde(myRules)} (old copy: ${backup}; undo: node ${tilde(path.join(CLAUDE, "skills", "update-setup", "own-rules.mjs"))} --undo)`);
  return { marks };
}
