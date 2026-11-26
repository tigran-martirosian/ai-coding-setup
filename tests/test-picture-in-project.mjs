// Tests for hooks/picture-in-project.mjs. Run: node tests/test-picture-in-project.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/picture-in-project.mjs", import.meta.url),
);
const ROOT = mkdtempSync(join(tmpdir(), "picture-in-project-"));
const PROJECT = join(ROOT, "my-app");
const SHOWN = join(PROJECT, "shown");
mkdirSync(join(PROJECT, "scratch"), { recursive: true });
const run = (input, env = {}) => {
  const out = spawnSync(process.execPath, [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, PICTURE_IN_PROJECT: "", ...env },
    encoding: "utf8",
  }).stdout;
  return out ? JSON.parse(out).hookSpecificOutput : null;
};
const show = (
  items,
  tool = "mcp__nimbalyst__display_to_user",
  cwd = PROJECT,
) => ({ tool_name: tool, cwd, tool_input: { items } });
const pic = (path) => ({ description: "A picture", image: { path } });
const chart = {
  description: "A chart",
  chart: {
    chartType: "bar",
    data: [{ a: 1, b: 2 }],
    xAxisKey: "a",
    yAxisKey: "b",
  },
};
// A .png given as text is written behind a PNG signature: the hook copies only bytes that start like a picture
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (text) => Buffer.concat([PNG, Buffer.from(text)]);
const file = (path, bytes = "picture bytes") => {
  writeFileSync(
    path,
    typeof bytes === "string" && path.endsWith(".png") ? png(bytes) : bytes,
  );
  return path;
};
const copied = (out, i = 0) =>
  out.permissionDecisionReason
    .split("\n")
    .filter((l) => l.includes(" -> "))
    [i].split(" -> ")[1];

let failed = 0,
  count = 0;
const check = (name, ok, got) => {
  count++;
  if (ok) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(
      `FAIL ${name}\n     got: ${JSON.stringify(got)?.slice(0, 300) ?? "(nothing)"}`,
    );
  }
};

let out = run(show([pic(file(join(ROOT, "outside.png")))]));
check(
  "a picture outside the project is denied, with its copy in shown/",
  out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN),
  out,
);
check(
  "no call is rewritten: the card keeps the path Claude wrote",
  out && !("updatedInput" in out),
  out,
);
check(
  "the copy has the same bytes",
  out && readFileSync(copied(out)).equals(png("picture bytes")),
  out,
);
check(
  "the copy keeps the file's name and type",
  out && /outside-[0-9a-f]{8}\.png$/.test(copied(out)),
  out,
);
check(
  "shown/ ignores itself in git",
  readFileSync(join(SHOWN, ".gitignore"), "utf8") === "*\n",
);

out = run(
  show([pic(file(join(PROJECT, "scratch", "inside.png"), "other bytes"))]),
);
check(
  "a picture in a scratch folder of the project is denied and copied too",
  out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN),
  out,
);
rmSync(join(PROJECT, "scratch", "inside.png"));
check("the copy outlives the original", out && existsSync(copied(out)), out);

const before = readdirSync(SHOWN).length;
const again = [
  run(show([pic(file(join(ROOT, "same.png"), "same"))])),
  run(show([pic(join(ROOT, "same.png"))])),
];
check(
  "the same picture twice gives one copy",
  copied(again[0]) === copied(again[1]) &&
    readdirSync(SHOWN).length === before + 1,
  again,
);
const a = run(show([pic(file(join(ROOT, "changed.png"), "first"))]));
const b = run(show([pic(file(join(ROOT, "changed.png"), "second"))]));
check(
  "a file redrawn under the same name gets its own copy",
  copied(a) !== copied(b) && readFileSync(copied(a)).equals(png("first")),
  [a, b],
);

const kept = file(join(SHOWN, "kept.png"));
check("a picture already in shown/ passes", run(show([pic(kept)])) === null);

