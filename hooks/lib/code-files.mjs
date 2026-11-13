// Which files count as code or as setup, once for the hooks and the setup-audit / systems-map scripts.
// CODE_EXT is the code-review gate's list; BUILD_CODE_EXT is the same without the markup files (html, css, sql),
// because a project that has only those has nothing to build (verify-gate, outcomes, rule-check).
// MAP_CODE_EXT is wider and has no dots: the systems map scans any language's files, by the name after the dot.
import path from "node:path";

export const CODE_EXT = new Set([
  ".java",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".gd",
  ".cs",
  ".go",
  ".rs",
  ".kt",
  ".kts",
  ".gradle",
  ".vue",
  ".svelte",
  ".php",
  ".rb",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".sh",
  ".ps1",
  ".sql",
  ".html",
  ".css",
]);
export const BUILD_CODE_EXT = new Set(
  [...CODE_EXT].filter((e) => ![".sql", ".html", ".css"].includes(e)),
);
export const MAP_CODE_EXT = new Set(
  (
    "js mjs cjs jsx ts tsx py pyi java kt kts scala groovy go rs rb php cs fs vb c h cc cpp cxx hpp hh m mm swift dart lua pl pm r jl " +
    "ex exs erl hrl hs ml clj cljs sh bash zsh ps1 bat sql vue svelte astro"
  ).split(" "),
);

const THROWAWAY = /\/(temp|tmp|scratch)\//i; // a throwaway script is not the project's code
const codeTest = (exts) => (p) => {
  const f = String(p).replace(/\\/g, "/");
  if (THROWAWAY.test(f)) return false;
  const ext = path.extname(f).toLowerCase();
  return exts.has(ext) || (ext === ".json" && /(^|\/)src\//.test(f));
};
export const isCode = codeTest(CODE_EXT);
export const isBuildCode = codeTest(BUILD_CODE_EXT);

// Hooks, rules, agents, skills, settings and CI, by their usual places. A web project's src/hooks/useThing.js is not one of them
export const SETUP_FILES =
  /(^|\/)(\.claude\/(hooks\/|agents\/|rules\/|skills\/|settings[^/]*\.json$)|CLAUDE\.md$|\.github\/workflows\/|\.gitlab-ci\.ya?ml$|\.circleci\/|\.husky\/|settings\.example\.json$)/i;
export const isSetup = (p) => {
  const f = String(p).replace(/\\/g, "/");
  return !THROWAWAY.test(f) && SETUP_FILES.test(f);
};
