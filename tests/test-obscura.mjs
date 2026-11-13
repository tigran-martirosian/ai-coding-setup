// scripts/obscura.mjs: the pinned Obscura goes into its folder only when the archive's SHA-256 matches, a
// second run leaves it, a failed or wrong download says so and changes nothing, a system with no build is
// named. A made-up archive stands in for the release: no network. Run: node tests/test-obscura.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { installObscura, PIN } from "../scripts/obscura.mjs";

let failed = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  if (!pass) failed++;
  console.log(
    `${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-obscura-"));
try {
  // An archive like a release: the program and its worker inside a folder
  const exe = process.platform === "win32" ? "obscura.exe" : "obscura";
  const pkg = path.join(tmp, "pkg", "obscura-test");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, exe), "program");
  fs.writeFileSync(
    path.join(pkg, exe.replace("obscura", "obscura-worker")),
    "worker",
  );
  const archive = path.join(tmp, "obscura-test.tar.gz");
  const tar =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "tar.exe",
        )
      : "tar";
  const made = spawnSync(
    tar,
    ["-czf", archive, "-C", path.join(tmp, "pkg"), "obscura-test"],
    { encoding: "utf8" },
  );
  if (made.status !== 0)
    throw new Error(`could not make the test archive: ${made.stderr}`);
  const sha = createHash("sha256")
    .update(fs.readFileSync(archive))
    .digest("hex");
  const key = `${process.platform}-${process.arch}`;
  const pin = {
    tag: "v9.9.9",
    url: (n) => `https://example.invalid/${n}`,
    assets: { [key]: ["obscura-test.tar.gz", sha] },
  };
  const fetched = [];
  const fetchTo = async (url, out) => {
    fetched.push(url);
    fs.copyFileSync(archive, out);
  };
  const dir = path.join(tmp, "home", ".claude", "obscura");

  let r = await installObscura({ dir, pin, fetchTo, dry: true });
  ok("a dry run only says what it would do", r.status, "dry");
  ok("and puts nothing in place", fs.existsSync(dir), false);

  r = await installObscura({ dir, pin, fetchTo, check: false });
  ok("the pinned archive is put in place", r.status, "installed");
  ok(
    "its program sits at the folder's top",
    fs.readFileSync(path.join(dir, exe), "utf8"),
    "program",
  );
  ok(
    "the worker beside it",
    fs.existsSync(path.join(dir, exe.replace("obscura", "obscura-worker"))),
    true,
  );
  ok(
    "VERSION holds the tag and the SHA-256",
    fs.readFileSync(path.join(dir, "VERSION"), "utf8"),
    `v9.9.9\nsha256 ${sha} obscura-test.tar.gz\n`,
  );
  ok(
    "from the pinned URL",
    fetched[0],
    "https://example.invalid/obscura-test.tar.gz",
  );

  r = await installObscura({ dir, pin, fetchTo, check: false });
  ok("a second run leaves it", r.status, "present");
  ok("without a download", fetched.length, 1);

  const other = path.join(tmp, "other");
  const wrong = {
    ...pin,
    assets: { [key]: ["obscura-test.tar.gz", "0".repeat(64)] },
  };
  r = await installObscura({ dir: other, pin: wrong, fetchTo, check: false });
  ok("a SHA-256 that doesn't match stops it", r.status, "failed");
  ok(
    "and says it was not installed",
    /NOT installed: .*not the pinned/.test(r.line),
    true,
  );
  ok("and puts nothing in place", fs.existsSync(other), false);

  r = await installObscura({
    dir: other,
    pin,
    fetchTo: async () => {
      throw new Error("offline");
    },
    check: false,
  });
  ok(
    "a failed download is said with its reason",
    r.status === "failed" && r.line.includes("offline"),
    true,
  );

  r = await installObscura({
    dir,
    pin: { ...pin, tag: "v9.9.10" },
    fetchTo,
    check: false,
  });
  ok(
    "a new pin replaces the old one",
    r.status === "installed" &&
      fs
        .readFileSync(path.join(dir, "VERSION"), "utf8")
        .startsWith("v9.9.10\n"),
    true,
  );

  r = await installObscura({
    dir: other,
    pin,
    platform: "aix",
    arch: "ppc64",
    fetchTo,
  });
  ok(
    "a system with no build is named",
    r.status === "none" && r.line.includes("aix-ppc64"),
    true,
  );

  ok(
    "the real pin has a build for each named system",
    [
      "win32-x64",
      "darwin-x64",
      "darwin-arm64",
      "linux-x64",
      "linux-arm64",
    ].every((k) => /^[0-9a-f]{64}$/.test(PIN.assets[k]?.[1] || "")),
    true,
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
