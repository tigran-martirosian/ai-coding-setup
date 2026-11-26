// Run: npm test   (Node 22.6+ strips the types)
// The TTS folder holds the python.exe the backend runs: a folder other accounts can change would run their code
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../src/folderSafety.ts";

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WIN = process.platform === "win32";
const system32 = path.join(process.env.SystemRoot ?? "", "System32");
let passed = 0;
let failed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL - ${name}\n  ${(e as Error).message}`);
  }
}
const tempDir = (name: string) =>
  fs.mkdtempSync(path.join(os.tmpdir(), `tts-${name}-`));
const icacls = (...args: string[]) => {
  const r = spawnSync(path.join(system32, "icacls.exe"), args, {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
};
// true when a macrotask ran while fn's promise was pending: the work did not block the event loop
async function letsOthersRun(fn: () => unknown): Promise<boolean> {
  let ran = false;
  setImmediate(() => {
    ran = true;
  });
  await fn();
  return ran;
}

await t(
  "the default TTS folder is in the user's own LOCALAPPDATA, not at the root of C: where every account can write",
  () => {
    const manifest = fs.readFileSync(path.join(here, "manifest.json"), "utf8");
    const settings = fs.readFileSync(
      path.join(here, "src/settings.ts"),
      "utf8",
    );
    assert.doesNotMatch(manifest, /C:\\\\LocalTTS/);
    assert.doesNotMatch(settings, /C:\\\\LocalTTS/);
    assert.equal(
      S.ttsDir(""),
      path.join(process.env.LOCALAPPDATA ?? "", "LocalTTS"),
    );
    assert.equal(S.ttsDir("  D:\\tts  "), path.resolve("D:\\tts"));
  },
);

await t(
  "an empty setting with the old C:\\LocalTTS present and the new default missing says the default moved and gives the move and lock commands",
  () => {
    const local = tempDir("local");
    const old = tempDir("old");
    const saved = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = local;
    try {
      const dir = S.ttsDir("");
      const note = S.movedDefault(dir, old) ?? "";
      assert.match(note, /moved/);
      assert.ok(
        note.includes(`Move-Item -LiteralPath '${old}' -Destination '${dir}'`),
        note,
      );
      assert.ok(note.includes(S.lockCommand(dir)), note);
      assert.equal(S.movedDefault(path.join(old, "elsewhere"), old), null);
      assert.equal(S.movedDefault(dir, path.join(old, "gone")), null);
      fs.mkdirSync(dir);
      assert.equal(S.movedDefault(dir, old), null);
    } finally {
      process.env.LOCALAPPDATA = saved;
      fs.rmSync(local, { recursive: true, force: true });
      fs.rmSync(old, { recursive: true, force: true });
    }
  },
);

await t(
  "the base Python folder named by home in the venv's pyvenv.cfg is checked too: its python.exe runs as well",
  () => {
    const dir = tempDir("venv");
    try {
      fs.mkdirSync(path.join(dir, "venv"));
      const cfg = path.join(dir, "venv", "pyvenv.cfg");
      fs.writeFileSync(
        cfg,
        "home = C:\\Some Python\\Python312\r\nversion = 3.12.7\r\n",
      );
      assert.ok(
        S.pathsToCheck(dir).includes(
          path.resolve("C:\\Some Python\\Python312"),
        ),
        JSON.stringify(S.pathsToCheck(dir)),
      );
      fs.writeFileSync(cfg, "version = 3.12.7\r\n");
      assert.throws(() => S.pathsToCheck(dir), /home/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

await t(
  "the lock command grants SYSTEM and Administrators by SID and the user by the real name, for PowerShell on any Windows language",
  () => {
    const line = S.lockCommand("D:\\voices\\it's here");
    assert.ok(line.includes("'*S-1-5-18:(OI)(CI)F'"), line);
    assert.ok(line.includes("'*S-1-5-32-544:(OI)(CI)F'"), line);
    assert.ok(line.includes(`${os.userInfo().username}:(OI)(CI)F'`), line);
    assert.ok(line.includes("'D:\\voices\\it''s here'"), line);
    assert.doesNotMatch(line, /%USERNAME%|"SYSTEM|"Administrators/);
  },
);

if (WIN) {
  await t(
    "a TTS folder other accounts can write to is refused, a private one is not",
    async () => {
      const own = tempDir("own");
      const open = tempDir("open");
      try {
        icacls(open, "/grant", "*S-1-5-11:(OI)(CI)M");
        assert.deepEqual(await S.othersCanWrite([own]), []);
        const found = await S.othersCanWrite([open]);
        assert.equal(found.length, 1, JSON.stringify(found));
        assert.ok(found[0].startsWith(open), found[0]);
        assert.match(found[0], /S-1-5-11/);
      } finally {
        fs.rmSync(own, { recursive: true, force: true });
        fs.rmSync(open, { recursive: true, force: true });
      }
    },
  );

  await t(
    "the lock command, run in PowerShell, leaves a folder that inherited write access for others (as C:\\LocalTTS does) one no other account can change",
    async () => {
      const parent = tempDir("lock");
      const open = path.join(parent, "it's here");
      try {
        icacls(parent, "/grant", "*S-1-5-11:(OI)(CI)M");
        fs.mkdirSync(open);
        assert.equal((await S.othersCanWrite([open])).length, 1);
        const r = spawnSync(
          path.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", S.lockCommand(open)],
          { encoding: "utf8" },
        );
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.deepEqual(await S.othersCanWrite([open]), []);
        fs.writeFileSync(path.join(open, "mine.txt"), "still mine");
      } finally {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    },
  );

  await t(
    "an entry that only reaches what is inside (InheritOnly) does not count for the folder itself, only for its contents",
    async () => {
      const dir = tempDir("inherit");
      try {
        icacls(dir, "/grant", "*S-1-5-11:(OI)(CI)(IO)M");
        const inside = path.join(dir, "inside.txt");
        fs.writeFileSync(inside, "");
        assert.deepEqual(await S.othersCanWrite([dir]), []);
        assert.equal((await S.othersCanWrite([inside])).length, 1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  await t(
    "a path owned by someone other than you, SYSTEM or Administrators is refused (the owner can change its permissions)",
    async () => {
      // the Windows folder is owned by TrustedInstaller (S-1-5-80-...)
      const found = await S.othersCanWrite([process.env.SystemRoot ?? ""]);
      assert.ok(
        found.some((f) => /owned by .*\(S-1-5-80-/.test(f)),
        JSON.stringify(found),
      );
    },
  );

  await t(
    "the permission check runs without blocking the host, and a folder found safe is not read again within a minute",
    async () => {
      const dir = tempDir("cache");
      try {
        assert.ok(
          await letsOthersRun(() => S.othersCanWrite([dir])),
          "the first check must run PowerShell asynchronously",
        );
        assert.ok(
          !(await letsOthersRun(() => S.othersCanWrite([dir]))),
          "the second check must come from the cache, with no PowerShell run",
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  await t(
    "a folder found open is read again at once, so locking it works at the next try",
    async () => {
      const dir = tempDir("reread");
      try {
        icacls(dir, "/grant", "*S-1-5-11:(OI)(CI)M");
        assert.equal((await S.othersCanWrite([dir])).length, 1);
        icacls(dir, "/remove:g", "*S-1-5-11");
        assert.deepEqual(await S.othersCanWrite([dir]), []);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

console.log(`\n${passed} passed, ${failed} failed (TTS folder safety)`);
if (failed) process.exit(1);
