// The home-links patch: on Nimbalyst 0.83.0's own preload and chat link code, a link written ~/... opens the file
// in the home folder after the patch and not before; other links and a missing home folder change nothing.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { default: patch } = await import(
  pathToFileURL(
    path.join(REPO, "scripts", "nimbalyst-patch", "patches", "home-links.mjs"),
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

// As in out/preload/index.js of 0.83.0
const PRELOAD = `electron.contextBridge.exposeInMainWorld("electronAPI", {
  onFileNew: (callback) => {
    electron.ipcRenderer.on("file-new", callback);
    return () => electron.ipcRenderer.removeListener("file-new", callback);
  },
});`;
// As in out/renderer/assets/registerExtensionSystem-*.js of 0.83.0, cut to the link's path lines
const LINK = `const autolinkedPath = node2?.properties?.dataFilePath;
      const resolvedAutolink = onOpenFile && autolinkedPath ? parseLineAndColumnSuffix(autolinkedPath) : null;
      const fileTarget = resolvedAutolink ?? (onOpenFile ? resolveTranscriptFileTargetFromHref(href) : null);
      const filePath = fileTarget?.path ?? null;
      return filePath;`;

const [pre, link] = patch.edits;
ok("two edits", patch.edits.length, 2);
ok("preload anchor once", PRELOAD.split(pre.anchor).length, 2);
ok("link anchor once", LINK.split(link.anchor).length, 2);
ok(
  "replace texts are not in the unpatched code",
  [PRELOAD.includes(pre.replace), LINK.includes(link.replace)],
  [false, false],
);
ok(
  "files: the preload and the link chunk only",
  [
    patch.files.test("out/preload/index.js"),
    patch.files.test("out/renderer/assets/registerExtensionSystem-D6mrEjei.js"),
    patch.files.test("out/renderer/assets/index-BIbaJj7C.js"),
    patch.files.test("out/main/index.js"),
  ],
  [true, true, false, false],
);

// The patched preload, run with a fake electron and a given environment, gives the window its home folder.
function exposed(code, env) {
  let api;
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_n, o) => {
        api = o;
      },
    },
    ipcRenderer: { on() {}, removeListener() {} },
  };
  new Function("electron", "process", code)(electron, { env });
  return api;
}
const patchedPreload = PRELOAD.replace(pre.anchor, pre.replace);
ok(
  "preload: home folder from USERPROFILE",
  exposed(patchedPreload, { USERPROFILE: "D:\\Profiles\\me" }).homeDir,
  "D:\\Profiles\\me",
);
ok(
  "preload: HOME when USERPROFILE is missing",
  exposed(patchedPreload, { HOME: "/srv/me" }).homeDir,
  "/srv/me",
);
ok(
  "preload: empty when neither is set",
  exposed(patchedPreload, {}).homeDir,
  "",
);
ok(
  "preload: the other methods stay",
  typeof exposed(patchedPreload, {}).onFileNew,
  "function",
);

// The link code: what a click opens, before and after, for a given href and home folder.
function opens(code, href, homeDir) {
  const window = { electronAPI: homeDir === undefined ? {} : { homeDir } };
  const resolveTranscriptFileTargetFromHref = (h) => ({ path: h });
  return new Function(
    "window",
    "node2",
    "onOpenFile",
    "href",
    "parseLineAndColumnSuffix",
    "resolveTranscriptFileTargetFromHref",
    code,
  )(window, {}, () => {}, href, null, resolveTranscriptFileTargetFromHref);
}
const patchedLink = LINK.replace(link.anchor, link.replace);
ok(
  "before: the tilde stays and the file is not found",
  opens(LINK, "~/.claude/CLAUDE.md", "D:\\Profiles\\me"),
  "~/.claude/CLAUDE.md",
);
ok(
  "after: ~/ opens the file in the home folder",
  opens(patchedLink, "~/.claude/CLAUDE.md", "D:\\Profiles\\me"),
  "D:/Profiles/me/.claude/CLAUDE.md",
);
ok(
  "after: ~\\ too",
  opens(patchedLink, "~\\.claude\\CLAUDE.md", "D:\\Profiles\\me"),
  "D:/Profiles/me/.claude\\CLAUDE.md",
);
ok(
  "after: an absolute path is unchanged",
  opens(patchedLink, "C:/Projects/a.md", "D:\\Profiles\\me"),
  "C:/Projects/a.md",
);
ok(
  "after: a name starting with ~ but no slash is unchanged",
  opens(patchedLink, "~notes.md", "D:\\Profiles\\me"),
  "~notes.md",
);
ok(
  "after: no home folder known leaves the link as it was",
  opens(patchedLink, "~/.claude/CLAUDE.md", undefined),
  "~/.claude/CLAUDE.md",
);
ok(
  "after: no file target stays null",
  new Function(
    "window",
    "node2",
    "onOpenFile",
    "href",
    "parseLineAndColumnSuffix",
    "resolveTranscriptFileTargetFromHref",
    patchedLink,
  )(
    { electronAPI: { homeDir: "D:\\Profiles\\me" } },
    {},
    null,
    "https://x.dev",
    null,
    () => null,
  ),
  null,
);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
