// ~/.claude/CLAUDE.md, the global rules from rules/CLAUDE.md. A rules file the user changed keeps their
// text: only its section on gathering information is the installer's, and the newer rules are offered once.
// Returns marks (state.rules, state.rulesOffered) and rulesKept (named again in the closing list).
import fs from "node:fs";
import path from "node:path";
import { fwd, sha } from "./files.mjs";

// Every heading the section on gathering information has ever carried: an older rules file on disk still has an old one.
const HEAD = /^## (Gathering information|External workers first for gathering information|Gathering information on Claude alone|The free workers? reads? local files, not the web)$/;
// Puts this version's section in place of the one the text has (from its heading to the next "# " heading)
function withSection(text, section) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => HEAD.test(l));
  if (i === -1) return null;
  let j = i + 1;
  while (j < lines.length && !/^# /.test(lines[j])) j++;
  lines.splice(i, j - i, ...section.replace(/\n+$/, "").split("\n"), "");
  return lines.join("\n");
}

export function rules(ctx) {
  const { CLAUDE, DRY, state, say, keepCopy, onRecord } = ctx;
  const built = ctx.repoText("rules/CLAUDE.md");
  // A renamed heading in rules/CLAUDE.md would leave an older rules file's section in place: say so instead.
  const headAt = built.split("\n").findIndex((l) => HEAD.test(l));
  if (headAt === -1) throw new Error(`rules/CLAUDE.md has no section heading matching ${HEAD} - add the new heading to HEAD in scripts/rules.mjs`);
  const rulesFile = path.join(CLAUDE, "CLAUDE.md");
  const mine = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8").replace(/\r\n/g, "\n") : null;
  // Only the section on gathering information of an existing rules file is the installer's to change
  const ownSection = built.split("\n").slice(headAt).join("\n").split(/\n(?=# )/)[0];
  const swapped = mine === null ? null : withSection(mine, ownSection);
  const writeRules = (text) => { if (!DRY) { fs.mkdirSync(CLAUDE, { recursive: true }); fs.writeFileSync(rulesFile, text); } };
  // state.rules: the rules as a run last wrote them. A file that still matches was not changed by the
  // user, so a newer version replaces it. state.rulesOffered: the newer rules the user was last told about.
  const marks = { rules: state.rules, rulesOffered: state.rulesOffered };
  let rulesKept = false;
  if (mine === null) { writeRules(built); say(`rules: wrote ${fwd(rulesFile)}`); }
  else if (mine === built) say(`rules: unchanged ${fwd(rulesFile)}`);
  else if (ctx.args.includes("--replace-rules") || ctx.replaceAll || state.rules === sha(mine)) {
    const backup = keepCopy(rulesFile, onRecord && state.rules !== sha(mine));
    writeRules(built);
    say(`rules: replaced ${fwd(rulesFile)} (old copy: ${backup})`);
  } else {
    if (mine === swapped) say(`rules: unchanged ${fwd(rulesFile)}`);
    else if (swapped !== null) {
      const backup = keepCopy(rulesFile, onRecord);
      writeRules(swapped);
      say(`rules: wrote the section on gathering information of ${fwd(rulesFile)}; the rest is left as it was (old copy: ${backup})`);
    } else {
      say(`rules: left alone, ${fwd(rulesFile)} has other content. Run again with --replace-rules to take these rules (a dated copy is kept), or merge rules/CLAUDE.md by hand.`);
    }
    // The user's own rules stay; said once for each version of the rules they don't have
    if (state.rulesOffered !== sha(built)) say(`rules: new in this version, yours were kept. Run again with --replace-rules to take them (a dated copy is kept).`);
    marks.rulesOffered = sha(built);
    rulesKept = true;
  }
  if (!rulesKept) marks.rules = sha(built);
  return { marks, rulesKept };
}
