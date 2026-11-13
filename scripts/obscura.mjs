// Obscura (github.com/h4ckf0r0day/obscura, Apache-2.0): the headless browser tools/peek.mjs reads with when
// Nimbalyst's browser can't be reached, or with --engine obscura. The install puts one pinned release into
// ~/.claude/obscura and checks the archive's SHA-256 against the pin below; it is never updated on its own.
// A new pin is a change to this file after reading that release's notes (v0.2.5 shipped a regression).
// The render build without stealth, about 70 MB. --obscura no leaves it out (remembered); --home skips it
// unless --obscura yes (the tests).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { download } from "../workers/download.mjs";
import { fwd } from "./files.mjs";

export const PIN = {
  tag: "v0.2.6",
  url: (name) =>
    `https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.6/${name}`,
  // `gh api repos/h4ckf0r0day/obscura/releases/tags/v0.2.6`, its assets' digests (2026-11-12)
  assets: {
    "win32-x64": [
      "obscura-x86_64-windows.zip",
      "0a110d0693753a252ed7ffd61e682363e8622caf79697f564c529099a31a6242",
    ],
    "darwin-x64": [
      "obscura-x86_64-macos.tar.gz",
      "897f03df4e3d704f946c5e14c6a90a34e0d4e4ef898c4b3201771712962cd7fb",
    ],
    "darwin-arm64": [
      "obscura-aarch64-macos.tar.gz",
      "19faa248ac762f466ddb822dbb03ed4f097312d10d1a4d5b2143e6040a9bebd0",
    ],
    "linux-x64": [
      "obscura-x86_64-linux.tar.gz",
      "eed986e478c5ec5439f531f2d7fb6b0e36a356f1df7a6c44a8e8fd4f2486bd76",
    ],
    "linux-arm64": [
      "obscura-aarch64-linux.tar.gz",
      "e12aff8bbe40326386a471060083e9cec5255b67048996b84f649efef10cac39",
    ],
  },
};

export const obscuraDir = (claude) => path.join(claude, "obscura");
const exeName = (platform) =>
  platform === "win32" ? "obscura.exe" : "obscura";
// Windows' own tar (bsdtar) opens .zip too; Git Bash's tar, which may come first on the PATH, does not
const tarCmd = (platform) =>
  platform === "win32"
    ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe")
    : "tar";
const shaOf = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// The folder an archive's program sits in, searched to two levels (a release may wrap it in a folder)
function programDir(root, name) {
  if (fs.existsSync(path.join(root, name))) return root;
  for (const d of fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())) {
    const found = programDir(path.join(root, d.name), name);
    if (found) return found;
  }
  return null;
}

// Puts the pinned Obscura into dir. Returns { status, line }: status "present" | "installed" | "none" | "failed"
// | "dry". A failed download or check returns "failed" (a disk error throws; obscura() below catches it): Obscura is a fallback reader, so a failed download is said plainly and the install
// goes on; nothing is put on record, so the next run tries again. pin, platform, arch and fetchTo are for the tests.
export async function installObscura({
  dir,
  dry = false,
  pin = PIN,
  platform = process.platform,
  arch = process.arch,
  fetchTo = download,
  check = true,
}) {
  const asset = pin.assets[`${platform}-${arch}`];
  if (!asset)
    return {
      status: "none",
      line: `Obscura: no ${pin.tag} build for ${platform}-${arch}, so tools/peek.mjs reads through Nimbalyst's browser only`,
    };
  const [name, sha] = asset;
  const versionFile = path.join(dir, "VERSION");
  const exe = path.join(dir, exeName(platform));
  const recorded = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, "utf8")
    : "";
  if (
    fs.existsSync(exe) &&
    recorded.startsWith(`${pin.tag}\n`) &&
    recorded.includes(sha)
  ) {
    return {
      status: "present",
      line: `Obscura ${pin.tag}: already in ${fwd(dir)}`,
    };
  }
  if (dry)
    return {
      status: "dry",
      line: `Obscura ${pin.tag}: would download ${name} (about 70 MB), check its SHA-256 and put it in ${fwd(dir)}`,
    };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "obscura-"));
  const failed = (why) => ({
    status: "failed",
    line: `Obscura ${pin.tag} was NOT installed: ${why}. tools/peek.mjs still reads through Nimbalyst's browser; run the install again to retry.`,
  });
  try {
    const archive = path.join(tmp, name);
    try {
      await fetchTo(pin.url(name), archive);
    } catch (e) {
      return failed(`the download of ${name} failed (${e.message})`);
    }
    const got = shaOf(archive);
    if (got !== sha)
      return failed(
        `${name} has SHA-256 ${got}, not the pinned ${sha}, so it was deleted unopened`,
      );
    const out = path.join(tmp, "x");
    fs.mkdirSync(out);
    const tar = spawnSync(tarCmd(platform), ["-xf", archive, "-C", out], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (tar.status !== 0)
      return failed(
        `${name} could not be unpacked (${(tar.stderr || tar.error?.message || "").trim().slice(0, 200)})`,
      );
    const from = programDir(out, exeName(platform));
    if (!from) return failed(`${name} holds no ${exeName(platform)}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(from))
      fs.cpSync(path.join(from, f), path.join(dir, f), { recursive: true });
    if (platform !== "win32")
      for (const f of fs.readdirSync(dir))
        if (/^obscura/.test(f)) fs.chmodSync(path.join(dir, f), 0o755);
    if (check) {
      const v = spawnSync(exe, ["--version"], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20000,
      });
      if (!(v.stdout || "").includes(pin.tag.slice(1))) {
        fs.rmSync(dir, { recursive: true, force: true });
        return failed(
          `the unpacked ${exeName(platform)} did not answer --version with ${pin.tag.slice(1)} (${(v.stdout || v.stderr || v.error?.message || "").trim().slice(0, 200)})`,
        );
      }
    }
    fs.writeFileSync(versionFile, `${pin.tag}\nsha256 ${sha} ${name}\n`);
    return {
      status: "installed",
      line: `Obscura ${pin.tag}: put in ${fwd(dir)} (SHA-256 checked); tools/peek.mjs reads with it when Nimbalyst's browser can't be reached`,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The install's step: on unless --obscura no (remembered in state.obscura); under --home only with --obscura yes
export async function obscura(ctx) {
  const { opt, state, nextState, CLAUDE, DRY, say } = ctx;
  const given = opt("obscura");
  if (given !== null && !["yes", "no"].includes(given)) {
    say(`--obscura ${given}: give yes or no; Obscura was left as it is`);
    return;
  }
  const want =
    given === "yes"
      ? true
      : given === "no"
        ? false
        : typeof state.obscura === "boolean"
          ? state.obscura
          : opt("home") === null;
  if (given !== null) nextState.obscura = want;
  if (!want) {
    say(
      `Obscura: left out${given === null && opt("home") === null ? " (as answered before)" : ""}; --obscura yes puts it in`,
    );
    return;
  }
  // A disk or file error (a locked obscura.exe, a full disk) is said the same way as a failed download
  try {
    say((await installObscura({ dir: obscuraDir(CLAUDE), dry: DRY })).line);
  } catch (e) {
    say(
      `Obscura ${PIN.tag} was NOT installed: ${e.message}. tools/peek.mjs still reads through Nimbalyst's browser; run the install again to retry.`,
    );
  }
}