out = run(show([chart, pic(join(ROOT, "same.png"))]));
check(
  "a picture next to a chart is still handled",
  out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN),
  out,
);
check(
  "the retry with the copy's path passes",
  run(show([chart, pic(copied(out))])) === null,
  out,
);
check("a chart alone passes", run(show([chart])) === null);

check(
  "a missing picture inside the project is left to the tool",
  run(show([pic(join(PROJECT, "gone.png"))])) === null,
);
out = run(show([pic(join(ROOT, "gone.png"))]));
check(
  "a missing picture outside the project is denied and named",
  out?.permissionDecision === "deny" &&
    out.permissionDecisionReason.includes("gone.png"),
  out,
);
out = run(show([pic(join(ROOT, "same.png")), pic(join(ROOT, "gone.png"))]));
check(
  "one missing among several is named, the other is copied",
  out?.permissionDecisionReason.includes(
    "not copied: " + join(ROOT, "gone.png"),
  ) && copied(out).startsWith(SHOWN),
  out,
);
out = run(show([pic(join(ROOT, "gone.png")), pic(join(ROOT, "gone2.png"))]));
check(
  "two missing are both named",
  out?.permissionDecisionReason.includes("gone.png") &&
    out.permissionDecisionReason.includes("gone2.png"),
  out,
);
// The hook's own failure fails open: a picture it read but could not copy (a file named "shown" is in the way)
const BLOCKED = join(ROOT, "no-room");
mkdirSync(BLOCKED);
writeFileSync(join(BLOCKED, "shown"), "a file, not a folder");
out = run(show([pic(file(join(ROOT, "readable.png")))], undefined, BLOCKED));
check(
  "a readable picture the hook can't copy goes through (the hook fails open), not refused as unreadable",
  out === null,
  out,
);
// One picture it can't copy (the copy's name, with its hash added, is past the 255-character limit) skips only that
// picture: the others in the same call are still copied and named
const longName = file(join(ROOT, `${"a".repeat(247)}.png`), "long");
out = run(
  show([pic(longName), pic(file(join(ROOT, "other-one.png"), "other"))]),
);
check(
  "a picture the hook can't copy is skipped, the others in the call are still copied",
  out?.permissionDecision === "deny" &&
    out.permissionDecisionReason.includes("other-one-") &&
    !out.permissionDecisionReason.includes(`${longName} ->`),
  out,
);

out = run(show([pic(join(ROOT, "same.png"))], "mcp__other__display_to_user"));
check(
  "the tool under another server name is handled too",
  out?.permissionDecision === "deny",
  out,
);
check(
  "another tool passes",
  run(show([pic(join(ROOT, "same.png"))], "Read")) === null,
);
check(
  "a relative path is left to the tool",
  run(show([pic("out/a.png")])) === null,
);
check(
  "no project folder in the input passes",
  run({
    tool_name: "mcp__nimbalyst__display_to_user",
    tool_input: { items: [pic(join(ROOT, "same.png"))] },
  }) === null,
);
check("no items passes", run(show(undefined)) === null);
check("broken input passes", run("not json") === null);
check(
  "PICTURE_IN_PROJECT=off passes",
  run(show([pic(join(ROOT, "same.png"))]), { PICTURE_IN_PROJECT: "off" }) ===
    null,
);
if (process.platform === "win32") {
  check(
    "on Windows the letter case of the path does not matter",
    run(show([pic(kept.toUpperCase())])) === null,
  );
  out = run(show([pic(join(ROOT, "same.png").replace(/\\/g, "/"))]));
  check(
    "on Windows forward slashes work",
    out?.permissionDecision === "deny" && copied(out).startsWith(SHOWN),
    out,
  );
}

