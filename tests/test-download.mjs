// Tests for workers/download.mjs against a range server on 127.0.0.1 started here. Run: node test-download.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { plan } from "../workers/download.mjs"; // importing must not start the command

const worker = fileURLToPath(
  new URL("../workers/download.mjs", import.meta.url),
);
const dir = fs.mkdtempSync(path.join(tmpdir(), "download-"));
const DATA = randomBytes(8 * 1024 * 1024 + 3);
const SHA = createHash("sha256").update(DATA).digest("hex");
const RANGES = plan(DATA.length, 8);

// /good ranges; /flaky cuts part 2 off halfway the first time; /broken refuses the second half of the
// parts while `broken` is true; /norange answers one chunked stream with no length and no ranges
let log = [];
let broken = true;
let flakyCut = false;
const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0];
  const m = (req.headers.range || "").match(/^bytes=(\d+)-(\d+)$/);
  log.push({ name, method: req.method, start: m ? Number(m[1]) : null });
  if (name === "/norange.bin") {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    if (req.method === "HEAD") return res.end();
    for (let i = 0; i < DATA.length; i += 65536)
      res.write(DATA.subarray(i, i + 65536));
    return res.end();
  }
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": DATA.length,
    });
    return res.end();
  }
  if (!m) {
    res.writeHead(200, { "Content-Length": DATA.length });
    return res.end(DATA);
  }
  const [start, end] = [Number(m[1]), Number(m[2])];
  if (name === "/broken.bin" && broken && start >= RANGES[4][0]) {
    res.writeHead(500);
    return res.end("down");
  }
  const body = DATA.subarray(start, end + 1);
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${DATA.length}`,
    "Content-Length": body.length,
  });
  if (name === "/flaky.bin" && start === RANGES[2][0] && !flakyCut) {
    flakyCut = true;
    res.write(body.subarray(0, body.length >> 1));
    return setTimeout(() => res.destroy(), 50);
  }
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const run = (...args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, ...args]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
const same = (file) =>
  fs.existsSync(file) && fs.readFileSync(file).equals(DATA);
const gets = (name) =>
  log.filter((l) => l.name === name && l.method === "GET" && l.start !== null)
    .length;

let fail = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) fail++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `\n${detail}`}`);
};

ok(
  "plan: 8 parts that cover every byte once",
  RANGES.length === 8 &&
    RANGES[0][0] === 0 &&
    RANGES[7][1] === DATA.length - 1 &&
    RANGES.every((r, i) => i === 0 || r[0] === RANGES[i - 1][1] + 1),
);
ok(
  "plan: no part under 1 MiB, so 3 MB gets 3 parts",
  plan(3 * 1024 * 1024, 32).length === 3,
);

let out = path.join(dir, "good.bin");
let r = await run(`${base}/good.bin`, out, "--parts", "8", "--sha256", SHA);
ok(
  "multi-part download with a matching sha256",
  r.code === 0 &&
    same(out) &&
    r.out.includes("8 parts") &&
    r.out.includes(`sha256 ${SHA}`) &&
    r.out.includes("sha256 matches") &&
    gets("/good.bin") === 8 &&
    !fs.existsSync(`${out}.parts`) &&
    !fs.existsSync(`${out}.download`),
  r.out,
);

out = path.join(dir, "flaky.bin");
r = await run(`${base}/flaky.bin`, out, "--parts", "8");
ok(
  "a part cut off once is fetched again from where it stopped",
  r.code === 0 &&
    same(out) &&
    /part 2 \(bytes \d+-\d+\) try 1 failed/.test(r.out) &&
    log.some(
      (l) =>
        l.name === "/flaky.bin" &&
        l.start > RANGES[2][0] &&
        l.start < RANGES[3][0],
    ),
  r.out,
);

out = path.join(dir, "broken.bin");
r = await run(`${base}/broken.bin`, out, "--parts", "8");
const kept = fs.existsSync(`${out}.parts`)
  ? fs
      .readdirSync(`${out}.parts`)
      .filter(
        (f) =>
          f.startsWith("part-") &&
          fs.statSync(path.join(`${out}.parts`, f)).size > 0,
      )
  : [];
ok(
  "parts that keep failing end in a clear error, the good half kept",
  r.code === 1 &&
    r.out.includes("4 of 8 parts failed") &&
    r.out.includes("failed 4 times, last: HTTP 500") &&
    r.out.includes("run the same command again to resume") &&
    kept.length === 4 &&
    !fs.existsSync(out),
  r.out,
);
broken = false;
log = [];
r = await run(`${base}/broken.bin`, out, "--parts", "8", "--sha256", SHA);
ok(
  "resume with half the parts on disk fetches only the other half",
  r.code === 0 &&
    same(out) &&
    r.out.includes("4 already complete on disk") &&
    gets("/broken.bin") === 4 &&
    log.every((l) => l.start === null || l.start >= RANGES[4][0]),
  r.out,
);

out = path.join(dir, "norange.bin");
r = await run(`${base}/norange.bin`, out, "--sha256", SHA);
ok(
  "a server with no ranges gets one stream, and says so",
  r.code === 0 &&
    same(out) &&
    r.out.includes("so this is one stream") &&
    r.out.includes("one stream,"),
  r.out,
);

out = path.join(dir, "bad-sha.bin");
r = await run(
  `${base}/good.bin`,
  out,
  "--parts",
  "8",
  "--sha256",
  "0".repeat(64),
);
ok(
  "a sha256 mismatch is a clear error and leaves no file",
  r.code === 3 &&
    r.out.includes(`sha256 mismatch: expected ${"0".repeat(64)}, got ${SHA}`) &&
    !fs.existsSync(out) &&
    !fs.existsSync(`${out}.download`) &&
    !fs.existsSync(`${out}.parts`),
  r.out,
);

r = await run(`${base}/good.bin`);
ok(
  "bad usage: exit 2 with the usage line",
  r.code === 2 && r.out.includes("Usage: download.mjs"),
  r.out,
);

server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exitCode = fail ? 1 : 0;
