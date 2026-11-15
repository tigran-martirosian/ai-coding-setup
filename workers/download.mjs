#!/usr/bin/env node
import { createHash } from "node:crypto";
// download: fetches one big file as many byte ranges side by side, because one stream is slow from the
// big hosts (measured 2026-11-11 from Hugging Face: one curl ~1.5 MB/s, 32 ranges ~37 MB/s). No npm
// dependencies. hooks/download-guard.mjs rewrites a plain big curl, wget or Invoke-WebRequest into this.
//
//   download.mjs <url> <out> [--sha256 <hex>] [--parts N]
//
// A HEAD request (or, when HEAD is refused, a GET of byte 0) learns the size. The file is split into N
// ranges (default 32, and no range under 1 MiB, so a small file gets fewer), each fetched into
// <out>.parts/part-NNN and checked against its expected size. A failed or short part is fetched again
// from where it stopped, up to 4 tries, then the run ends with an error that names the part. Run the same
// command again to resume: complete parts are kept, partial ones continue. The parts are joined in order
// into <out>.download, its sha256 is printed (and checked when --sha256 is given), it is renamed to <out>
// and the parts are deleted. A server with no "Accept-Ranges: bytes" or no Content-Length gets one stream,
// and the run says so; that case cannot resume. A file that fails the sha256 check is deleted.
//
// Exit codes: 0 saved; 1 the download failed; 2 bad usage; 3 sha256 mismatch.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PARTS = 32;
export const MIN_PART = 1024 * 1024;
const TRIES = 4;
const IDLE_MS = 60000; // a part that sends nothing for this long is dropped and tried again
const UA = { "User-Agent": "claude-download" };

class Mismatch extends Error {}

// [start, end] byte ranges, end inclusive; the last one takes the remainder
export function plan(size, parts) {
  const n = Math.max(1, Math.min(parts, Math.floor(size / MIN_PART)));
  const each = Math.ceil(size / n);
  const ranges = [];
  for (let start = 0; start < size; start += each)
    ranges.push([start, Math.min(size, start + each) - 1]);
  return ranges;
}

const mb = (bytes) => (bytes / 1e6).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileSize = (f) => {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
};