// Only pictures are copied: a key or a .env named in the call would otherwise be read and copied into the project,
// where Claude can read it under a name its Read deny rules don't match.
{
  const secret = file(join(ROOT, "secret.env"), "API_KEY=x");
  const o = run(show([pic(secret)]));
  check(
    "a file that is not a picture is not copied: denied, and nothing is written to shown/",
    o?.permissionDecision === "deny" &&
      /not a picture/.test(o.permissionDecisionReason) &&
      !readdirSync(SHOWN).some((n) => n.startsWith("secret")),
    o,
  );
  const n = run(show([pic("//some-host/share/x.png")]));
  check(
    "a network path (two slashes) is refused before any read, so no sign-in goes to that host",
    n?.permissionDecision === "deny" &&
      /network/.test(n.permissionDecisionReason) &&
      !/ -> /.test(n.permissionDecisionReason),
    n,
  );
  const big = file(join(ROOT, "big.png"), Buffer.alloc(20 * 1024 * 1024 + 1));
  const b = run(show([pic(big)]));
  check(
    "a picture over 20 MB is not copied: denied with its size named",
    b?.permissionDecision === "deny" &&
      /over 20 MB/.test(b.permissionDecisionReason) &&
      !readdirSync(SHOWN).some((n) => n.startsWith("big")),
    b,
  );
}

// The bytes must start like a picture: a key or a .env renamed to .png is not copied
{
  const fake = file(join(ROOT, "key.png"), Buffer.from("API_KEY=secret"));
  const o = run(show([pic(fake)]));
  check(
    "a .png whose bytes are not a picture is refused, and nothing is written to shown/",
    o?.permissionDecision === "deny" &&
      /not a picture/.test(o.permissionDecisionReason) &&
      !readdirSync(SHOWN).some((n) => n.startsWith("key")),
    o,
  );
  const kinds = {
    "j.jpg": Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]),
    "g.gif": Buffer.from("GIF89a..."),
    "w.webp": Buffer.from("RIFF\0\0\0\0WEBPVP8 "),
    "b.bmp": Buffer.from("BM......"),
    "i.ico": Buffer.from([0, 0, 1, 0, 1, 0]),
    "t.tif": Buffer.from("II*\0...."),
    "a.avif": Buffer.concat([
      Buffer.from([0, 0, 0, 0x1c]),
      Buffer.from("ftypavif\0\0\0\0avifmif1miaf"),
    ]),
    "s.svg": Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'),
  };
  const all = Object.entries(kinds).map(([n, b]) => file(join(ROOT, n), b));
  const k = run(show(all.map(pic)));
  check(
    "a picture of each kind (JPEG, GIF, WEBP, BMP, ICO, TIFF, AVIF, SVG) is copied",
    k?.permissionDecision === "deny" &&
      all.every((p) => k.permissionDecisionReason.includes(`${p} -> `)),
    k,
  );
  const s = run(show([pic(file(join(ROOT, "fake.svg"), "API_KEY=x"))]));
  check(
    "an .svg with no <svg tag is refused",
    s?.permissionDecision === "deny" &&
      /not a picture/.test(s.permissionDecisionReason),
    s,
  );
}

// A link is followed: one to a real picture is copied, one to a secret is refused like the secret itself
{
  const real = file(join(ROOT, "real-target.png"), "linked picture");
  const link = join(ROOT, "link.png");
  const toSecret = join(ROOT, "link-secret.png");
  let made = true;
  try {
    symlinkSync(real, link);
    symlinkSync(join(ROOT, "secret.env"), toSecret);
  } catch {
    made = false; // Windows without Developer Mode can't make links
  }
  if (!made) console.log("skip link checks (2): links can't be made here");
  else {
    const l = run(show([pic(link)]));
    check(
      "a link to a real picture is copied with the picture's bytes",
      l?.permissionDecision === "deny" &&
        / -> /.test(l.permissionDecisionReason) &&
        readFileSync(copied(l)).equals(png("linked picture")),
      l,
    );
    const ls = run(show([pic(toSecret)]));
    check(
      "a .png link to a secret is refused and nothing is copied",
      ls?.permissionDecision === "deny" &&
        /not a picture/.test(ls.permissionDecisionReason) &&
        !/ -> /.test(ls.permissionDecisionReason),
      ls,
    );
  }
}

rmSync(ROOT, { recursive: true, force: true });
console.log(failed ? `${failed} of ${count} failed` : `all ${count} passed`);
process.exit(failed ? 1 : 0);
