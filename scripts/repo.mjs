// What install.mjs reads from this repository: version.json, the hook table settings.example.json with
// its `_setup` lists, projects/homes.json, the project folders, and the files that go to ~/.claude.
// fitter gives the rules and folder texts the real projects folder in place of <projects>.
import fs from "node:fs";
import path from "node:path";
import { filesIn, OWN_FOLDERS } from "./files.mjs";

export function repoSources(REPO) {
  const json = (rel) =>
    JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8"));
  const { version, claudeCodeMin } = json("version.json");
  // settings.example.json is the one hook table; its `_setup` key (not a Claude Code setting, never written
  // to a settings.json) lists the hooks and matchers earlier versions wired.
  const example = json("settings.example.json");
  const { retired, retiredInHomes, oldMatchers } = example._setup;
  return {
    version,
    claudeCodeMin,
    example,
    RETIRED: retired,
    RETIRED_IN_HOMES: retiredInHomes,
    OLD_MATCHERS: oldMatchers,
    homes: json(path.join("projects", "homes.json")),
    HOMES: fs
      .readdirSync(path.join(REPO, "projects"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== "shared")
      .map((e) => e.name),
    // Every file in these repo folders goes to the folder of the same name under ~/.claude.
    files: OWN_FOLDERS.flatMap((d) =>
      filesIn(path.join(REPO, d)).map((f) => path.join(d, f)),
    ),
    // projects/shared holds what the picture skill needs in ~/.claude: the skill itself and its gate
    shared: path.join(REPO, "projects", "shared"),
  };
}

// The rules and the project folders name the projects folder as <projects>; the text gets the real
// one. Off Windows the folder separator and Codex's Windows-only sandbox flag go.
export function fitter(REPO, PROJECTS, WIN) {
  function fit(rel, data) {
    if (!/\.(md|txt)$/.test(rel)) return data;
    let text = data.toString("utf8");
    if (!WIN)
      text = text
        .replaceAll("<projects>\\", "<projects>/")
        .replaceAll(` -c 'windows.sandbox="unelevated"'`, "")
        .replaceAll(
          " On Windows, without the unelevated sandbox it can't read files.",
          "",
        );
    return Buffer.from(text.replaceAll("<projects>", PROJECTS));
  }
  const repoText = (rel) =>
    fit(rel, fs.readFileSync(path.join(REPO, rel)))
      .toString("utf8")
      .replace(/\r\n/g, "\n");
  return { fit, repoText };
}