// { size, ranges } from HEAD; when HEAD itself is refused, a GET of byte 0 answers the same question
export async function probe(url) {
  const head = await fetch(url, {
    method: "HEAD",
    headers: UA,
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (head.ok) {
    const len = Number(head.headers.get("content-length"));
    const ranges = /\bbytes\b/i.test(head.headers.get("accept-ranges") || "");
    return {
      size: Number.isFinite(len) && len > 0 ? len : null,
      ranges: ranges && len > 0,
    };
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(url, {
      headers: { ...UA, Range: "bytes=0-0" },
      redirect: "follow",
      signal: ac.signal,
    });
    const total = Number(
      ((r.headers.get("content-range") || "").match(/\/(\d+)$/) || [])[1],
    );
    if (r.status === 206 && total > 0) return { size: total, ranges: true };
    if (!r.ok)
      throw new Error(
        `HTTP ${head.status} to HEAD and HTTP ${r.status} to GET from ${url}`,
      );
    const len = Number(r.headers.get("content-length"));
    return {
      size: Number.isFinite(len) && len > 0 ? len : null,
      ranges: false,
    };
  } finally {
    clearTimeout(timer);
    ac.abort(); // the probe body is not read
  }
}

// Streams one response body into file (appending), with an idle timeout; returns the bytes written
async function streamTo(url, headers, file, onBytes, expectStatus) {
  const ac = new AbortController();
  let idle = setTimeout(
    () => ac.abort(new Error(`no data for ${IDLE_MS / 1000} s`)),
    IDLE_MS,
  );
  const fh = await fsp.open(file, "a");
  let written = 0;
  try {
    const r = await fetch(url, {
      headers: { ...UA, ...headers },
      redirect: "follow",
      signal: ac.signal,
    });
    if (r.status !== expectStatus)
      throw new Error(`HTTP ${r.status}, expected ${expectStatus}`);
    for await (const chunk of r.body) {
      clearTimeout(idle);
      idle = setTimeout(
        () => ac.abort(new Error(`no data for ${IDLE_MS / 1000} s`)),
        IDLE_MS,
      );
      await fh.write(chunk);
      written += chunk.length;
      onBytes(chunk.length);
    }
    return written;
  } catch (err) {
    throw ac.signal.aborted && ac.signal.reason instanceof Error
      ? ac.signal.reason
      : err;
  } finally {
    clearTimeout(idle);
    await fh.close();
  }
}

// One part, fetched until its file holds exactly end-start+1 bytes, continuing from what is already there
async function fetchPart(url, file, [start, end], index, onBytes) {
  const want = end - start + 1;
  let last;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    let have = fileSize(file);
    if (have > want) {
      fs.rmSync(file);
      have = 0;
    }
    if (have === want) return;
    try {
      await streamTo(
        url,
        { Range: `bytes=${start + have}-${end}` },
        file,
        onBytes,
        206,
      );
      const got = fileSize(file);
      if (got === want) return;
      if (got > want) {
        fs.rmSync(file);
        throw new Error(`the server sent ${got - want} bytes too many`);
      }
      throw new Error(`the part has ${got} of ${want} bytes`);
    } catch (err) {
      last = err;
      if (attempt < TRIES) {
        process.stderr.write(
          `[download] part ${index} (bytes ${start}-${end}) try ${attempt} failed: ${err.message}; trying again\n`,
        );
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(
    `part ${index} (bytes ${start}-${end}) failed ${TRIES} times, last: ${last.message}`,
  );
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file, {
    highWaterMark: MIN_PART,
  }))
    hash.update(chunk);
  return hash.digest("hex");
}

// Prints the bytes so far and the speed every 5 s on stderr, so a long download is seen to move
function progress(total, already = 0) {
  let done = already;
  const t0 = Date.now();
  const timer = setInterval(() => {
    const rate = (done - already) / Math.max(1, (Date.now() - t0) / 1000);
    process.stderr.write(
      `[download] ${mb(done)}${total ? `/${mb(total)}` : ""} MB, ${mb(rate)} MB/s\n`,
    );
  }, 5000);
  timer.unref();
  return {
    add: (n) => {
      done += n;
    },
    stop: () => {
      clearInterval(timer);
      return (done - already) / Math.max(0.001, (Date.now() - t0) / 1000);
    },
  };
}

async function inParts(url, out, tmp, size, parts) {
  const dir = `${out}.parts`;
  const ranges = plan(size, parts);
  const planFile = path.join(dir, "plan.json");
  if (fs.existsSync(planFile)) {
    const old = JSON.parse(fs.readFileSync(planFile, "utf8"));
    if (old.size !== size || old.parts !== ranges.length)
      throw new Error(
        `${dir} holds the parts of another download (${old.size} bytes in ${old.parts} parts; this one is ${size} bytes in ${ranges.length}). Delete that folder to start over.`,
      );
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    planFile,
    JSON.stringify({ url, size, parts: ranges.length }),
  );
  const files = ranges.map((_, i) =>
    path.join(dir, `part-${String(i).padStart(3, "0")}`),
  );
  const kept = files.reduce(
    (n, f, i) => n + (fileSize(f) === ranges[i][1] - ranges[i][0] + 1 ? 1 : 0),
    0,
  );
  const have = files.reduce((n, f) => n + fileSize(f), 0);
  console.log(
    `[download] ${mb(size)} MB in ${ranges.length} parts${kept ? `, ${kept} already complete on disk` : ""}`,
  );

  const p = progress(size, have);
  const results = await Promise.allSettled(
    ranges.map((r, i) => fetchPart(url, files[i], r, i, p.add)),
  );
  const rate = p.stop();
  const failed = results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason.message);
  if (failed.length)
    throw new Error(
      `${failed.length} of ${ranges.length} parts failed:\n  ${failed.join("\n  ")}\nThe parts done so far are kept in ${dir}; run the same command again to resume.`,
    );

  const hash = createHash("sha256");
  const fh = await fsp.open(tmp, "w");
  try {
    for (const f of files)
      for await (const chunk of fs.createReadStream(f, {
        highWaterMark: MIN_PART,
      })) {
        hash.update(chunk);
        await fh.write(chunk);
      }
  } finally {
    await fh.close();
  }
  if (fileSize(tmp) !== size)
    throw new Error(
      `the joined file has ${fileSize(tmp)} bytes, expected ${size}`,
    );
  return { sha: hash.digest("hex"), rate, dir, note: `${ranges.length} parts` };
}

async function oneStream(url, tmp, size) {
  let last;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    fs.rmSync(tmp, { force: true });
    const p = progress(size);
    try {
      await streamTo(url, {}, tmp, p.add, 200);
      const rate = p.stop();
      if (size && fileSize(tmp) !== size)
        throw new Error(`got ${fileSize(tmp)} of ${size} bytes`);
      return { sha: await hashFile(tmp), rate, dir: null, note: "one stream" };
    } catch (err) {
      p.stop();
      last = err;
      if (attempt < TRIES) {
        process.stderr.write(
          `[download] try ${attempt} failed: ${err.message}; starting again\n`,
        );
        await sleep(500 * 2 ** (attempt - 1));
      }
    }
  }
  fs.rmSync(tmp, { force: true });
  throw new Error(
    `the one stream failed ${TRIES} times, last: ${last.message}`,
  );
}

export async function download(
  url,
  out,
  { sha256 = null, parts = DEFAULT_PARTS } = {},
) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const tmp = `${out}.download`;
  const info = await probe(url);
  let got;
  if (info.ranges) {
    got = await inParts(url, out, tmp, info.size, parts);
  } else {
    console.log(
      `[download] ${url} does not take byte ranges (no "Accept-Ranges: bytes" or no Content-Length), so this is one stream${info.size ? ` of ${mb(info.size)} MB` : " of unknown size"}; it cannot resume.`,
    );
    got = await oneStream(url, tmp, info.size);
  }
  console.log(`sha256 ${got.sha}`);
  if (sha256 && got.sha !== sha256.toLowerCase()) {
    fs.rmSync(tmp, { force: true });
    if (got.dir) fs.rmSync(got.dir, { recursive: true, force: true });
    throw new Mismatch(
      `sha256 mismatch: expected ${sha256.toLowerCase()}, got ${got.sha}. The file and its parts were deleted.`,
    );
  }
  fs.renameSync(tmp, out);
  if (got.dir) fs.rmSync(got.dir, { recursive: true, force: true });
  console.log(
    `[download] saved ${out} (${fileSize(out)} bytes, ${got.note}, ${mb(got.rate)} MB/s)${sha256 ? ", sha256 matches" : ""}`,
  );
}

async function main(args) {
  const usage = "Usage: download.mjs <url> <out> [--sha256 <hex>] [--parts N]";
  const rest = [];
  let sha256 = null,
    parts = DEFAULT_PARTS;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sha256") {
      sha256 = args[++i];
      if (!/^[0-9a-f]{64}$/i.test(sha256 || "")) {
        console.error(`[download] --sha256 needs 64 hex characters. ${usage}`);
        return 2;
      }
    } else if (args[i] === "--parts") {
      parts = Number(args[++i]);
      if (!Number.isInteger(parts) || parts < 1 || parts > 256) {
        console.error(
          `[download] --parts needs a whole number from 1 to 256. ${usage}`,
        );
        return 2;
      }
    } else if (args[i].startsWith("--")) {
      console.error(`[download] unknown option ${args[i]}. ${usage}`);
      return 2;
    } else rest.push(args[i]);
  }
  if (rest.length !== 2) {
    console.error(`[download] give one url and one output file. ${usage}`);
    return 2;
  }
  const [url, out] = rest;
  if (!/^https?:\/\//i.test(url)) {
    console.error(`[download] ${url} is not an http(s) URL. ${usage}`);
    return 2;
  }
  try {
    await download(url, out, { sha256, parts });
    return 0;
  } catch (err) {
    console.error(`[download] ${url}: ${err.message}`);
    return err instanceof Mismatch ? 3 : 1;
  }
}

// Only when run as the command (by real path, so a link or a letter-case difference still counts), so a
// test can import plan() without the CLI firing
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (
  process.argv[1] &&
  real(process.argv[1]).toLowerCase() ===
    real(fileURLToPath(import.meta.url)).toLowerCase()
) {
  // exit() while fetch's handles are still closing crashes libuv on Windows; exitCode lets Node end cleanly
  process.exitCode = await main(process.argv.slice(2));
}
